# Domain Pitfalls

**Domain:** local-first recursive research runtime / agentic CLI with persisted run state, Git mutation, manual review, and resume/recovery semantics
**Researched:** 2026-04-05
**Overall confidence:** HIGH

## Recommended Phase Map

Use these phase names when assigning roadmap work:

| Phase | Focus |
|------|-------|
| Phase 1 | Recovery model and lease semantics |
| Phase 2 | Acceptance transaction and repo mutation repair |
| Phase 3 | Frontier integrity and manual review consistency |
| Phase 4 | Persisted-state schema versioning and migration |
| Phase 5 | Shell execution hardening and deterministic boundaries |
| Phase 6 | Repair tooling, doctor checks, and crash-recovery tests |

## Critical Pitfalls

### Pitfall 1: Heartbeat-free lockfiles create false stale-lock recovery
**What goes wrong:** A live run loses its lock because lock freshness is inferred from a fixed TTL or PID probe rather than an actively renewed lease. A second process then steals the lock and both processes mutate the same repo or state directory.

**Why it happens:** File-lock implementations often stop at "create `.lock` if absent". That works for mutual exclusion, but not for long-running automation, process crashes, PID reuse, or portable worktrees. Git's own lockfile API assumes process-lifetime cleanup plus atomic rename for a single file update; it is not a substitute for a renewable multi-step runtime lease.

**Warning signs:**
- Lock metadata has `createdAt` / `updatedAt`, but `updatedAt` never changes during long work.
- Lock expiry is time-based only.
- "Stale lock" recovery deletes lockfiles without proving the owner is actually dead.
- Users report duplicate runs, double commits, or intermittent "token mismatch" cleanup failures.
- Long experiments or judge calls run longer than lock TTL.

**Current repo signal:** `src/adapters/fs/lockfile.ts` uses a fixed five-minute TTL and never refreshes `updatedAt`. `.planning/codebase/CONCERNS.md` already identified this as a fragile area.

**Prevention strategy:**
- Replace one-shot lockfiles with lease records that are renewed on a heartbeat cadence shorter than the TTL.
- Treat lock ownership as `(token, process identity, run id)` rather than PID alone.
- Fence every destructive step with the current lease token so an old owner cannot continue after lease loss.
- Make takeover a repair path, not the default path: require proof of owner death or an explicit operator `repair --takeover`.
- Test the exact failure case: long-running work that exceeds TTL while still healthy.

**Phase should address it:** Phase 1

### Pitfall 2: "Resume" exists in the CLI but not in the execution model
**What goes wrong:** The runtime advertises resumability, but persisted state is only a progress marker, not a replayable execution log. Restarting either starts a new run or repeats side effects, which is worse than failing fast because operators trust a recovery contract that is not real.

**Why it happens:** True resume requires durable recording of step boundaries and results before later side effects occur. Durable execution systems solve this with event history and deterministic replay. A phase enum plus `pendingAction` is not enough if proposal generation, experiments, commits, or frontier writes are not individually replay-safe and idempotent.

**Warning signs:**
- `--resume` or `resume_required` exists, but there is no per-phase re-entry implementation.
- Recovery logic infers the next step from current phase alone.
- Non-deterministic values are generated inline and not persisted.
- A crash after "decision written" cannot distinguish "side effect completed" from "side effect started".
- Operators must manually inspect workspaces to know whether resuming is safe.

**Current repo signal:** `src/core/state/run-state-machine.ts` computes a `RecoveryPlan`, but `.planning/codebase/CONCERNS.md` documents that `RunCycleService.run()` does not actually reload and replay the interrupted run.

**Prevention strategy:**
- Model the run as a persisted step journal with explicit preconditions, outputs, and idempotency keys per step.
- Resume by replaying durable history, not by inferring intent from the latest record shape.
- Persist non-deterministic outputs before later logic depends on them.
- Split "can resume" from "should resume": if invariants do not hold, require `repair` rather than pretending replay is safe.
- Add crash-injection tests at every boundary: after proposal, after experiment, after evaluation, after decision write, after commit, after frontier save, after cleanup.

**Phase should address it:** Phase 1

### Pitfall 3: Acceptance is a multi-system transaction with no transaction model
**What goes wrong:** A candidate is marked accepted, but only some of the required side effects actually happen. Common mixed states are: decision says accepted but no commit exists, commit exists but frontier was not updated, frontier was updated but workspace cleanup failed, or files were copied into the repo without a matching run status.

**Why it happens:** The acceptance path spans several systems with different atomicity guarantees: JSON stores, Git index/commit state, filesystem copies/deletes, and workspace cleanup. Without a transaction envelope and repair semantics, every crash point creates a new invalid hybrid state.

**Warning signs:**
- Accepted decision records appear before commit SHA exists.
- Run status can become `failed` after an accept-path side effect already happened.
- Promotion copies files directly into the main repo before commit succeeds.
- Cleanup errors leave abandoned workspaces or half-promoted trees.
- Operators need manual cleanup instructions after interruption.

**Current repo signal:** `src/core/engine/cycle-runner.ts` writes the decision record before promotion, commit, frontier save, and cleanup. `.planning/codebase/CONCERNS.md` already calls the accepted path non-transactional.

**Prevention strategy:**
- Introduce an explicit acceptance transaction state machine: `prepared`, `promoted`, `committed`, `frontier_saved`, `cleaned`, `completed`.
- Make every stage idempotent and repairable.
- Prefer staging mutations into a transaction workspace, then commit once, then finalize metadata.
- Persist enough metadata to detect and repair partial completion on the next startup.
- Add a repair command that can finish, roll back, or quarantine a partial accept path.

**Phase should address it:** Phase 2

### Pitfall 4: Frontier state is overwritten by alternate code paths
**What goes wrong:** The canonical frontier algorithm is bypassed by manual review or recovery tooling, so the frontier becomes semantically wrong even if the file is structurally valid. Single-entry overwrites, missing dominated survivors, or mismatched `beforeFrontierIds` / `afterFrontierIds` cause later cycles to compare against the wrong incumbents.

**Why it happens:** Frontier logic is subtle and tends to be duplicated in "special" flows such as human accept, repair, import, or migration. Once multiple code paths can write `frontier.json`, one of them eventually diverges from the real update semantics.

**Warning signs:**
- Manual accept writes frontier snapshots directly instead of calling the same frontier engine used by automatic acceptance.
- Frontier IDs do not line up with decision records.
- Pareto frontiers shrink to one entry after human review.
- Status and inspect output disagree on the current frontier.
- Frontier corruption is only noticed when the next cycle behaves strangely.

**Current repo signal:** `src/app/services/manual-decision-service.ts` writes a single-entry frontier on accept. `.planning/codebase/CONCERNS.md` flags this as a known bug for Pareto workflows.

**Prevention strategy:**
- Make the frontier a derived projection from accepted decisions plus manifest policy, not a write-anything mutable blob.
- Route manual review through the same frontier transition function as automated acceptance.
- Add invariant checks: no duplicate frontier IDs, no missing commit SHA for accepted entries, no direct overwrite that violates frontier strategy.
- Support frontier rebuild from durable history so corruption is repairable.
- Add dedicated integration tests for manual acceptance under both `single_best` and `pareto`.

**Phase should address it:** Phase 3

### Pitfall 5: Persisted-state schema drift silently breaks recovery
**What goes wrong:** New code reads old run, decision, frontier, or lock records differently than the version that wrote them. Resume logic then misclassifies runs, forgets mandatory fields, or "repairs" state into the wrong shape.

**Why it happens:** File-per-record JSON storage looks simple, so teams often skip schema versioning until recovery matters. But resumable runtimes depend on old state remaining interpretable across code changes.

**Warning signs:**
- Records have no explicit schema version.
- Deserializers accept broad optional shapes and fill defaults silently.
- Migrations are ad hoc or implicit in application code.
- A changed enum or field name forces operators to delete state directories.
- Manual repair scripts edit JSON files directly.

**Current repo signal:** The runtime persists runs, decisions, and frontier snapshots as JSON files under `.ralph/` and the current milestone already centers trust on persisted operational state. There is no codebase evidence of explicit storage-version migration orchestration.

**Prevention strategy:**
- Add a storage schema version to every persisted record family and a project-level store version.
- Migrate on open, not lazily across random call sites.
- Keep migrations forward-only, tested, and resumable.
- Fail fast on unknown versions; do not silently coerce.
- Add export/rebuild tooling so the runtime can reconstruct projections after migration.

**Phase should address it:** Phase 4

### Pitfall 6: Shell-driven execution becomes the control plane instead of a boundary
**What goes wrong:** The runtime delegates core behavior to `shell: true` commands with inherited environment, implicit quoting rules, and buffered stdio behavior. This creates injection risk, platform drift, hung subprocesses, nondeterministic parsing, and hard-to-replay side effects.

**Why it happens:** Shell execution is attractive because it is easy to wire up, but shells are a leaky abstraction for durable automation. Node's own docs warn that `exec()` processes the command string directly in the shell and that unsanitized input can trigger arbitrary command execution. Shell pipes can also block when stdout/stderr are not drained.

**Warning signs:**
- Commands are persisted as opaque strings rather than structured argv + env.
- Runtime merges all of `process.env` into child processes.
- Output parsing depends on shell quoting or glob behavior.
- Resume requires re-running the exact shell command and hoping it is safe.
- Intermittent hangs disappear when command output is redirected or reduced.

**Current repo signal:** `.planning/codebase/CONCERNS.md` documents shell execution plus full environment inheritance across proposer, experiment, extractor, and judge flows.

**Prevention strategy:**
- Prefer argv-based execution with explicit executable, args, cwd, env allowlist, timeout, and output contracts.
- Treat shell mode as an opt-in compatibility adapter, not the default runtime primitive.
- Capture stdout/stderr as durable artifacts, with size limits and truncation markers.
- Separate "execute command" from "interpret command output" so replay can reuse persisted outputs.
- Add safe mode that rejects shell metacharacters and blocks ambient secret inheritance by default.

**Phase should address it:** Phase 5

## Moderate Pitfalls

### Pitfall 7: Worktree admin drift strands recoverable work
**What goes wrong:** The actual workspace still exists, but the runtime can no longer locate or trust it because linked-worktree metadata drifted, the path moved, or stale admin files were pruned. Recovery then fails even though the candidate workspace could have been salvaged.

**Why it happens:** Git worktrees have shared and per-worktree refs plus admin metadata under `$GIT_DIR/worktrees`. Git supports prune, lock, and repair because worktree metadata does go stale. Runtimes that assume "path exists" equals "worktree is healthy" eventually lose track of recoverable work.

**Warning signs:**
- Workspace paths are stored, but there is no health check on startup.
- Users move repos or worktrees manually.
- Recovery assumes `.git` internals live in one fixed location.
- The runtime never uses `git worktree list --porcelain`, `lock`, `prune`, or `repair`.
- Orphaned workspaces accumulate under the storage root.

**Current repo signal:** The project depends on Git worktrees as first-class runtime infrastructure, and `.planning/codebase/CONCERNS.md` already calls workspace promotion and cleanup fragile.

**Prevention strategy:**
- Persist both runtime metadata and Git-reported worktree identity.
- Use Git's own worktree inspection/repair commands instead of path guessing.
- Lock long-lived worktrees that must survive disconnects or pauses.
- Add startup reconciliation that classifies workspaces as live, orphaned, missing, or repairable.
- Provide an operator-visible `doctor workspaces` command.

**Phase should address it:** Phase 6

### Pitfall 8: Recovery is untestable because crash boundaries are not injectable
**What goes wrong:** The runtime may look correct under happy-path integration tests, but the actual expensive failures happen only when the process dies between durable steps. Without deterministic crash injection, regressions keep reappearing.

**Why it happens:** Teams test run success, not interruption. But resumable automation is defined by what happens during failure windows, not after clean completion.

**Warning signs:**
- Tests cover successful accept/reject flows but not mid-step interruption.
- There is no harness to crash after specific persisted boundaries.
- Recovery bugs are found manually in real repos.
- Bug fixes add guards but no reproducer.

**Current repo signal:** `.planning/codebase/TESTING.md` shows strong temp-repo integration patterns, but `.planning/codebase/CONCERNS.md` calls out missing tests for partial accept-path failures, resume, and manual decision flows.

**Prevention strategy:**
- Add crash points around every state transition and destructive side effect.
- Reopen the repo after each injected crash and assert recovery classification.
- Build regression fixtures from real corrupted states, not just synthetic happy-path records.
- Require every recovery bug fix to land with a failing-then-passing interruption test.

**Phase should address it:** Phase 6

## Minor Pitfalls

### Pitfall 9: Status surfaces lie because projections are not rebuilt
**What goes wrong:** CLI status, inspect, and MCP views show a clean story even when the underlying stores disagree. Operators then trust the wrong repair action.

**Why it happens:** Read models are often optimistic and assume records are internally consistent. In resumable systems, status code must be skepticism-first.

**Warning signs:**
- `status` and `inspect` do not validate run/decision/frontier cross-links.
- MCP responses expose records directly without consistency checks.
- Operators learn more from reading raw files than from runtime status commands.

**Prevention strategy:**
- Recompute health summaries from durable facts, not from the latest top-level flag.
- Surface "inconsistent state" as a first-class status.
- Block resume/accept actions when projections detect broken invariants.

**Phase should address it:** Phase 6

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Recovery model | Implementing `--resume` as "start a new run with old metadata" | Require durable per-step history and replay-safe re-entry before exposing resume as supported |
| Lease semantics | Deleting stale locks based on TTL alone | Add heartbeats, lease fencing, and explicit operator takeover |
| Acceptance transaction | Writing accepted decisions before repo mutation completes | Introduce transaction phases and repair/resume from each partial boundary |
| Frontier integrity | Letting manual review bypass canonical frontier update logic | Make frontier a derived projection and rebuildable from accepted decisions |
| Schema migration | Adding fields without store-versioning | Version every persisted record family and test migrations against old snapshots |
| Shell execution | Defaulting to `shell: true` with inherited `process.env` | Prefer argv mode, env allowlists, durable output capture, and shell opt-in only |
| Worktree lifecycle | Assuming path existence means worktree validity | Reconcile with `git worktree list --porcelain` and support `repair` / `prune` aware flows |
| Testing | Shipping recovery changes without crash-injection tests | Make interruption tests mandatory for every recovery bug fix |

## Sources

- Temporal durable execution and replay docs: https://docs.temporal.io and Context7 `/temporalio/documentation` - HIGH
- Git lockfile API: https://git-scm.com/docs/api-lockfile - HIGH
- Git worktree docs: https://git-scm.com/docs/git-worktree - HIGH
- Git update-ref transactional ref updates: https://git-scm.com/docs/git-update-ref - HIGH
- Node child process docs: https://nodejs.org/api/child_process.html - HIGH
- SQLite WAL and locking docs: https://sqlite.org/wal.html and https://sqlite.org/lockingv3.html - HIGH
- SQLite pragma docs for integrity checks and store controls: https://sqlite.org/pragma.html - HIGH
- Repo context: `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/TESTING.md` - HIGH
