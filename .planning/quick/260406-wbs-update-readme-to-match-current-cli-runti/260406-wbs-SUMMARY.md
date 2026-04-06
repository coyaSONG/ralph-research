# Quick Task 260406-wbs Summary

**Completed:** 2026-04-06
**Status:** Done

## Outcome

Updated `README.md` so the default quickstart now matches the shipped `writing` template, the progressive stop example is gated behind `stopping.target`, and the run recovery contract reflects the current auto-resume and `--fresh` behavior.

## Verification

- Checked CLI help and option wiring in `src/cli/main.ts` and `src/cli/commands/run.ts`.
- Checked progressive-stop preconditions in `src/app/services/run-loop-service.ts`.
- Checked resume/manual-review behavior in `src/app/services/run-cycle-service.ts`.
- Checked the bundled template in `templates/writing/ralph.yaml`.
- Reproduced that `run --until-target` fails on a fresh `writing` template until `stopping.target` is configured.
