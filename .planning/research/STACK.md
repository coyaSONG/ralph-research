# Technology Stack

**Project:** ralph-research
**Scope:** core stability work for resume/recovery, manifest-runtime contract enforcement, and durable frontier/state persistence
**Researched:** 2026-04-05

## Recommended Stack

Keep the existing TypeScript + Node CLI/MCP architecture. Do not broaden the product stack for this milestone. The right move is to replace file-per-record JSON persistence and the ad hoc lockfile with a transactional local runtime store, keep Git worktrees as the isolation mechanism, and make the runtime state machine durable enough that every external side effect can be resumed or repaired.

### Core Runtime

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 24.x | CLI and MCP runtime | The current codebase already runs on modern Node and does not need a runtime rewrite. Keep the platform stable and use it to host a stronger persistence layer instead of adding service infrastructure. |
| TypeScript | 5.9.x | Core implementation language | The current codebase is already strongly typed. The stability work needs stricter contracts and explicit state transitions, not a language change. |
| Vitest | 3.x | Regression, recovery, and invariant tests | Keep the current test runner and add failure-injection coverage around resume, commit/frontier promotion, and abandoned worktree repair. |

### Persistence and Coordination

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| better-sqlite3 | 12.8.0 | Canonical runtime store at `.ralph/runtime.db` | Best fit for a local-first CLI. It exposes explicit transactions and savepoints with a simple synchronous API, which is a good match for one-process-at-a-time orchestration. Its 2026-03-13 release also upgraded bundled SQLite to 3.51.3, which matters because SQLite documents a WAL corruption bug fixed in 3.51.3. |
| SQLite | 3.51.3 via better-sqlite3 12.8.0 | Durable local state engine | Use one database as the source of truth for runs, decisions, frontier state, leases, migrations, and repair metadata. SQLite WAL mode gives local concurrency without adding a daemon or network service. |
| Zod | 4.x | Single source of truth for manifest and persisted payload validation | Keep Zod. Zod 4 now has native JSON Schema conversion, so the project can keep one schema authority instead of splitting contracts between multiple validation systems. |
| Git CLI worktrees | current documented pattern | Candidate isolation and promotion boundary | Keep worktrees. The project already depends on Git, and worktrees remain the cleanest way to isolate candidate mutations without inventing a second workspace model. |

### Supporting Practices

| Practice | Tooling | Why |
|----------|---------|-----|
| SQL migrations checked into repo | plain `.sql` files plus a tiny migration runner | Do not add an ORM for this milestone. Hand-written migrations keep the state model explicit and reviewable. |
| Structured logs and artifacts on disk, metadata in SQLite | existing filesystem plus DB references | Large stdout logs, prompts, patches, and artifacts should remain files. SQLite should store pointers, hashes, sizes, and lifecycle state. |
| Command execution | existing `execa` | Keep it, but shift validation and resume state into SQLite rather than relying on shell execution order. |

## Prescriptive Decisions

### 1. Replace JSON stores with one SQLite database

Use `.ralph/runtime.db` as the canonical store. Do not keep `runs/`, `decisions/`, and `frontier.json` as independent sources of truth.

Recommended tables:

| Table | Purpose |
|-------|---------|
| `runs` | One row per run with current phase, status, manifest hash, baseline commit, candidate id, workspace path, commit sha, and repair state |
| `run_steps` | Append-only transition log with `step_seq`, `phase`, `action`, `result`, payload JSON, and timestamps |
| `decisions` | Durable decision records keyed by run id |
| `frontier_entries` | Current frontier rows, one row per entry, not a JSON snapshot blob |
| `frontier_events` | Append-only record of frontier changes for audit and repair |
| `workspaces` | Worktree metadata, lock status, baseline commit, patch path, cleanup state |
| `leases` | Runtime lease ownership and heartbeat state |
| `schema_migrations` | Applied migration versions and checksums |
| `external_effects` | Idempotent side-effect ledger for promotion, commit, frontier update, and cleanup |

Do not store the current frontier only as a single JSON array. That makes corruption harder to localize and repair. Use normalized rows for current state and an append-only event history for auditability.

### 2. Configure SQLite for durability first, not peak throughput

Open the database with these defaults:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA journal_size_limit = 67108864;
```

Use `STRICT` tables for application-owned tables.

Why this configuration:

- `WAL` is the right local concurrency mode because readers do not block writers and writers do not block readers on the same host.
- `synchronous = FULL` is the correct choice for this project. SQLite documents that `NORMAL` can sacrifice durability after power loss; this runtime is explicitly trying to make resume/recovery trustworthy.
- `busy_timeout` is necessary because SQLite only allows one writer at a time and will otherwise fail immediately with `SQLITE_BUSY`.
- `STRICT` tables move type mistakes from silent drift into immediate constraint failures, which is exactly what the runtime contract needs.

Operational guidance:

- Run `PRAGMA optimize;` before closing short-lived CLI connections.
- For the long-lived MCP server, run `PRAGMA optimize=0x10002;` on open and `PRAGMA optimize;` periodically.
- After any unclean shutdown or migration failure, run `PRAGMA quick_check;` and `PRAGMA foreign_key_check;` before resuming work.

### 3. Do not adopt `node:sqlite` yet

Do not build the new persistence layer on Node's built-in `node:sqlite` module in this milestone.

Reason:

- Node's own current docs still mark `node:sqlite` as `Stability: 1.1 - Active development`.
- This project needs a boring, proven storage layer more than it needs fewer dependencies.
- `better-sqlite3` already gives the exact transaction model this runtime needs and its current release pulls in SQLite 3.51.3, which is directly relevant because of SQLite's documented WAL-reset fix.

Revisit `node:sqlite` only after it exits experimental status and the runtime's recovery model is already stable.

### 4. Replace the file TTL lock with a DB-backed lease

The current lockfile is not sufficient because `updatedAt` is never renewed and long-running operations can look stale.

Use a `leases` table instead:

| Column | Purpose |
|--------|---------|
| `scope` | Usually one row for `repo` |
| `lease_token` | Random opaque owner token |
| `owner_pid` | Local process id for diagnostics |
| `owner_host` | Hostname for multi-machine safety checks |
| `owner_started_at` | Process start time if available |
| `heartbeat_at` | Last successful renewal |
| `expires_at` | Lease expiry time |

Acquisition pattern:

1. `BEGIN IMMEDIATE`.
2. Read the lease row for the repo.
3. If no row exists, or it is expired, claim it with a new token and expiry.
4. Commit.
5. Heartbeat every 10 seconds during long operations.

Release pattern:

1. `BEGIN IMMEDIATE`.
2. Delete or clear the lease only if `lease_token` matches.
3. Commit.

Important details:

- Keep lease renewal token-checked so one process cannot release another process's lease.
- On the same host, use PID liveness only as an extra signal. Expiry time is the real takeover rule.
- Use the DB lease for runtime ownership and `git worktree --lock` for worktree metadata protection. These solve different problems and should both exist.

### 5. Persist the state machine as a saga, not a best-effort try block

The current accept path writes a decision, then promotes files, commits, updates frontier, and cleans up. That sequence is not transactional because Git and filesystem mutation live outside the JSON stores.

Recommended pattern:

- Keep `runs.phase` as the current materialized state.
- Also append every transition into `run_steps`.
- Before every external side effect, write an `external_effects` row with `status = pending`.
- After the side effect succeeds, mark the effect row `applied` and persist any derived data such as `commit_sha`.
- Resume from the last durable pending effect rather than from inference over partial files.

Refine the durable phases to match real recovery points:

1. `candidate_prepared`
2. `experiment_executed`
3. `metrics_evaluated`
4. `decision_persisted`
5. `promotion_staged`
6. `commit_written`
7. `frontier_persisted`
8. `workspace_cleaned`
9. `completed`

Use `SAVEPOINT`s inside a run transaction when updating multiple tables together. For example, `runs`, `run_steps`, `decisions`, and `external_effects` should move together or not at all.

### 6. Keep Git worktrees, but make them more durable and more honest

Use Git worktrees for this milestone. Do not implement `workspace: copy` now. Reject it at validation time until there is a real implementation.

Recommended worktree strategy:

- Resolve `baselineRef` to an exact commit SHA up front and store that SHA in the run record.
- Create candidate worktrees with `git worktree add --detach --lock <path> <resolved-sha>`.
- Parse worktree inventory only with `git worktree list --porcelain -z`.
- On startup or repair flows, reconcile the DB's `workspaces` table against `git worktree list --porcelain -z`.
- If metadata drift is detected because paths moved, invoke `git worktree repair` rather than trying to patch files manually.

Promotion strategy:

- Do not rely on raw file copy as the only durable promotion mechanism.
- Persist a binary patch artifact and changed-path manifest before mutating the main checkout.
- Treat patch application, Git staging, and commit creation as separate durable effects.

This is the practical boundary:

- Worktree isolation remains the right workspace model.
- Promotion must become replayable and inspectable, not just "copy files, then hope the next step succeeds".

### 7. Tighten manifest/runtime contract enforcement with one authority

Keep Zod as the contract authority and remove unsupported surface aggressively.

Rules for this milestone:

- If `project.workspace = copy` is not implemented, reject it during validation.
- If `operator_llm` proposer execution is not implemented, reject it during validation.
- If `baselineRef` cannot be resolved to a commit, fail preflight before any workspace or run row is created.
- If required external commands are missing, fail preflight before acquiring the run lease.

Use Zod 4's JSON Schema export to generate a machine-readable contract for docs and tooling, but do not create a second handwritten schema system.

### 8. Preflight should be a mandatory capability probe, not a nice-to-have command

Every mutating command should run the same preflight path.

Preflight must verify:

- manifest parses and contains no unsupported options
- repo is a valid Git worktree and the resolved `baselineRef` exists
- storage root is writable and SQLite can open in WAL mode
- DB schema is up to date
- required external commands exist
- stale lease takeover is safe
- abandoned worktrees are either repaired or explicitly reported
- any resumable run has a matching workspace row and pending effect row

If preflight fails, no run id should be allocated and no workspace should be created.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Runtime DB | `better-sqlite3` 12.8.0 | `node:sqlite` in Node 24 | Official Node docs still mark it active-development experimental. This project needs stability more than dependency minimization. |
| Persistence model | SQLite + filesystem artifacts | file-per-record JSON stores | JSON files cannot give atomic cross-record updates, fast point queries, or robust lease coordination. |
| Data access | hand-written SQL + migrations | ORM such as Prisma or Drizzle | The runtime needs explicit transaction boundaries and repair semantics. An ORM adds abstraction where the hard part is already conceptual, not ergonomic. |
| Workspace model | Git worktrees only | dual support for worktree and copy now | The current milestone is reliability hardening. Supporting two workspace backends before the first is correct will increase drift. |
| Validation strategy | Zod 4 as single authority | Zod plus Ajv plus handwritten JSON Schema | Multiple schema authorities create the exact manifest/runtime drift this milestone is trying to remove. |

## Installation

```bash
npm install better-sqlite3
```

## Sources

- HIGH: Node.js SQLite docs, current `node:sqlite` status and API notes: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
- HIGH: better-sqlite3 docs for transactions and WAL usage: https://github.com/WiseLibs/better-sqlite3/blob/v12.6.2/docs/api.md
- HIGH: better-sqlite3 README example for WAL setup: https://github.com/WiseLibs/better-sqlite3/blob/v12.6.2/README.md
- HIGH: better-sqlite3 release `v12.8.0` with SQLite 3.51.3 update: https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.8.0
- HIGH: SQLite WAL documentation, including same-host requirement, checkpointing, and the 2026 WAL-reset fix note: https://sqlite.org/wal.html
- HIGH: SQLite transaction semantics and single-writer model: https://www.sqlite.org/lang_transaction.html
- HIGH: SQLite busy timeout interface: https://sqlite.org/c3ref/busy_timeout.html
- HIGH: SQLite ANALYZE and `PRAGMA optimize` recommendations: https://sqlite.org/lang_analyze.html
- HIGH: SQLite STRICT tables: https://www.sqlite.org/stricttables.html
- HIGH: SQLite PRAGMA reference for `journal_mode`, `journal_size_limit`, `integrity_check`, `quick_check`, and related pragmas: https://sqlite.org/pragma.html
- HIGH: Git worktree reference for `--lock`, `--porcelain`, `repair`, `prune`, and linked worktree metadata behavior: https://git-scm.com/docs/git-worktree
