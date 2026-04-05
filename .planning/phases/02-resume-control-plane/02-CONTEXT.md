# Phase 2: Resume Control Plane - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase makes interrupted runs truthfully recoverable on the same `runId`, exposes whether a run is resumable, blocked for manual review, or in need of repair, and prevents stale lock handling from letting a second process take over active work incorrectly. It does not add broader repair tooling, arbitrary historical run selection, or new manual-review semantics beyond truthful status/reporting.

</domain>

<decisions>
## Implementation Decisions

### Resume trigger and selection
- **D-01:** Plain `rrx run` should auto-resume when the latest run is recoverable; otherwise it should start a fresh run.
- **D-02:** `rrx run --fresh` should always start a fresh run and opt out of auto-resume.
- **D-03:** Auto-resume should always target the latest recoverable run only. Older interrupted runs are ignored by default.
- **D-04:** Phase 2 should not add arbitrary `runId` resume targeting. Resume scope stays latest-only for now.

### Recovery truth surface
- **D-05:** `rrx status` should expose a high-level recovery classification plus the next action, not just raw phase/status fields.
- **D-06:** `rrx inspect <runId>` should expose a dedicated recovery section with `classification`, `nextAction`, `reason`, and `resumeAllowed`.
- **D-07:** Detailed repair evidence taxonomy is out of scope for this phase; a truthful reason string is sufficient.

### Legacy and ambiguous partial runs
- **D-08:** Partial runs missing durable recovery evidence must not be resumed by guesswork. They should be classified as `repair_required`.
- **D-09:** If the latest run is `repair_required`, plain `rrx run` should print a warning and start a fresh run rather than force an explicit override.
- **D-10:** Even when an older run is still recoverable, the runtime should not search backward past a `repair_required` latest run. The latest-only rule remains in force.

### Lock lease behavior
- **D-11:** Active ownership should use heartbeat/lease renewal that refreshes lock metadata during long-running work.
- **D-12:** Stale-lock takeover should require a grace window after TTL expiry rather than treating the first missed heartbeat as stale.
- **D-13:** When another process holds an active lease, default `rrx run` behavior should fail immediately with actionable lock-owner details instead of waiting.

### the agent's Discretion
- The exact naming of recovery classifications, as long as they clearly distinguish resumable, manual-review-blocked, repair-required, and idle states.
- The exact heartbeat cadence and grace-window constants, as long as they preserve short stale detection after crashes without causing false-positive takeover during healthy long runs.
- The exact warning and error message wording, as long as it stays operationally explicit for the primary user.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and project constraints
- `.planning/PROJECT.md` — Core value, brownfield constraints, and the requirement that truthful runtime behavior matters more than preserving misleading surface area.
- `.planning/REQUIREMENTS.md` — Phase 2 requirements `RECV-01`, `RECV-02`, `RECV-03`, and `RECV-04`.
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria, and milestone sequencing.
- `.planning/STATE.md` — Current milestone position and existing planning concerns that should stay consistent with this phase.
- `.planning/phases/01-contract-truth-run-admission/01-CONTEXT.md` — Prior-phase contract-truth decisions that constrain recovery behavior to stay explicit rather than best-effort.

### Architecture and risk framing
- `.planning/codebase/ARCHITECTURE.md` — Service, engine, and adapter boundaries that recovery and status changes should fit into.
- `.planning/codebase/CONCERNS.md` — Current evidence for false resume claims, stale lock fragility, and missing recovery coverage.
- `.planning/codebase/TESTING.md` — Existing Vitest integration patterns that phase 2 regression coverage should follow.
- `docs/knowledge/decision-2026-03-29-four-defense-lines.md` — Existing transaction-safety direction: recoverable state machine, idempotent phase transitions, and crash resume as a first-class defense line.

### Resume and status code paths
- `src/app/services/run-cycle-service.ts` — Current `run` entrypoint, lock acquisition, and false `resume_required` behavior.
- `src/core/state/run-state-machine.ts` — Existing recovery-plan model, resumability decisions, and phase-to-action mapping.
- `src/core/model/run-record.ts` — Persisted run shape and the durable fields recovery depends on.
- `src/app/services/project-state-service.ts` — `status` and `inspect` read-model surfaces that need truthful recovery output.
- `src/cli/commands/run.ts` — Current CLI contract for `rrx run` and `--resume`.
- `src/mcp/server.ts` — MCP run/status transport that should stay semantically aligned with the CLI.

### Locking and accepted-path recovery boundaries
- `src/adapters/fs/lockfile.ts` — Current fixed-TTL lock behavior and stale detection semantics.
- `src/core/engine/cycle-runner.ts` — Current run creation path, accepted-path phase transitions, and persisted interruption boundaries.
- `tests/state-engines.test.ts` — Existing recovery-plan assertions for later phases like `decision_written` and `committed`.
- `tests/run-cycle-service.test.ts` — Existing run-service integration tests that phase 2 should extend with true resume behavior and interruption cases.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `recoverRun()` and `canResume()` in `src/core/state/run-state-machine.ts`: Existing recovery classification primitives that can be expanded into truthful control-plane behavior rather than replaced.
- `advanceRunPhase()` in `src/core/state/run-state-machine.ts`: Existing idempotent phase transition helper suitable for resumable step execution.
- `RunCycleService` in `src/app/services/run-cycle-service.ts`: Current admission and lock boundary where auto-resume/latest-run selection logic should live.
- `getProjectStatus()` and `inspectRun()` in `src/app/services/project-state-service.ts`: Existing read-model surfaces that can expose recovery truth without inventing new transport commands.
- `acquireLock()`, `isStaleLock()`, and `readLockMetadata()` in `src/adapters/fs/lockfile.ts`: Existing lease primitives that can be extended with heartbeat renewal and grace-window semantics.

### Established Patterns
- The runtime already persists run progress incrementally by phase and pending action rather than keeping recovery state only in memory.
- CLI and MCP transports are thin wrappers over application services; recovery truth should be implemented in services/state code and reused by both surfaces.
- The codebase prefers explicit failure over silent fallback, and prior phase context requires ambiguous behavior to be labeled or rejected rather than guessed.
- Integration tests use real temp repos, real filesystem stores, and real Git behavior; recovery work should follow that pattern instead of relying on mocks only.

### Integration Points
- `RunCycleService.run()` needs to shift from “latest run blocks fresh work unless `--resume`” to “plain run resumes latest recoverable, `--fresh` opts out, `repair_required` warns then starts fresh.”
- The run state machine and persisted `RunRecord` shape need enough durable truth to distinguish resumable, repair-required, and manual-review-blocked runs without guesswork.
- `status` and `inspect` should become the authoritative operational surfaces for recovery classification and next-action reporting.
- Lock renewal must integrate with long-running proposal, experiment, evaluation, and accepted-path steps without breaking current lock acquisition/release call sites.
- Recovery regression tests need to cover interruption during proposal, experiment, evaluation, decision writing, commit, frontier update, and active-lock timing behavior.

</code_context>

<specifics>
## Specific Ideas

- The user wants the control plane to stay predictable: `rrx run` should mean “resume latest if truthfully recoverable, otherwise start fresh.”
- The user explicitly prefers “always latest” semantics over searching older interrupted runs, because starting a newer run is treated as an implicit abandonment signal for older ones.
- The desired operator-facing lock failure is explicit and actionable, for example an error that includes the active `runId`, PID, and recent heartbeat age.
- `status` should be concise and operational, while `inspect` should be the full diagnostic surface.

</specifics>

<deferred>
## Deferred Ideas

- Arbitrary `runId` resume targeting such as `rrx run --run-id <id>` — intentionally deferred until latest-only recovery is proven and a real use case exists.
- Rich repair tooling or structured missing-evidence taxonomies — belongs to later repair/promotion hardening work, not this first truthful resume control plane.
- Wait/retry lock contention modes such as `--wait` — possible future interface extension, but not needed for Phase 2.

</deferred>

---

*Phase: 02-resume-control-plane*
*Context gathered: 2026-04-05*
