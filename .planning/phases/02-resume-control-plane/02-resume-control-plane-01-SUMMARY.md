---
phase: 02-resume-control-plane
plan: 01
subsystem: state
tags: [recovery, checkpoints, run-record, state-machine]
requires:
  - phase: 01-contract-truth-run-admission
    provides: truthful admission and baseline-aware execution
provides:
  - shared recovery classifications for idle, resumable, manual-review-blocked, and repair-required states
  - checkpoint-aligned run phases with a truthful pre-proposal boundary
  - regression coverage for ambiguous accepted-path evidence and manual review blocking
affects: [run-record, state-machine, recovery]
tech-stack:
  added: []
  patterns: [checkpoint-aligned phase model, shared recovery classifier]
key-files:
  created:
    - src/core/state/recovery-classifier.ts
  modified:
    - src/core/model/run-record.ts
    - src/core/state/run-state-machine.ts
    - tests/state-engines.test.ts
    - tests/json-stores.test.ts
key-decisions:
  - "Introduce a durable `started` checkpoint instead of pretending proposal work already exists."
  - "Keep `classifyRecovery(...)` strict with external evidence while leaving `recoverRun(run)` as a phase-only compatibility wrapper."
  - "Mark unresolved accepted-path ambiguity as `repair_required` instead of resumable."
patterns-established:
  - "Recovery truth is derived from shared state logic, not transport-specific sentinels."
  - "Persisted phase now means last durable boundary reached, with pendingAction as the replay-safe next step."
requirements-completed: [RECV-02, RECV-03]
duration: 35min
completed: 2026-04-05
---

# Phase 2 Plan 01 Summary

**Phase 2 now has a truthful checkpoint model and one shared recovery classifier instead of transport-only resume heuristics**

## Performance

- **Duration:** 35 min
- **Completed:** 2026-04-05
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `recovery-classifier.ts` with the four recovery classes Phase 2 needs: `idle`, `resumable`, `manual_review_blocked`, and `repair_required`.
- Introduced a durable `started` run phase plus `prepare_proposal` so proposal work is no longer implied before it exists.
- Extended state and store tests to lock in truthful checkpoint semantics and accepted-path ambiguity handling.

## Task Commits

1. **Plan 01 execution** - local workspace changes only (not committed in this session)

## Files Created/Modified

- `src/core/state/recovery-classifier.ts` - Shared recovery truth and pending-action derivation.
- `src/core/model/run-record.ts` - Added `started` and `prepare_proposal` checkpoint vocabulary.
- `src/core/state/run-state-machine.ts` - Uses the shared classifier/next-action model while preserving compatibility wrappers.
- `tests/state-engines.test.ts` - Covers the four recovery classes and stricter accepted-path ambiguity handling.
- `tests/json-stores.test.ts` - Locks in the new durable pre-proposal checkpoint.

## Decisions Made

- Kept recovery truth strict at the classifier boundary and compatibility-focused at the `recoverRun(run)` wrapper.
- Treated parallel in-flight runs as non-resumable in Phase 2 rather than pretending their current checkpoint story is safe.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- The first classifier implementation broke committed-phase compatibility in the legacy `recoverRun(run)` wrapper. The fix preserved strict service-layer recovery while keeping state-machine callers phase-oriented.

## User Setup Required

None.

## Next Phase Readiness

- Services and transports can now depend on one shared recovery vocabulary.
- Same-run resume can build on truthful checkpoint names instead of transport-only flags.

---
*Phase: 02-resume-control-plane*
*Completed: 2026-04-05*
