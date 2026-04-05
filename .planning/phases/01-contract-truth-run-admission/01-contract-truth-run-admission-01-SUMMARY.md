---
phase: 01-contract-truth-run-admission
plan: 01
subsystem: manifest
tags: [manifest, admission, validation, git]
requires: []
provides:
  - shared manifest admission checks for workspace, proposer, and repo-aware baseline support
  - loader-level rejection payloads for unsupported manifest surface
  - regression fixtures covering unsupported workspace and operator manifests
affects: [run-admission, validate, doctor, baseline]
tech-stack:
  added: []
  patterns: [two-stage manifest load, shared admission payloads]
key-files:
  created:
    - src/core/manifest/admission.ts
    - tests/fixtures/manifests/invalid-unsupported-workspace.ralph.yaml
    - tests/fixtures/manifests/invalid-unsupported-operator-llm.ralph.yaml
  modified:
    - src/adapters/fs/manifest-loader.ts
    - tests/manifest-loader.test.ts
    - tests/fixtures/manifests/valid-writing.ralph.yaml
    - tests/fixtures/manifests/invalid-missing-judge-pack.ralph.yaml
key-decisions:
  - "Manifest loading remains schema-first, then shared admission."
  - "Repo-aware baseline checks run only when repo context is provided."
  - "Bundled writing fixtures were normalized onto supported command proposer truth."
patterns-established:
  - "Manifest admission issues use a shared unsupported_capability payload with explicit paths."
  - "Loader callers can opt into repo-aware admission by passing repoRoot."
requirements-completed: [CONT-01]
duration: 20min
completed: 2026-04-05
---

# Phase 1 Plan 01 Summary

**Shared manifest admission now rejects unsupported workspace and proposer surface early, with repo-aware baseline checks available through the loader**

## Performance

- **Duration:** 20 min
- **Completed:** 2026-04-05
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added a shared manifest admission module that classifies executable vs blocked manifests before run startup.
- Upgraded the manifest loader into a schema-plus-admission boundary with structured unsupported-capability payloads.
- Added regression coverage for unsupported workspace, unsupported `operator_llm`, unresolved repo baseline refs, and valid parallel command strategies.

## Task Commits

1. **Plan 01 execution** - `40fd6af` (`feat(01-01): add truthful manifest admission checks`)

## Files Created/Modified

- `src/core/manifest/admission.ts` - Shared capability truth and repo-aware baseline resolution.
- `src/adapters/fs/manifest-loader.ts` - Two-stage load path that applies schema validation and admission checks together.
- `tests/manifest-loader.test.ts` - Regression coverage for admission outcomes.
- `tests/fixtures/manifests/valid-writing.ralph.yaml` - Writing fixture aligned to supported command proposer behavior.
- `tests/fixtures/manifests/invalid-missing-judge-pack.ralph.yaml` - Missing-judge-pack fixture kept focused on the intended validation failure.

## Decisions Made

- Kept manifest schema breadth for diagnostics, but moved support truth into admission instead of schema narrowing.
- Resolved `baselineRef` only when callers provide repo context so non-repo template/init flows can still load manifests before Git setup.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- `valid-writing` and `invalid-missing-judge-pack` fixtures still used `operator_llm`, which would have made unrelated tests fail for the wrong reason. Both fixtures were normalized so admission tests stay truthful and targeted.

## User Setup Required

None.

## Next Phase Readiness

- Run-path callers can now reuse a stable admission payload and pass repo context for baseline resolution.
- Phase 02 can wire the same admission truth into `RunCycleService` and workspace creation without redefining unsupported-surface rules.

---
*Phase: 01-contract-truth-run-admission*
*Completed: 2026-04-05*
