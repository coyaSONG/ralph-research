---
phase: 03-promotion-durability-frontier-persistence
plan: 02
subsystem: frontier
tags: [frontier, materialization, rebuild, self-heal]
requires:
  - phase: 03-promotion-durability-frontier-persistence
    plan: 01
    provides: durable accepted-path commit evidence
provides:
  - frontier rebuild from durable run and decision records
  - snapshot self-healing when `frontier.json` is missing or stale
  - one authoritative frontier materialization path for run execution and read models
affects: [frontier, status, inspect, run-service, cli]
tech-stack:
  added: []
  patterns: [materialized snapshot, authoritative rebuild]
key-files:
  created:
    - src/core/state/frontier-materializer.ts
  modified:
    - src/adapters/fs/json-file-frontier-store.ts
    - src/app/services/run-cycle-service.ts
    - src/app/services/project-state-service.ts
    - tests/project-state-service.test.ts
    - tests/run-cycle-service.test.ts
    - tests/cli-commands.test.ts
key-decisions:
  - "Treat `frontier.json` as a cache/materialized snapshot instead of the primary truth source."
  - "Rebuild frontier state by replaying accepted decisions through the existing frontier engine."
  - "Keep a legacy snapshot fallback only when no durable accepted history exists yet."
patterns-established:
  - "Services materialize frontier state from durable records and rewrite stale snapshots automatically."
  - "Frontier rebuild and live acceptance share the same update logic."
requirements-completed: [STAB-02]
duration: 40min
completed: 2026-04-05
---

# Phase 3 Plan 02 Summary

**Frontier state is now rebuildable from durable records and self-heals when the snapshot drifts**

## Performance

- **Duration:** 40 min
- **Completed:** 2026-04-05
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added a frontier materializer that rebuilds accepted frontier state from run and decision records using the same frontier engine used during live execution.
- Switched run execution, status, inspect, and frontier reads to consume that authoritative materialized frontier.
- Added snapshot self-healing so missing or stale `frontier.json` files are rewritten automatically from durable records.
- Made frontier snapshot saves atomic by writing through a temp file and rename.

## Task Commits

1. **Plan 02 execution** - local workspace changes only (not committed in this session)

## Files Created/Modified

- `src/core/state/frontier-materializer.ts` - Rebuilds and reconciles frontier state from accepted run/decision records.
- `src/adapters/fs/json-file-frontier-store.ts` - Uses atomic temp-file writes for snapshot durability.
- `src/app/services/run-cycle-service.ts` - Uses materialized frontier state before starting or resuming a run.
- `src/app/services/project-state-service.ts` - Uses the same materialized frontier for status, inspect, and frontier surfaces.
- `tests/project-state-service.test.ts` - Covers missing and stale snapshot rebuild behavior.
- `tests/run-cycle-service.test.ts` - Proves new runs evaluate against rebuilt incumbents when the snapshot is gone.
- `tests/cli-commands.test.ts` - Proves `rrx frontier` self-heals from durable records.

## Decisions Made

- Added a legacy fallback for snapshot-only history so older data is not discarded when there are no durable accepted decisions yet.
- Ignored `acceptedAt` drift when comparing snapshots to rebuilt state, because rebuild truth is driven by run/decision identity and commit evidence.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- Rebuild initially erased legacy snapshot-only incumbents in tests that seeded frontier data without accepted decisions. The fix kept a snapshot fallback only when no durable accepted history exists yet.

## User Setup Required

None.

## Next Phase Readiness

- Manual-review acceptance can now rely on a single authoritative frontier materialization path.
- Regression hardening can treat missing or stale `frontier.json` as a covered failure mode.

---
*Phase: 03-promotion-durability-frontier-persistence*
*Completed: 2026-04-05*
