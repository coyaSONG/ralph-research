---
phase: 05-regression-hardening-matrix
plan: 02
subsystem: admission
tags: [contract, validate, doctor, run]
requires:
  - phase: 01-contract-truth-run-admission
    provides: manifest admission rules
provides:
  - contract-enforcement parity coverage across validate, doctor, and run
affects: [cli-commands, validate]
tech-stack:
  added: []
  patterns: [admission parity matrix]
key-files:
  created: []
  modified:
    - tests/cli-commands.test.ts
key-decisions:
  - "Protect unsupported workspace and unsupported `operator_llm` declarations with one explicit cross-surface matrix."
patterns-established:
  - "Admission drift is now tested at the public-surface level instead of indirectly."
requirements-completed: [STAB-04]
duration: 10min
completed: 2026-04-05
---

# Phase 5 Plan 02 Summary

**Validate, doctor, and run now stay aligned on unsupported manifest/runtime combinations**

## Accomplishments

- Added a CLI-level parity test covering unsupported workspace and unsupported `operator_llm` proposer declarations across `validate`, `doctor`, and `run`.
- Locked the issue-path expectations so contract drift between surfaces becomes a direct regression.

## Files Modified

- `tests/cli-commands.test.ts`

---
*Phase: 05-regression-hardening-matrix*
*Completed: 2026-04-05*
