# Phase 2: Resume Control Plane - Research

**Researched:** 2026-04-05
**Domain:** Resume/recovery control plane for a local-first TypeScript CLI and stdio MCP runtime
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Plain `rrx run` should auto-resume when the latest run is recoverable; otherwise it should start a fresh run.
- **D-02:** `rrx run --fresh` should always start a fresh run and opt out of auto-resume.
- **D-03:** Auto-resume should always target the latest recoverable run only. Older interrupted runs are ignored by default.
- **D-04:** Phase 2 should not add arbitrary `runId` resume targeting. Resume scope stays latest-only for now.
- **D-05:** `rrx status` should expose a high-level recovery classification plus the next action, not just raw phase/status fields.
- **D-06:** `rrx inspect <runId>` should expose a dedicated recovery section with `classification`, `nextAction`, `reason`, and `resumeAllowed`.
- **D-07:** Detailed repair evidence taxonomy is out of scope for this phase; a truthful reason string is sufficient.
- **D-08:** Partial runs missing durable recovery evidence must not be resumed by guesswork. They should be classified as `repair_required`.
- **D-09:** If the latest run is `repair_required`, plain `rrx run` should print a warning and start a fresh run rather than force an explicit override.
- **D-10:** Even when an older run is still recoverable, the runtime should not search backward past a `repair_required` latest run. The latest-only rule remains in force.
- **D-11:** Active ownership should use heartbeat/lease renewal that refreshes lock metadata during long-running work.
- **D-12:** Stale-lock takeover should require a grace window after TTL expiry rather than treating the first missed heartbeat as stale.
- **D-13:** When another process holds an active lease, default `rrx run` behavior should fail immediately with actionable lock-owner details instead of waiting.

### Claude's Discretion
- The exact naming of recovery classifications, as long as they clearly distinguish resumable, manual-review-blocked, repair-required, and idle states.
- The exact heartbeat cadence and grace-window constants, as long as they preserve short stale detection after crashes without causing false-positive takeover during healthy long runs.
- The exact warning and error message wording, as long as it stays operationally explicit for the primary user.

### Deferred Ideas (OUT OF SCOPE)
- Arbitrary `runId` resume targeting such as `rrx run --run-id <id>` - intentionally deferred until latest-only recovery is proven and a real use case exists.
- Rich repair tooling or structured missing-evidence taxonomies - belongs to later repair/promotion hardening work, not this first truthful resume control plane.
- Wait/retry lock contention modes such as `--wait` - possible future interface extension, but not needed for Phase 2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RECV-01 | Operator can resume an interrupted run with the same `runId` instead of starting a fresh run | Latest-run selector in `RunCycleService`, same-run step dispatcher in `cycle-runner`, and `--fresh` opt-out preserve same `runId` semantics. [VERIFIED: codebase grep] |
| RECV-02 | Operator can resume from the last durable execution step after interruption during proposal, experiment, evaluation, decision writing, commit, or frontier update | Checkpoint-aligned phase model plus persisted evidence per durable boundary; ambiguous or contradictory partial state must classify as `repair_required`. [VERIFIED: codebase grep] |
| RECV-03 | Operator can see whether a run is resumable, blocked for manual review, or requires repair via stable `status` and `inspect` output | Recovery classifier should live in service/state code and be reused by CLI and MCP read models. [VERIFIED: codebase grep] |
| RECV-04 | Operator can recover from long-running execution without a stale lock incorrectly allowing another process to take over active work | Renewable lease with heartbeat, token-checked renewal/release, TTL plus grace, and fail-fast active-owner errors. [VERIFIED: codebase grep] [CITED: https://nodejs.org/api/timers.html] [CITED: https://nodejs.org/api/process.html] |
</phase_requirements>

## Summary

`RunCycleService.run()` currently returns `resume_required` when the latest run is recoverable, but `resume: true` still calls `runCycle()` and mints a new `runId`; no code reloads a persisted workspace or dispatches from the saved `pendingAction`. [VERIFIED: codebase grep] The current `prepareCandidateAttempt()` path also executes workspace creation, proposal, experiment, and metric evaluation before the first post-step checkpoint is written, so the persisted `proposed` phase does not mean "proposal durably completed" in practice. [VERIFIED: codebase grep]

Phase 2 should make the control plane truthful before it tries to make promotion transactional. The right shape is a latest-only same-run dispatcher where `phase` means "last durable boundary reached", `pendingAction` means "next step to execute", and recovery classification is derived from persisted evidence plus the latest lock state. [VERIFIED: codebase grep] `status` and `inspect` should project the same classifier, and CLI/MCP should stay as thin transports over that shared service logic. [VERIFIED: codebase grep]

The important brownfield boundary is accepted-path mutation. Proposal, experiment, evaluation, and decision persistence can become truly resumable in Phase 2 because they are still isolated to run state and worktrees. [VERIFIED: codebase grep] Mid-promotion or mid-commit ambiguity in the main repo should not be guessed away in this phase; when durable evidence is missing or contradictory, classify the latest run as `repair_required` and start fresh on plain `rrx run`, leaving transactional promotion/repair tooling to Phase 3. [VERIFIED: codebase grep]

**Primary recommendation:** Implement Phase 2 as a latest-run checkpoint dispatcher plus a shared recovery classifier and renewable lease, not as a new resume command or a backward scan over historical runs.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-ins (`node:fs/promises`, `node:process`, `node:timers`) | local runtime `24.11.0` | Durable checkpoint files, lock leases, timer-based heartbeats, PID liveness checks | This repo already depends on Node's filesystem, process, and timer APIs for state and lock behavior. [VERIFIED: codebase grep] Node documents direct exclusive-open handling with `'wx'`, `writeFile(..., { flush: true })`, timer `unref()`, and `process.kill(pid, 0)`. [CITED: https://nodejs.org/api/fs.html] [CITED: https://nodejs.org/api/timers.html] [CITED: https://nodejs.org/api/process.html] |
| TypeScript | repo `5.9.3` | Typed recovery model, step-handler interfaces, CLI/MCP contract reuse | The entire runtime and tests are TypeScript and already enforce strict compiler settings. [VERIFIED: codebase grep] |
| Zod | repo `4.1.11` | Validation for extended `RunRecord`, lock metadata, and read-model invariants | Persisted models already round-trip through Zod and should keep doing so for checkpoint additions. [VERIFIED: codebase grep] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | repo `3.2.4` | Resume, lock, CLI, and read-model regression coverage | Use for all new Phase 2 tests; the repo already runs Node-only integration tests in temp git repos. [VERIFIED: codebase grep] |
| Execa | repo `9.6.0` | Real git/process integration in tests and runtime | Keep using it for git worktree and commit flows; do not replace with shell wrappers in this phase. [VERIFIED: codebase grep] |
| Commander | repo `14.0.1` | CLI option surface for `--fresh` and resume/status messaging | Extend existing command modules rather than adding a parallel transport path. [VERIFIED: codebase grep] |
| `@modelcontextprotocol/sdk` | repo `1.17.4` | MCP transport parity for run/status behavior | Keep MCP semantics aligned with the shared service layer rather than reimplementing recovery logic in the server. [VERIFIED: codebase grep] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSON file stores plus explicit checkpoints | SQLite or append-only event journal | More durable long-term, but it is a bigger migration than Phase 2 needs and would leak into Phase 3/5 scope. [VERIFIED: codebase grep] |
| Plain `rrx run` latest-only resume plus `--fresh` | New `resume` command or arbitrary `runId` targeting | The alternative adds operator surface that the user explicitly deferred. [VERIFIED: codebase grep] |
| Service-derived recovery classifier | Transport-specific `resume_required` branches | Branching in CLI and MCP would drift again; the shared services already own status/inspect truth. [VERIFIED: codebase grep] |

**Installation:**
```bash
npm install
```

No new package dependency is justified for Phase 2. [VERIFIED: codebase grep]

**Version verification:** Keep repo-pinned versions for Phase 2; do not expand scope into dependency upgrades. Current registry state was verified on 2026-04-05. [VERIFIED: npm registry]

- `typescript`: repo `5.9.3`, latest `6.0.2`, repo version published `2025-09-30T21:19:38.784Z`. [VERIFIED: npm registry]
- `vitest`: repo `3.2.4`, latest `4.1.2`, repo version published `2025-06-17T17:54:25.895Z`. [VERIFIED: npm registry]
- `zod`: repo `4.1.11`, latest `4.3.6`, repo version published `2025-09-20T17:16:31.591Z`. [VERIFIED: npm registry]
- `execa`: repo `9.6.0`, latest `9.6.1`, repo version published `2025-05-26T21:59:25.151Z`. [VERIFIED: npm registry]
- `@modelcontextprotocol/sdk`: repo `1.17.4`, latest `1.29.0`, repo version published `2025-08-22T09:22:25.553Z`. [VERIFIED: npm registry]
- `commander`: repo `14.0.1`, latest `14.0.3`, repo version published `2025-09-12T07:27:06.725Z`. [VERIFIED: npm registry]
- `yaml`: repo `2.8.1`, latest `2.8.3`, repo version published `2025-08-05T13:19:28.985Z`. [VERIFIED: npm registry]
- `pino`: repo `10.0.0`, latest `10.3.1`, repo version published `2025-10-03T10:28:26.888Z`. [VERIFIED: npm registry]

## Architecture Patterns

### Recommended Project Structure
```text
src/
├── app/services/
│   ├── run-cycle-service.ts      # latest-run selection, lease lifecycle, same-run resume admission
│   └── project-state-service.ts  # recovery classifier for status/inspect and lock-owner projection
├── core/
│   ├── engine/cycle-runner.ts    # step dispatcher with one checkpoint write per durable boundary
│   ├── model/run-record.ts       # checkpoint evidence and recovery metadata schema
│   └── state/run-state-machine.ts # phase progression, recovery classification, next-action mapping
└── adapters/fs/lockfile.ts       # renewable lease acquire/renew/release/read helpers
tests/
├── run-cycle-service.test.ts
├── state-engines.test.ts
├── lockfile-workspace-manager.test.ts
├── cli-commands.test.ts
└── project-state-service.test.ts # new in Phase 2
```

The codebase already keeps orchestration in services/engines, persistence in filesystem adapters, and transport logic in CLI/MCP modules. [VERIFIED: codebase grep]

### Pattern 1: Last-Durable-Checkpoint State Machine
**What:** `phase` must describe the last durable checkpoint reached, not "where the code probably was when it crashed". [VERIFIED: codebase grep]
**When to use:** For every resume decision and every `status`/`inspect` recovery projection.
**Recommendation:** Add an explicit pre-proposal phase such as `started` or `admitted`, then persist a checkpoint immediately after proposal, experiment, evaluation, decision write, commit, and frontier save. Keep `pendingAction` as the next executable step.
**Why:** The current initial run record is written as `phase: "proposed"` before workspace creation, proposal, experiment, or evaluation happen. [VERIFIED: codebase grep]
**Example:**
```typescript
// Source pattern: current run-state-machine + run-cycle checkpoint writes
run = advanceRunPhase(run, "proposed", {
  pendingAction: "execute_experiment",
});
await runStore.put(run);
```

### Pattern 2: Step Dispatcher Instead of One Monolithic Try Block
**What:** Replace the "one call does everything" path with a dispatcher that executes exactly one pending step at a time, writes its checkpoint, then continues or returns.
**When to use:** In `cycle-runner.ts` for both fresh runs and resumed runs.
**Recommendation:** Split the current `prepareCandidateAttempt()` flow into discrete handlers: `prepareProposal`, `executeExperiment`, `evaluateMetrics`, `writeDecision`, `commitCandidate`, `updateFrontier`, and `cleanupWorkspace`.
**Why:** Proposal, experiment, and evaluation are currently bundled into one function and only persisted after all of them finish. [VERIFIED: codebase grep]

### Pattern 3: Recovery Classifier as a Read Model
**What:** Recovery truth should be computed from persisted run, decision, frontier, workspace, and lock evidence rather than copied into CLI/MCP-specific branches.
**When to use:** In `project-state-service.ts` and in the run admission path.
**Recommendation:** Define a shared `classifyRecovery(latestRun, context)` helper that returns `idle`, `resumable`, `manual_review_blocked`, or `repair_required` plus `nextAction`, `reason`, and `resumeAllowed`.
**Why:** `status`, `inspect`, CLI `run`, and MCP `run_research_cycle` currently each see only fragments of recovery truth. [VERIFIED: codebase grep]

### Pattern 4: Renewable Lease with Token-Checked Heartbeat
**What:** The lock should behave like a lease that the owner renews periodically while work is in progress.
**When to use:** Around `RunCycleService.run()` and `ManualDecisionService.accept()/reject()`.
**Recommendation:** Acquire once, start a heartbeat timer at a cadence below the TTL, `unref()` the timer, and renew only if the on-disk token still matches the owner's token.
**Why:** Node documents that timers keep the event loop alive unless `unref()` is called, and `process.kill(pid, 0)` is the portable existence check already used by the repo. [CITED: https://nodejs.org/api/timers.html] [CITED: https://nodejs.org/api/process.html]

### Recommended Implementation Sequence
1. Extend `RunRecord` and the state machine so phase names match durable checkpoints, and add a shared recovery classifier.
2. Refactor `cycle-runner.ts` into resumable step handlers for proposal, experiment, evaluation, and decision persistence.
3. Add latest-only auto-resume and `--fresh` behavior in `RunCycleService` and `run.ts`, then wire `status`/`inspect`/MCP to the shared recovery read model.
4. Add renewable lease behavior in `lockfile.ts` and service wrappers, then cover takeover, lost-lease, and long-running heartbeat cases in tests.
5. Stop at truthful `repair_required` for ambiguous accepted-path mutations; do not expand this phase into repair tooling or frontier rebuild logic.

### Anti-Patterns to Avoid
- **Reusing `proposed` as both "run admitted" and "proposal finished":** It makes resume logic lie by construction. [VERIFIED: codebase grep]
- **Transport-owned recovery logic:** CLI and MCP should not each invent their own resumability rules. [VERIFIED: codebase grep]
- **Scanning older runs when the latest run is ambiguous:** The user explicitly locked latest-only semantics. [VERIFIED: codebase grep]
- **Treating `needs_human` as resumable automation:** Manual review is a block state in this phase, not an auto-resume branch. [VERIFIED: codebase grep]
- **Using fixed-TTL stale detection without heartbeat:** The current five-minute lock can be taken over during healthy long work. [VERIFIED: codebase grep]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Lock creation | `access()`-then-create race checks | Direct exclusive create with `'wx'` and error handling | Node explicitly recommends opening directly and handling `EEXIST` instead of pre-checking accessibility. [CITED: https://nodejs.org/api/fs.html] |
| Lease liveness | Shelling out to `ps`/`pgrep` | `process.kill(pid, 0)` plus heartbeat age | Node documents signal `0` as the existence probe, and it is already the repo's current primitive. [CITED: https://nodejs.org/api/process.html] [VERIFIED: codebase grep] |
| Heartbeat lifecycle | Busy wait loops or timers that keep the process alive | `setInterval(...).unref()` with token-checked renewal | Node timers support `unref()` and `refresh()` for long-lived timer objects. [CITED: https://nodejs.org/api/timers.html] |
| Resume truth | Historical run search or hidden fallback heuristics | Latest-run classifier plus explicit `repair_required` | Guessing around missing evidence contradicts the locked decisions for this phase. [VERIFIED: codebase grep] |
| Phase 2 scope | Ad hoc repo repair logic | Truthful checkpointing now; transactional promotion later | Promotion durability is already sequenced into Phase 3. [VERIFIED: codebase grep] |

**Key insight:** Phase 2 should hand-roll neither a new persistence backend nor repair tooling; it should hand-roll only the repo-specific checkpoint state machine and read model that the current codebase is missing.

## Common Pitfalls

### Pitfall 1: Checkpoint Names That Do Not Match Reality
**What goes wrong:** A run looks resumable even though the recorded phase does not correspond to the last completed step. [VERIFIED: codebase grep]
**Why it happens:** The initial record is written as `proposed`, but proposal, experiment, and evaluation all happen before the next checkpoint. [VERIFIED: codebase grep]
**How to avoid:** Add a pre-proposal phase and persist immediately after each durable step.
**Warning signs:** `status` says "resume from proposed" but there is no persisted proposal output, workspace path, or step-specific evidence. [VERIFIED: codebase grep]

### Pitfall 2: Deriving Recovery from `RunRecord` Alone
**What goes wrong:** The system resumes or blocks incorrectly because it ignores decision files, frontier state, or the workspace on disk.
**Why it happens:** Commit SHA lives on `DecisionRecord`, frontier truth lives in `frontier.json`, and workspace presence is external to the run JSON. [VERIFIED: codebase grep]
**How to avoid:** Make the recovery classifier accept a composite context: run, decision, frontier snapshot, workspace existence, and latest lock metadata.
**Warning signs:** A run in `decision_written` with `status: accepted` is treated the same whether or not `decision.commitSha` exists. [VERIFIED: codebase grep]

### Pitfall 3: Heartbeats That Either Take Over Too Early or Never Expire
**What goes wrong:** A second process steals a healthy run, or a dead process blocks progress forever.
**Why it happens:** Current stale detection is based on a fixed TTL plus one timestamp that is never renewed. [VERIFIED: codebase grep]
**How to avoid:** Renew the lease during active work, then declare stale only after `ttlMs + graceMs` without a valid heartbeat.
**Warning signs:** Lock age is older than TTL while the owner PID still exists and the work is long-running. [VERIFIED: codebase grep]

### Pitfall 4: Letting Phase 2 Absorb Phase 3 Promotion Repair
**What goes wrong:** The plan becomes too large, and resume work gets blocked on solving transactional promotion and frontier rebuilds.
**Why it happens:** The current accepted path mixes workspace promotion, git commit, frontier save, and cleanup in one sequence. [VERIFIED: codebase grep]
**How to avoid:** In Phase 2, resume only from durable evidence that already exists and classify ambiguous accepted-path partials as `repair_required`.
**Warning signs:** The plan starts introducing patch journals, repo repair commands, or frontier reconstruction tooling. [VERIFIED: codebase grep]

### Pitfall 5: Status/Inspect Drift from CLI and MCP Behavior
**What goes wrong:** Operators see one recovery story in `status` and a different one in `run` or MCP.
**Why it happens:** `resume_required` is currently a run-transport status rather than a shared read-model classification. [VERIFIED: codebase grep]
**How to avoid:** Move recovery projection into service/state code and have CLI/MCP serialize the same shape.
**Warning signs:** `rrx run`, `rrx status`, and `run_research_cycle` disagree about whether the latest run is resumable. [VERIFIED: codebase grep]

## Code Examples

Verified patterns from official sources and the current codebase:

### Exclusive Lock Creation Without a Race
```typescript
import { open } from "node:fs/promises";

const handle = await open(lockPath, "wx");
await handle.close();
```
Source: Node recommends opening directly with `'wx'` rather than using `access()` first. [CITED: https://nodejs.org/api/fs.html]

### Heartbeat Timer That Does Not Pin the Process
```typescript
const timer = setInterval(() => renewLease(lockPath, token), heartbeatMs);
timer.unref();
```
Source: Node timers document `unref()` for timers that should not keep the event loop alive. [CITED: https://nodejs.org/api/timers.html]

### Targeted Vitest Commands for Phase 2 Work
```bash
npx vitest run tests/state-engines.test.ts
npx vitest run tests/run-cycle-service.test.ts
npx vitest run tests/lockfile-workspace-manager.test.ts
npx vitest run tests/project-state-service.test.ts
npx vitest run tests/run-cycle-service.test.ts:1
```
Source: Vitest documents file filtering and `file:line` execution. [CITED: https://vitest.dev/guide/filtering.html]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed TTL file lock with no renewal. [VERIFIED: codebase grep] | Renewable lease with heartbeat, `ttl + grace`, and token-checked release. [CITED: https://nodejs.org/api/timers.html] [CITED: https://nodejs.org/api/process.html] | Phase 2 | Prevents false stale-lock takeover during healthy long work. |
| Transport-level `resume_required` sentinel. [VERIFIED: codebase grep] | Shared latest-run recovery classifier used by run/status/inspect/MCP. [VERIFIED: codebase grep] | Phase 2 | Keeps operator-facing recovery truth consistent. |
| `phase` does not reliably equal the last durable step. [VERIFIED: codebase grep] | Checkpoint-aligned phases plus explicit next-action mapping. [VERIFIED: codebase grep] | Phase 2 | Makes same-run resume mechanically possible. |
| Ambiguous partials are only "failed". [VERIFIED: codebase grep] | Ambiguous partials become `repair_required`; manual-review runs become `manual_review_blocked`. [VERIFIED: codebase grep] | Phase 2 | Truth beats guesswork and keeps Phase 3 repair work scoped. |

**Deprecated/outdated:**
- `--resume` as the only way to continue work is outdated for this phase; the locked target is plain `rrx run` auto-resume of the latest recoverable run, with `--fresh` as the escape hatch. [VERIFIED: codebase grep]

## Assumptions Log

All material claims in this research were verified from the codebase, local environment, npm registry, or official docs in this session. No user-confirmation assumptions are currently blocking planning.

## Open Questions

1. **How narrowly should Phase 2 interpret "resume after interruption during commit"?**
   - What we know: The current accepted path promotes workspace files into the repo, commits, saves frontier state, and cleans up in one sequence, and that sequence is not transactional today. [VERIFIED: codebase grep]
   - What's unclear: Whether the planner should treat mid-promotion/mid-commit ambiguity as `repair_required` in Phase 2 or add a minimal replay-safe acceptance checkpoint now.
   - Recommendation: Keep Phase 2 narrow and truthful: resume from durable post-decision, post-commit, and post-frontier checkpoints when evidence exists; classify ambiguous accepted-path partials as `repair_required`; move transactional repairability to Phase 3.

2. **Should the repo add a new initial phase or repurpose `proposed`?**
   - What we know: Current code writes `phase: "proposed"` before proposal work has happened. [VERIFIED: codebase grep]
   - What's unclear: Whether the least risky brownfield move is adding a new phase (`started`/`admitted`) or renaming the current early-phase semantics.
   - Recommendation: Add a new initial phase rather than redefining `proposed`, because the rest of the pipeline already interprets `proposed -> execute_experiment`. [VERIFIED: codebase grep]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | CLI runtime, MCP runtime, lock heartbeat, tests | yes | `v24.11.0` | none |
| npm | install, `npm test`, `npm run typecheck` | yes | `11.6.2` | none |
| Git CLI | worktrees, promotion commits, fixture repos, lock/workspace integration tests | yes | `2.53.0` | none |

**Missing dependencies with no fallback:**
- None. [VERIFIED: local shell]

**Missing dependencies with fallback:**
- None. [VERIFIED: local shell]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `3.2.4` in repo, Node environment. [VERIFIED: codebase grep] |
| Config file | `vitest.config.ts`. [VERIFIED: codebase grep] |
| Quick run command | `npx vitest run tests/state-engines.test.ts tests/run-cycle-service.test.ts tests/lockfile-workspace-manager.test.ts tests/cli-commands.test.ts` |
| Full suite command | `npm test && npm run typecheck` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RECV-01 | Plain `rrx run` auto-resumes the latest recoverable run on the same `runId`; `--fresh` always starts new. | integration + CLI | `npx vitest run tests/run-cycle-service.test.ts tests/cli-commands.test.ts` | yes |
| RECV-02 | Resume continues from the last durable boundary after proposal, experiment, evaluation, decision write, commit, and frontier save. | integration + state | `npx vitest run tests/run-cycle-service.test.ts tests/state-engines.test.ts` | yes |
| RECV-03 | `status` and `inspect` expose `classification`, `nextAction`, `reason`, and `resumeAllowed`, and keep CLI/MCP aligned. | service + CLI + MCP | `npx vitest run tests/project-state-service.test.ts tests/cli-commands.test.ts tests/mcp-server.test.ts` | no - Wave 0 |
| RECV-04 | Healthy long work keeps renewing the lease; stale takeover requires `ttl + grace`; active lease failures show owner details. | integration | `npx vitest run tests/lockfile-workspace-manager.test.ts tests/run-cycle-service.test.ts` | yes |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/state-engines.test.ts tests/run-cycle-service.test.ts tests/lockfile-workspace-manager.test.ts`
- **Per wave merge:** `npx vitest run tests/state-engines.test.ts tests/run-cycle-service.test.ts tests/lockfile-workspace-manager.test.ts tests/cli-commands.test.ts`
- **Phase gate:** `npm test && npm run typecheck` before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/project-state-service.test.ts` - recovery classification for `idle`, `resumable`, `manual_review_blocked`, and `repair_required`
- [ ] `tests/mcp-server.test.ts` - MCP payload parity for run/status recovery semantics
- [ ] Extend `tests/run-cycle-service.test.ts` - same-run resume fixtures for each durable checkpoint and `--fresh`
- [ ] Extend `tests/lockfile-workspace-manager.test.ts` - heartbeat renewal, grace-window takeover, token-mismatch lease loss
- [ ] Extend `tests/cli-commands.test.ts` - `status` and `inspect` recovery sections plus active-lease error messaging

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local CLI runtime; no user authentication layer in scope. [VERIFIED: codebase grep] |
| V3 Session Management | no | No remote user session concept; the relevant control-plane primitive is the local lease lock. [VERIFIED: codebase grep] |
| V4 Access Control | no | No multi-user authorization layer is implemented in this repo. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Zod schema validation for manifests, lock metadata, run records, and decision/frontier records. [VERIFIED: codebase grep] |
| V6 Cryptography | yes | Keep using Node `crypto` primitives such as `randomUUID()` and SHA-256 hashing; do not hand-roll lock tokens or hashes. [VERIFIED: codebase grep] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stale lock takeover of an active run | Tampering / DoS | Renewable lease with heartbeat, grace window, token-checked renewal/release, and owner-detail errors. [VERIFIED: codebase grep] [CITED: https://nodejs.org/api/timers.html] |
| Resuming from contradictory or partial evidence | Tampering / Repudiation | Schema-validated checkpoints plus `repair_required` instead of inferred resume. [VERIFIED: codebase grep] |
| Manifest-driven shell commands inherit broad environment | Elevation / Information Disclosure | Treat manifests as trusted local code, keep scope narrow in Phase 2, and do not expand shell surface while touching recovery. [VERIFIED: codebase grep] |

## Sources

### Primary (HIGH confidence)
- Codebase audit via:
  - `src/app/services/run-cycle-service.ts`
  - `src/app/services/project-state-service.ts`
  - `src/core/engine/cycle-runner.ts`
  - `src/core/state/run-state-machine.ts`
  - `src/core/model/run-record.ts`
  - `src/adapters/fs/lockfile.ts`
  - `src/core/engine/workspace-manager.ts`
  - `src/adapters/git/git-client.ts`
  - `src/app/services/manual-decision-service.ts`
  - `tests/state-engines.test.ts`
  - `tests/run-cycle-service.test.ts`
  - `tests/lockfile-workspace-manager.test.ts`
  - `tests/cli-commands.test.ts`
- Node.js official docs:
  - https://nodejs.org/api/fs.html
  - https://nodejs.org/api/process.html
  - https://nodejs.org/api/timers.html
- npm registry verification:
  - https://www.npmjs.com/package/typescript
  - https://www.npmjs.com/package/vitest
  - https://www.npmjs.com/package/zod
  - https://www.npmjs.com/package/execa
  - https://www.npmjs.com/package/@modelcontextprotocol/sdk
  - https://www.npmjs.com/package/commander
  - https://www.npmjs.com/package/yaml
  - https://www.npmjs.com/package/pino

### Secondary (MEDIUM confidence)
- Vitest official guide:
  - https://vitest.dev/guide/filtering.html

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - The phase stays on the repo's existing stack, and all runtime/package claims were verified in code or the npm registry.
- Architecture: MEDIUM - The durable-boundary and latest-run recommendations are strongly grounded in current code, but the exact accepted-path boundary with Phase 3 is still a planning choice.
- Pitfalls: HIGH - They are directly visible in current code paths and existing tests/concerns.

**Research date:** 2026-04-05
**Valid until:** 2026-05-05
