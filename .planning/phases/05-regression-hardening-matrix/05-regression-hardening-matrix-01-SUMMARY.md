---
phase: 05-regression-hardening-matrix
plan: 01
subsystem: recovery
tags: [resume, recovery, checkpoints]
requires:
  - phase: 02-resume-control-plane
    provides: checkpointed same-run recovery
  - phase: 03-promotion-durability-frontier-persistence
    provides: materialized frontier and durable accepted-path state
provides:
  - late accepted-path resume regression coverage
  - updated recovery classification for committed checkpoints under frontier materialization
affects: [run-cycle-service, recovery-classifier, state-engines]
tech-stack:
  added: []
  patterns: [resume-boundary matrix, materialized-frontier-aware recovery]
key-files:
  created: []
  modified:
    - src/core/state/recovery-classifier.ts
    - tests/run-cycle-service.test.ts
    - tests/state-engines.test.ts
key-decisions:
  - "Committed checkpoints remain resumable even when frontier materialization already includes the accepted run."
patterns-established:
  - "Resume coverage now explicitly protects `committed` and `frontier_updated` boundaries."
requirements-completed: [STAB-03]
duration: 30min
completed: 2026-04-05
---

# Phase 5 Plan 01 Summary

**Late accepted-path resume boundaries are now protected by regression coverage**

## Accomplishments

- Added service-level resume tests for `committed` and `frontier_updated` accepted checkpoints.
- Added a state-engine regression test for `frontier_updated -> cleanup_workspace`.
- Fixed recovery classification so `committed` runs are no longer misclassified as `repair_required` just because frontier materialization can already reconstruct accepted membership.

## Files Modified

- `src/core/state/recovery-classifier.ts`
- `tests/run-cycle-service.test.ts`
- `tests/state-engines.test.ts`

## Notes

- This plan uncovered a real post-Phase-3 bug: materialized frontier state made committed checkpoints look contradictory even though same-`runId` resume should still be allowed. The recovery rule now matches the durable model.

---
*Phase: 05-regression-hardening-matrix*
*Completed: 2026-04-05*
