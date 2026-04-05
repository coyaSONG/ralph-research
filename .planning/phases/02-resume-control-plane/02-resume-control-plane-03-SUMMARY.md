---
phase: 02-resume-control-plane
plan: 03
subsystem: read-models
tags: [status, inspect, mcp, recovery]
requires:
  - phase: 02-resume-control-plane
    provides: shared recovery classifier and same-run resume truth
provides:
  - shared recovery payloads for status, inspect, and MCP
  - dedicated recovery sections in inspect/json surfaces
  - parity tests across service, CLI, and MCP transports
affects: [status, inspect, mcp, project-state]
tech-stack:
  added: []
  patterns: [shared recovery payload, transport parity]
key-files:
  created:
    - tests/project-state-service.test.ts
    - tests/status-inspect-command.test.ts
    - tests/mcp-server.test.ts
  modified:
    - src/app/services/project-state-service.ts
    - src/cli/commands/status.ts
    - src/cli/commands/inspect.ts
    - src/mcp/server.ts
key-decisions:
  - "Recovery payload lives in the service layer and is serialized directly by CLI and MCP."
  - "`status` stays concise with classification and next action; `inspect` carries the full recovery section."
  - "MCP `run_research_cycle` aligns with the CLI’s `fresh` contract instead of carrying forward `resume_required`."
patterns-established:
  - "Recovery truth is a shared read model, not a command-specific rendering detail."
  - "Tool/server parity is tested in-process through registered MCP handlers."
requirements-completed: [RECV-03]
duration: 35min
completed: 2026-04-05
---

# Phase 2 Plan 03 Summary

**`status`, `inspect`, and MCP now tell the same recovery story because they all serialize the shared service-layer recovery payload**

## Performance

- **Duration:** 35 min
- **Completed:** 2026-04-05
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `recovery` to project status and inspect read models with `classification`, `nextAction`, `reason`, and `resumeAllowed`.
- Updated CLI text surfaces to expose classification and next action without dumping raw checkpoint internals.
- Added MCP parity tests that execute registered tools in-process and verify they expose the same recovery truth as the service and CLI layers.

## Task Commits

1. **Plan 03 execution** - local workspace changes only (not committed in this session)

## Files Created/Modified

- `src/app/services/project-state-service.ts` - Shared recovery payload on status and inspect read models.
- `src/cli/commands/status.ts` - Concise recovery classification/next-action output.
- `src/cli/commands/inspect.ts` - Dedicated recovery section surfaced in text and JSON.
- `src/mcp/server.ts` - MCP run/status tools aligned with the `fresh` run contract and shared recovery payload.
- `tests/project-state-service.test.ts` - Service-level recovery read-model coverage.
- `tests/status-inspect-command.test.ts` - Command-level recovery output coverage.
- `tests/mcp-server.test.ts` - MCP parity coverage.

## Decisions Made

- Reused the server’s registered tool handlers directly in tests instead of spinning up an external MCP client.
- Kept `status` operator-focused and pushed the longer diagnosis into `inspect`.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- MCP testing required a fast path to invoke tool handlers without a transport. The in-process handler path proved enough to validate parity while keeping the tests deterministic.

## User Setup Required

None.

## Next Phase Readiness

- Operators can now see the same recovery truth before deciding whether to resume, repair, or review manually.
- Later promotion and manual-review work can rely on these read models instead of inventing new diagnostics.

---
*Phase: 02-resume-control-plane*
*Completed: 2026-04-05*
