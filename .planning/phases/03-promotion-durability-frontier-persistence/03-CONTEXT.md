# Phase 3: Promotion Durability & Frontier Persistence - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase hardens the accepted path after a run is already judged `accepted`. It makes promotion replay from durable artifacts instead of ad hoc filesystem copying, and it makes frontier reads rebuildable from durable run and decision records instead of trusting `frontier.json` as the only source of truth. It does not add a user-facing repair command surface, manual-review semantic changes, or broader repo-policy controls.

</domain>

<decisions>
## Implementation Decisions

### Promotion durability
- **D-01:** Accepted runs should persist a durable promotion artifact before the run advances to `decision_written` with `status=accepted`.
- **D-02:** The durable promotion artifact should be a Git patch plus explicit changed-path metadata, because that gives both replayability and a bounded commit scope.
- **D-03:** Promotion replay should be patch-driven and idempotent. If the patch is already applied when a run resumes, the runtime should commit from the durable record instead of failing or copying files again.
- **D-04:** Phase 3 should remove the current file-by-file promotion path for automated acceptance rather than keep two competing semantics alive.

### Frontier persistence
- **D-05:** Durable run and decision records become the authoritative source for the frontier; `frontier.json` is a materialized snapshot that may be rebuilt.
- **D-06:** Rebuild should derive the frontier by replaying accepted decisions in order through the existing frontier update logic, not by trusting stale `afterFrontierIds`.
- **D-07:** When `frontier.json` is missing, corrupt, or stale, runtime services should self-heal by rebuilding and rewriting it.

### Scope and deferrals
- **D-08:** User-facing repair commands remain out of scope for this phase. Automatic replay/self-healing from durable records is sufficient.
- **D-09:** Manual accept/reject semantics stay deferred to Phase 4, but new durability primitives should be reusable there.
- **D-10:** Repo-policy hooks, branch-based promotion, and non-Git backends remain deferred.

### the agent's Discretion
- The exact shape of the persisted promotion metadata, as long as it captures a replayable patch and bounded changed paths.
- The exact helper/module boundaries for frontier rebuild, as long as services and run execution reuse one authoritative materialization path.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and constraints
- `.planning/PROJECT.md` — Brownfield constraints and the requirement to prefer truthful narrower behavior over misleading surface area.
- `.planning/REQUIREMENTS.md` — Phase 3 requirements `STAB-01` and `STAB-02`.
- `.planning/ROADMAP.md` — Phase 3 goal and success criteria.
- `.planning/STATE.md` — The milestone state and the explicit open question about durable promotion evidence.
- `.planning/phases/02-resume-control-plane/02-CONTEXT.md` — Phase 2 recovery decisions that Phase 3 must build on instead of bypassing.

### Risk framing and prior concerns
- `.planning/codebase/CONCERNS.md` — Existing findings on non-transactional accepted-path persistence, fragile workspace promotion, and frontier snapshot trust.
- `docs/knowledge/decision-2026-03-29-four-defense-lines.md` — Existing transaction-safety direction that calls for recoverable state and crash-safe replay.

### Promotion and frontier code paths
- `src/core/engine/cycle-runner.ts` — Accepted-path orchestration, current promotion sequence, and frontier save timing.
- `src/core/engine/workspace-manager.ts` — Current file-by-file promotion implementation that Phase 3 should replace for automated acceptance.
- `src/adapters/git/git-client.ts` — Current path staging and commit behavior.
- `src/core/state/frontier-engine.ts` — Authoritative frontier update logic that rebuild must reuse.
- `src/app/services/run-cycle-service.ts` — Current run entrypoint and frontier loading path.
- `src/app/services/project-state-service.ts` — Status, inspect, and frontier read models that should self-heal from durable records.
- `src/adapters/fs/json-file-frontier-store.ts` — Snapshot persistence boundary for `frontier.json`.

### Existing regression coverage
- `tests/run-cycle-service.test.ts` — End-to-end run-path coverage for accepted, rejected, and resumable runs.
- `tests/state-engines.test.ts` — Recovery classification and frontier logic unit coverage.
- `tests/project-state-service.test.ts` — Read-model recovery truth tests that can be extended for frontier rebuild behavior.
- `tests/cli-commands.test.ts` — CLI frontier/status/inspect integration coverage.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `proposal.patchPath` already exists in `RunRecord`, so Phase 3 can persist a promotion patch without inventing a second artifact field for the same concept.
- `updateSingleBestFrontier()` and `updateParetoFrontier()` already compute the authoritative frontier mutation. Rebuild should replay those functions rather than duplicate policy logic.
- `classifyRecovery()` already distinguishes truthful resume from repair-required states. Phase 3 can tighten accepted-path evidence checks instead of adding a parallel recovery model.

### Established Patterns
- Run execution already persists durable checkpoints step-by-step; promotion durability should extend that same pattern instead of introducing a separate transaction subsystem.
- Application services own read models shared by CLI and MCP surfaces; frontier self-healing should happen there or below, not in transport code.
- The repo prefers regression tests around real temp repos, filesystem stores, and Git behavior instead of mocks for critical runtime paths.

### Integration Points
- The accepted path in `cycle-runner` needs a durable promotion artifact before the run claims `decision_written` as an accepted checkpoint.
- `GitClient` needs a patch replay helper that can detect "already applied" vs genuinely divergent repo state.
- Frontier loading in run and read-model services should materialize from durable records and rewrite `frontier.json` when needed.

</code_context>

<specifics>
## Specific Ideas

- The current file copy/delete promotion path is the weakest part of the accepted flow because it can leave a half-promoted working tree before any durable commit evidence exists.
- A Git patch is a better promotion unit than direct copying because it can be persisted, validated, replayed, and detected as already-applied.
- `frontier.json` should become a cache, not the only source of truth, because the repo already stores enough accepted-run evidence to rebuild it.

</specifics>

<deferred>
## Deferred Ideas

- A dedicated `rrx repair` CLI command.
- Manual-review parity work for human accept/reject flows.
- Branch-based promotion or repository policy adapters.

</deferred>

---

*Phase: 03-promotion-durability-frontier-persistence*
*Context gathered: 2026-04-05*
