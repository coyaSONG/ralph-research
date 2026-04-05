---
phase: 01-contract-truth-run-admission
plan: 03
subsystem: cli
tags: [cli, validate, doctor, admission, demo]
requires:
  - phase: 01-contract-truth-run-admission
    provides: run-path admission truth and resolved baseline handling
provides:
  - shared CLI preflight service for executable-vs-blocked checks
  - real doctor command output backed by manifest admission
  - regression coverage proving validate, doctor, and run stay aligned
affects: [validate, doctor, run, init, demo]
tech-stack:
  added: []
  patterns: [shared preflight service, CLI admission reuse]
key-files:
  created:
    - src/app/services/run-admission-service.ts
    - src/cli/commands/doctor.ts
  modified:
    - src/cli/commands/validate.ts
    - src/cli/main.ts
    - src/cli/commands/init.ts
    - src/cli/commands/demo.ts
    - tests/validate-command.test.ts
    - tests/cli-commands.test.ts
key-decisions:
  - "Validate and doctor both read admission truth from one service."
  - "Newly initialized demo/template repos are normalized onto branch main so bundled baselineRef stays truthful."
  - "CLI preflight success language uses executable/blocked wording instead of schema-valid wording."
patterns-established:
  - "Operator-facing preflight is a service-layer concern, not a command-specific manifest parse."
  - "Bundled repo setup must preserve baselineRef truth for first-run success."
requirements-completed: [CONT-03]
duration: 25min
completed: 2026-04-05
---

# Phase 1 Plan 03 Summary

**Validate, doctor, and run now share one admission preflight truth, and bundled init/demo repos are created on `main` so that truth holds on first use**

## Performance

- **Duration:** 25 min
- **Completed:** 2026-04-05
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Added a shared run-admission service and a real `doctor` command that reports executable vs blocked manifests.
- Rewired `validate` to use the same admission truth as `doctor` and `run`.
- Added CLI regression tests for unsupported workspace, unsupported proposer, unresolved baseline refs, and run/doctor consistency.

## Task Commits

1. **Plan 03 execution** - `08ed219` (`feat(01-03): unify CLI admission preflight`)

## Files Created/Modified

- `src/app/services/run-admission-service.ts` - Shared preflight service for CLI admission checks.
- `src/cli/commands/doctor.ts` - Real doctor command built on the shared preflight service.
- `src/cli/commands/validate.ts` - Validation output now reports executable/blocked truth instead of schema-only validity.
- `src/cli/commands/init.ts` - New repos are renamed to `main` after the first commit.
- `src/cli/commands/demo.ts` - Demo repos are renamed to `main` so bundled baseline refs resolve.
- `tests/validate-command.test.ts` - Covers workspace, proposer, and baseline preflight failures.
- `tests/cli-commands.test.ts` - Covers doctor/run agreement and fail-fast CLI behavior.

## Decisions Made

- Kept the command surface stable: `doctor`, `validate`, and `run` remain separate commands, but they now answer the same admission question.
- Fixed the bundled repo bootstrap path instead of weakening baseline admission, because `baselineRef: main` should stay truthful.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- Full-phase verification exposed that `demo` initialized repos on Git's default branch, which broke the newly truthful `baselineRef: main` contract. The repo bootstrap path was normalized to `main` for both `demo` and `init`.

## User Setup Required

None.

## Next Phase Readiness

- Operators now have a stable preflight surface before any destructive run starts.
- Phase 02 can focus purely on same-`runId` resume and recovery semantics instead of compensating for contract drift.

---
*Phase: 01-contract-truth-run-admission*
*Completed: 2026-04-05*
