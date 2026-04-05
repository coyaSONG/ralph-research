---
phase: 03-promotion-durability-frontier-persistence
plan: 01
subsystem: promotion
tags: [promotion, durability, patch-replay, recovery]
requires:
  - phase: 02-resume-control-plane
    provides: truthful accepted-path checkpoints and same-run resume
provides:
  - durable promotion patches persisted before accepted checkpoints advance
  - automated commit replay that can continue when the patch is already applied
  - stricter recovery truth for accepted checkpoints missing promotion evidence
affects: [workspace-manager, git-client, cycle-runner, recovery]
tech-stack:
  added: []
  patterns: [patch-driven promotion, idempotent replay]
key-files:
  created: []
  modified:
    - src/core/engine/workspace-manager.ts
    - src/adapters/git/git-client.ts
    - src/core/engine/cycle-runner.ts
    - src/core/state/recovery-classifier.ts
    - tests/run-cycle-service.test.ts
    - tests/state-engines.test.ts
key-decisions:
  - "Persist promotion as a durable Git patch before `decision_written` claims an accepted checkpoint."
  - "Replay promotion through Git patch application instead of copying files directly from the workspace."
  - "Treat accepted checkpoints without a promotion patch as `repair_required`."
patterns-established:
  - "Promotion replay is patch-driven and can detect already-applied state."
  - "Accepted-path recovery depends on durable promotion artifacts, not just a surviving workspace."
requirements-completed: [STAB-01]
duration: 55min
completed: 2026-04-05
---

# Phase 3 Plan 01 Summary

**Automated acceptance now promotes through a durable patch bundle instead of ad hoc workspace copying**

## Performance

- **Duration:** 55 min
- **Completed:** 2026-04-05
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added workspace-manager support for building a durable promotion bundle from the current repo tree and candidate workspace.
- Added Git patch replay that can continue cleanly when the patch is already applied but the commit has not happened yet.
- Updated the cycle runner to persist `proposal.patchPath` before accepted checkpoints advance and to commit from durable changed-path metadata.
- Tightened recovery classification so accepted checkpoints without a durable patch are no longer treated as safe to resume.

## Task Commits

1. **Plan 01 execution** - local workspace changes only (not committed in this session)

## Files Created/Modified

- `src/core/engine/workspace-manager.ts` - Added durable promotion bundle preparation against the current repo tree.
- `src/adapters/git/git-client.ts` - Added patch replay with apply-needed vs already-applied detection.
- `src/core/engine/cycle-runner.ts` - Persisted promotion patches before `decision_written` and replayed commits from durable patch metadata.
- `src/core/state/recovery-classifier.ts` - Requires a durable patch for accepted decision checkpoints.
- `tests/run-cycle-service.test.ts` - Covers persisted patch artifacts, workspace-free replay, and non-HEAD baseline promotion.
- `tests/state-engines.test.ts` - Covers accepted checkpoints that must now fail recovery without a durable patch.

## Decisions Made

- Generated promotion patches against the current repo state so non-`HEAD` baselines still promote correctly.
- Kept the manual-review path deferred; only automated acceptance switched to patch-driven replay in this plan.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- Baseline-aware workspaces initially failed because a baseline-relative patch would not apply cleanly to the current repo tree. The fix was to build the durable patch from a temporary repo-vs-candidate diff instead of workspace `HEAD`.

## User Setup Required

None.

## Next Phase Readiness

- Manual review can now reuse the same durable patch and changed-path metadata instead of keeping a separate promotion path.
- Frontier durability work can treat accepted decisions as replayable events because commit evidence is now stable.

---
*Phase: 03-promotion-durability-frontier-persistence*
*Completed: 2026-04-05*
