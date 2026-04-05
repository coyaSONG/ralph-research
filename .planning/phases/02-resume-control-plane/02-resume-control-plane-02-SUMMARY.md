---
phase: 02-resume-control-plane
plan: 02
subsystem: run-path
tags: [run-cycle, resume, fresh, cli]
requires:
  - phase: 02-resume-control-plane
    provides: checkpoint-aligned recovery truth
provides:
  - latest-only same-run resume on plain `rrx run`
  - `--fresh` opt-out for new-run creation
  - regression coverage for repair-required latest-run warnings and runId preservation
affects: [run, cycle-runner, resume]
tech-stack:
  added: []
  patterns: [same-run checkpoint dispatcher, latest-only recovery selection]
key-files:
  created:
    - tests/run-command.test.ts
  modified:
    - src/core/engine/cycle-runner.ts
    - src/app/services/run-cycle-service.ts
    - src/cli/commands/run.ts
    - tests/run-cycle-service.test.ts
key-decisions:
  - "Plain `rrx run` auto-resumes the latest recoverable run; `--fresh` is the only new-run override."
  - "Repair-required latest runs warn and start fresh instead of forcing an override flag."
  - "The engine only resumes command-proposer runs truthfully in Phase 2; parallel in-flight runs are blocked for later hardening."
patterns-established:
  - "Checkpoint replay lives in the engine, not in service/CLI special cases."
  - "Latest-only recovery selection is a service concern layered over the shared classifier."
requirements-completed: [RECV-01, RECV-02]
duration: 55min
completed: 2026-04-05
---

# Phase 2 Plan 02 Summary

**`rrx run` now resumes the latest safe checkpoint on the same runId by default, with `--fresh` as the explicit escape hatch**

## Performance

- **Duration:** 55 min
- **Completed:** 2026-04-05
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Reworked `cycle-runner.ts` into a checkpoint-driven command-proposer replay path that can continue from proposal, experiment, evaluation, decision, commit, and frontier boundaries.
- Replaced the old `resume_required` transport contract with service-level auto-resume, repair-required warning-plus-fresh-start behavior, and `--fresh`.
- Added focused CLI coverage that seeds persisted recoverable and repair-required runs directly and proves same-run resume versus fresh-run creation.

## Task Commits

1. **Plan 02 execution** - local workspace changes only (not committed in this session)

## Files Created/Modified

- `src/core/engine/cycle-runner.ts` - Command-proposer checkpoint dispatcher and same-run replay logic.
- `src/app/services/run-cycle-service.ts` - Latest-only recovery selection, auto-resume, and repair-required warning behavior.
- `src/cli/commands/run.ts` - `--fresh` replaces `--resume`, and warnings surface to the operator.
- `tests/run-command.test.ts` - Covers auto-resume, `--fresh`, and repair-required latest-run warnings.
- `tests/run-cycle-service.test.ts` - Locks in run-path behavior against live file-backed repos.

## Decisions Made

- Preserved current parallel fresh-run behavior while explicitly refusing to invent a truthful parallel resume story in Phase 2.
- Kept latest-only semantics hard: older resumable runs remain ignored once the latest run is repair-required.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- The engine refactor had to preserve the current acceptance path for fresh runs while layering in replay-safe checkpoints. Existing run/CLI tests were kept green throughout to prevent regression.

## User Setup Required

None.

## Next Phase Readiness

- Operators now have a truthful same-run recovery contract.
- Read-only surfaces can project the same recovery truth without inventing transport-specific labels.

---
*Phase: 02-resume-control-plane*
*Completed: 2026-04-05*
