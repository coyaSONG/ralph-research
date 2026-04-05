# Phase 5: Regression Hardening Matrix - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase hardens the milestone by turning the highest-risk contract, recovery, and review behaviors into explicit automated regression coverage. It is primarily a test and verification phase. Production code changes are in scope only when new matrix coverage exposes a real gap or bug that would otherwise stay unprotected.

</domain>

<decisions>
## Implementation Decisions

### Coverage priorities
- **D-01:** Phase 5 prioritizes matrix coverage over new runtime surface area. The goal is to protect the contract that Phases 1 through 4 established, not to expand product scope.
- **D-02:** The matrix should target the boundaries most likely to regress: resume checkpoints, manifest admission parity, and frontier/manual-review truth after durable decisions.
- **D-03:** Coverage should use the existing temp-repo and persisted-store style instead of a new abstract test harness.

### Resume and contract hardening
- **D-04:** Same-`runId` resume needs explicit tests for later accepted-path checkpoints beyond the already covered `decision_written` boundary.
- **D-05:** Contract enforcement should be tested as a parity matrix across `validate`, `doctor`, and `run` for the unsupported manifest/runtime combinations that matter to this milestone.

### Frontier and review hardening
- **D-06:** Pareto frontier integrity needs explicit regression coverage for retained incumbents, especially commit-sha preservation when a new accepted run joins the frontier.
- **D-07:** Manual-review read-model truth should stay covered at both CLI and service layers so frontier materialization regressions are caught before release.

### Scope and deferrals
- **D-08:** This phase does not create new repair commands, new UI, or new transport surfaces.
- **D-09:** If matrix coverage reveals a new bug, fix it in the smallest way that restores the established runtime contract and keep the phase focused on hardening.

### the agent's Discretion
- The exact split of tests across service, CLI, and state-engine suites, as long as the recovery, contract, and review/frontier risks all get explicit automated coverage.
- Whether to add small fixture helpers when they materially reduce duplication in the new regression matrix.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and constraints
- `.planning/PROJECT.md` — Reliability-first milestone constraints.
- `.planning/REQUIREMENTS.md` — Phase 5 requirements `STAB-03`, `STAB-04`, and `STAB-05`.
- `.planning/ROADMAP.md` — Phase 5 goal and success criteria.
- `.planning/STATE.md` — Current milestone position after Phase 4 completion.

### Prior hardening work to protect
- `.planning/phases/01-contract-truth-run-admission/01-VERIFICATION.md`
- `.planning/phases/02-resume-control-plane/02-VERIFICATION.md`
- `.planning/phases/03-promotion-durability-frontier-persistence/03-VERIFICATION.md`
- `.planning/phases/04-manual-review-semantic-unification/04-VERIFICATION.md`

### Runtime and read-model code paths
- `src/app/services/run-cycle-service.ts` — Same-run resume entrypoint and admission/resume branching.
- `src/app/services/project-state-service.ts` — Shared post-decision read models.
- `src/core/state/recovery-classifier.ts` and `src/core/state/run-state-machine.ts` — Recovery checkpoint truth.
- `src/core/state/frontier-semantics.ts` and `src/core/state/frontier-materializer.ts` — Shared frontier behavior to protect.

### Existing regression suites
- `tests/run-cycle-service.test.ts` — Accepted-path durability and service-level resume coverage.
- `tests/state-engines.test.ts` — Recovery classification and frontier/ratchet unit coverage.
- `tests/validate-command.test.ts` — Validate surface contract checks.
- `tests/cli-commands.test.ts` — CLI integration, doctor/run parity, and manual-review coverage.
- `tests/project-state-service.test.ts` — Shared read-model recovery and manual-review truth coverage.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The repo already has temp-repo fixture builders for numeric, judge, and pareto-style manifests in the existing test suites.
- Manual-review and frontier helpers are now centralized, which makes regression protection more valuable and easier to target.
- Recovery classification is already modeled as deterministic pure logic and can support matrix-style tests with concise seeded records.

### Established Patterns
- The highest-value tests in this repo are repo-backed integration tests that hit real Git and filesystem behavior.
- Smaller unit/state tests are appropriate when the behavior is checkpoint classification or frontier comparison logic.

### Integration Points
- Resume matrix coverage should exercise `RunCycleService` and/or the recovery classifier across later accepted-path boundaries.
- Contract matrix coverage should compare `validate`, `doctor`, and `run` rather than treating them as unrelated surfaces.
- Frontier/review matrix coverage should protect both automated pareto retention and manual-review materialization.

</code_context>

<specifics>
## Specific Ideas

- Add accepted-path resume tests for `committed` and `frontier_updated` checkpoints, not just `decision_written`.
- Add parity coverage showing unsupported workspace and unsupported `operator_llm` manifests stay rejected consistently across the admission surfaces.
- Add a pareto accepted-path regression that verifies retained incumbents keep their own commit shas when a new accepted run joins the frontier.

</specifics>

<deferred>
## Deferred Ideas

- Coverage dashboards or generated reports beyond the normal Vitest suites.
- A new generalized test-fixture framework.
- New runtime behavior not required to preserve the milestone’s contract.

</deferred>

---

*Phase: 05-regression-hardening-matrix*
*Context gathered: 2026-04-05*
