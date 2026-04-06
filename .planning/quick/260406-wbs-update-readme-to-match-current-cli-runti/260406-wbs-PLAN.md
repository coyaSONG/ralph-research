# Quick Task 260406-wbs: Update README to match current CLI/runtime behavior and push the change

**Created:** 2026-04-06
**Status:** Completed

## Goal

Bring `README.md` back in line with the current CLI/runtime contract so the documented quickstart and option semantics match shipped behavior.

## Tasks

- Align the quickstart flow with the bundled `writing` template and move progressive-stop usage behind the required `stopping.target` manifest edit.
- Document the current `rrx run` recovery contract, especially auto-resume, `--fresh`, and the manual-review block.
- Fix the LLM-scoring migration note so it matches the manifest schema (`kind: llm_score` with `type: llm_judge`).

## Verification

- Compare README commands and wording against `src/cli/commands/*.ts`, `src/app/services/run-loop-service.ts`, `src/app/services/run-cycle-service.ts`, and `templates/writing/ralph.yaml`.
- Reproduce the documented `--until-target` precondition against a freshly initialized `writing` template.
