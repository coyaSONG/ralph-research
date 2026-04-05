---
phase: 01-contract-truth-run-admission
plan: 02
subsystem: runtime
tags: [run-cycle, workspace, baseline, git, admission]
requires:
  - phase: 01-contract-truth-run-admission
    provides: shared manifest admission payloads and repo-aware baseline resolution
provides:
  - run-path admission before lock and storage mutation
  - baseline-aware git worktree creation using the admitted ref
  - regression coverage for fail-fast unsupported manifests and non-HEAD baselines
affects: [doctor, validate, run, workspace]
tech-stack:
  added: []
  patterns: [pre-lock admission, resolved baseline propagation]
key-files:
  created: []
  modified:
    - src/adapters/fs/manifest-loader.ts
    - src/app/services/run-cycle-service.ts
    - src/core/engine/cycle-runner.ts
    - src/core/engine/workspace-manager.ts
    - tests/run-cycle-service.test.ts
    - tests/lockfile-workspace-manager.test.ts
key-decisions:
  - "RunCycleService reuses loader admission before lock acquisition."
  - "Resolved baseline refs are threaded into run records and workspace creation."
  - "Rejected admission paths must leave no lock, run store, or workspace side effects."
patterns-established:
  - "Destructive execution starts only after repo-aware manifest admission passes."
  - "Workspace creation accepts the admitted baseline ref instead of assuming HEAD."
requirements-completed: [CONT-02]
duration: 25min
completed: 2026-04-05
---

# Phase 1 Plan 02 Summary

**Run execution now fails fast on unsupported manifests and creates workspaces from the admitted baseline commit instead of always using HEAD**

## Performance

- **Duration:** 25 min
- **Completed:** 2026-04-05
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Moved repo-aware manifest admission ahead of lock acquisition and storage setup in `RunCycleService`.
- Threaded the resolved baseline ref into cycle execution and stored the actual starting ref on the run record.
- Proved both no-side-effect rejection paths and non-HEAD baseline worktree behavior with integration coverage.

## Task Commits

1. **Plan 02 execution** - `2e981ef` (`feat(01-02): honor admitted baselines in run path`)

## Files Created/Modified

- `src/app/services/run-cycle-service.ts` - Runs shared admission before lock and execution setup.
- `src/core/engine/workspace-manager.ts` - Creates worktrees from the admitted baseline ref.
- `src/core/engine/cycle-runner.ts` - Threads resolved baseline refs through candidate execution and run records.
- `tests/run-cycle-service.test.ts` - Covers unsupported manifests and non-HEAD baseline execution.
- `tests/lockfile-workspace-manager.test.ts` - Covers direct baseline-aware workspace creation.

## Decisions Made

- Kept manifest admission centralized in the loader path instead of recompiling rules inside `RunCycleService`.
- Stored the resolved baseline commit on the run record so execution truth matches the actual workspace origin.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- The first non-HEAD baseline fixture tagged a commit that did not yet contain the proposer and metric scripts, so the workspace started from a truthful baseline but could not execute. The fixture was corrected so the tagged baseline is both historical and runnable.

## User Setup Required

None.

## Next Phase Readiness

- `run` now enforces the same baseline truth as admission, so CLI preflight can reuse that path instead of inventing a separate check.
- Phase 03 can focus on surfacing the same executable-vs-blocked answer through `validate` and `doctor`.

---
*Phase: 01-contract-truth-run-admission*
*Completed: 2026-04-05*
