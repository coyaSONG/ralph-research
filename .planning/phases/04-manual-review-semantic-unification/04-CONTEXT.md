# Phase 4: Manual Review Semantic Unification - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase hardens the human review path after a run has already reached `status=needs_human`. It aligns manual accept and reject behavior with the durable promotion, frontier-update, and read-model semantics already established for automated runs. It does not add a new review UI, new MCP review tools, or a separate repair command surface.

</domain>

<decisions>
## Implementation Decisions

### Manual acceptance semantics
- **D-01:** Manual accept must materialize the current frontier from durable run and decision records before it decides how the newly accepted run changes frontier membership.
- **D-02:** Manual accept must use the same accepted-frontier entry shape and the same `single_best` / `pareto` update logic as automated acceptance. It must not overwrite `frontier.json` with a bespoke one-entry snapshot.
- **D-03:** Manual accept must promote through the same durable patch-and-changed-path semantics as automation. Because `needs_human` runs do not already carry a promotion patch, the manual path must create and persist that artifact before the run advances past the decision boundary.
- **D-04:** The timestamp that matters for frontier replay is the human resolution time, not the earlier `needs_human` checkpoint time. Manual finalization should therefore rewrite `decision.createdAt` to the human decision time.

### Manual reject and recovery truth
- **D-05:** Manual reject leaves frontier membership unchanged, but it must still record truthful `beforeFrontierIds` and `afterFrontierIds` against the materialized frontier.
- **D-06:** Manual accept and manual reject should advance the run through the same checkpoint vocabulary (`decision_written`, `committed`, `frontier_updated`, `completed`) that the recovery model already understands, instead of jumping directly from `needs_human` to `completed`.
- **D-07:** If manual review fails after the decision is finalized but before cleanup completes, the existing resume/read-model logic should see truthful state instead of a partially updated bespoke manual-review record.

### Scope and deferrals
- **D-08:** Manual review stays a CLI-only workflow in this milestone; richer review UX and transport expansion remain deferred.
- **D-09:** This phase may introduce shared helpers for accepted-frontier semantics and promotion artifact persistence if that is the cleanest way to remove duplication between automated and manual paths.
- **D-10:** Cross-phase regression hardening beyond the manual-review surface itself remains Phase 5 work.

### the agent's Discretion
- The exact helper boundaries for shared frontier and promotion semantics, as long as manual and automated acceptance use one authoritative implementation path.
- The exact test split between service, project-state, and CLI integration coverage, as long as `single_best`, `pareto`, accept, reject, and post-decision read-model truth are all covered.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and constraints
- `.planning/PROJECT.md` — Brownfield constraints and the reliability-first contract for this milestone.
- `.planning/REQUIREMENTS.md` — Phase 4 requirements `REVW-01` through `REVW-04`.
- `.planning/ROADMAP.md` — Phase 4 goal and success criteria.
- `.planning/STATE.md` — Current milestone state and explicit open concern about manual-review divergence.
- `.planning/phases/03-promotion-durability-frontier-persistence/03-CONTEXT.md` — Phase 3 durability decisions that manual review must now reuse.

### Existing concerns and state contracts
- `.planning/codebase/CONCERNS.md` — Existing findings on manual frontier corruption and post-decision inconsistency risk.
- `src/core/state/run-state-machine.ts` — Shared run checkpoint semantics that manual review should align with.
- `src/core/state/recovery-classifier.ts` — Read-model recovery truth that should stay accurate after manual decisions.

### Manual-review and frontier code paths
- `src/app/services/manual-decision-service.ts` — Current manual accept/reject implementation with divergent promotion and frontier behavior.
- `src/core/engine/cycle-runner.ts` — Automated acceptance semantics to match for checkpointing, durable promotion, and frontier updates.
- `src/core/engine/workspace-manager.ts` — Promotion bundle generation from worktree state.
- `src/adapters/git/git-client.ts` — Durable patch replay and bounded commit behavior.
- `src/core/state/frontier-materializer.ts` — Authoritative frontier rebuild and self-healing path for read models.
- `src/app/services/project-state-service.ts` — Shared `status`, `frontier`, and `inspect` read models that must remain consistent after manual review.

### Existing regression coverage
- `tests/cli-commands.test.ts` — Current CLI coverage, including the existing single-best manual accept case.
- `tests/project-state-service.test.ts` — Read-model recovery and frontier materialization coverage.
- `tests/run-cycle-service.test.ts` — End-to-end automated accepted-path coverage that manual review should now mirror semantically.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 3 already introduced durable patch replay and a frontier materializer; manual review should reuse those primitives rather than recreate similar logic inside the service layer.
- `DecisionRecord.beforeFrontierIds`, `afterFrontierIds`, and `createdAt` are already the durable explainability fields needed for truthful manual-review events.
- `advanceRunPhase()` can move a manually reviewed run through the same recovery checkpoints automation uses.

### Established Patterns
- The repo prefers read models built from durable stores instead of trusting snapshots or transport-local state.
- Critical behavior is tested through temp Git repos and filesystem stores rather than heavy mocking.
- Application services own orchestration; CLI commands stay thin wrappers.

### Integration Points
- Manual accept needs a durable promotion artifact persisted under the run directory before the service can commit and/or leave a resumable checkpoint.
- Manual reject should keep `frontier.json` untouched except when the shared materializer repairs it from durable records.
- `status`, `frontier`, and `inspect` should continue to converge through `materializeFrontier()` after manual decisions.

</code_context>

<specifics>
## Specific Ideas

- The simplest way to guarantee semantic parity is to centralize accepted-frontier entry construction and frontier update logic in a shared helper used by automated acceptance, manual acceptance, and frontier rebuild.
- Manual accept should update the same decision record from `needs_human` to `accepted` at the time of human resolution, then let the existing commit/frontier checkpoint model do the rest.
- Manual reject should likewise finalize the decision at human-resolution time, then use the same checkpoint vocabulary to finish cleanup without inventing a separate state model.

</specifics>

<deferred>
## Deferred Ideas

- Rich review UI or TUI flows.
- MCP tools for manual accept/reject.
- Dedicated repair commands for partially completed manual reviews.

</deferred>

---

*Phase: 04-manual-review-semantic-unification*
*Context gathered: 2026-04-05*
