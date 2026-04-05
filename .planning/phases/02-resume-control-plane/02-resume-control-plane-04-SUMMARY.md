---
phase: 02-resume-control-plane
plan: 04
subsystem: locking
tags: [lockfile, lease, heartbeat, contention]
requires:
  - phase: 02-resume-control-plane
    provides: same-run recovery truth and latest-only selection
provides:
  - renewable lock leases with heartbeat renewal and grace-window stale detection
  - actionable active-owner errors with pid/run metadata when available
  - regression coverage for renewal, grace handling, and token mismatch protection
affects: [locking, run-service]
tech-stack:
  added: []
  patterns: [renewable lease, fail-fast contention, token-checked renewal]
key-files:
  created: []
  modified:
    - src/adapters/fs/lockfile.ts
    - src/app/services/run-cycle-service.ts
    - tests/lockfile-workspace-manager.test.ts
    - tests/run-cycle-service.test.ts
key-decisions:
  - "Stale takeover requires `ttl + grace` unless the owner PID is definitely gone."
  - "Lease renewal and release remain token-checked."
  - "RunCycleService owns the heartbeat lifecycle and stops it in a finally block."
patterns-established:
  - "Long-running work refreshes lease metadata instead of relying on a one-shot TTL."
  - "Active contention fails immediately with owner details instead of waiting."
requirements-completed: [RECV-04]
duration: 25min
completed: 2026-04-05
---

# Phase 2 Plan 04 Summary

**The fixed TTL lock is gone: active work now renews a lease heartbeat, stale takeover waits through a grace window, and live contention errors are explicit**

## Performance

- **Duration:** 25 min
- **Completed:** 2026-04-05
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Extended lock metadata with lease grace and owner details, and added `renewLock(...)` for token-checked heartbeats.
- Updated stale detection from `ttl` to `ttl + grace` while still allowing immediate takeover when the owner PID is gone.
- Added run-service heartbeat renewal and fail-fast active-owner messaging with actionable details.

## Task Commits

1. **Plan 04 execution** - local workspace changes only (not committed in this session)

## Files Created/Modified

- `src/adapters/fs/lockfile.ts` - Renewable lease metadata, renewal API, grace-window stale detection, and richer contention errors.
- `src/app/services/run-cycle-service.ts` - Service-owned heartbeat lifecycle around the run path.
- `tests/lockfile-workspace-manager.test.ts` - Renewal, grace-window, and token mismatch coverage.
- `tests/run-cycle-service.test.ts` - Active-owner contention regression coverage.

## Decisions Made

- Used `ttl/2` heartbeats with `unref()` so renewal does not pin the process.
- Kept contention fail-fast and local-first instead of adding wait/retry modes in Phase 2.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- The first lock refactor was functionally green but failed strict type checks around exact optional properties. The final version keeps the richer error metadata while satisfying the repo’s strict TypeScript settings.

## User Setup Required

None.

## Next Phase Readiness

- Long-running resume work no longer looks stale just because a fixed TTL elapsed.
- Promotion durability can now build on active-owner truth instead of a fragile five-minute race.

---
*Phase: 02-resume-control-plane*
*Completed: 2026-04-05*
