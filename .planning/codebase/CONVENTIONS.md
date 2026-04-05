# Coding Conventions

**Analysis Date:** 2026-04-05

## Naming Patterns

**Files:**
- Use lowercase kebab-case for source files and tests, grouped by role. Examples: `src/core/engine/cycle-runner.ts`, `src/app/services/run-cycle-service.ts`, `src/cli/commands/serve-mcp.ts`, `tests/run-cycle-service.test.ts`.
- Keep one main concept per file. Adapters live under `src/adapters/**`, state engines under `src/core/state/**`, and CLI entrypoints under `src/cli/commands/**`.

**Functions:**
- Use camelCase and lead with a verb for behavior: `runCycle` in `src/core/engine/cycle-runner.ts`, `loadManifestFromFile` in `src/adapters/fs/manifest-loader.ts`, `getProjectStatus` in `src/app/services/project-state-service.ts`.
- Helper functions stay file-local and descriptive: `stripConstraintReason` and `persistJson` in `src/core/engine/cycle-runner.ts`, `createBufferedIo` in `tests/validate-command.test.ts`.
- Command registration functions follow `register{Name}Command`: `registerRunCommand` in `src/cli/commands/run.ts`, `registerAcceptCommand` in `src/cli/commands/accept.ts`.

**Variables:**
- Use lowerCamelCase for locals and parameters: `manifestPath`, `currentFrontier`, `priorConsecutiveAccepts`, `tempRoot`.
- Booleans read as predicates or states: `resume`, `json`, `frontierChanged`, `withinBudget`, `checked`.
- Arrays and maps use plural names: `results`, `decisions`, `judgeRationales`, `metricDeltas`, `anchorChecks`.
- Constants use `UPPER_SNAKE_CASE` only for shared defaults and exported literals, as in `src/core/manifest/defaults.ts`.

**Types:**
- Use PascalCase for interfaces, classes, and inferred domain types: `RunCycleService`, `CycleRunResult`, `RunRecord`, `JudgeProvider`.
- Zod schemas use lowerCamelCase plus a `Schema` suffix: `runRecordSchema` in `src/core/model/run-record.ts`, `judgePackSchema` in `src/core/manifest/schema.ts`.
- Literal unions come from Zod or explicit type aliases instead of enums: `JudgeMode` in `src/adapters/judge/llm-judge-provider.ts`, `runStatusSchema` in `src/core/model/run-record.ts`.

## Code Style

**Formatting:**
- No formatter config is detected. There is no `.prettierrc`, `eslint.config.*`, or `biome.json` in the repo root.
- Follow the existing TypeScript style in `src/**` and `tests/**`: two-space indentation, double quotes, semicolons, trailing commas on multiline literals, and blank lines between import groups.
- Prefer multiline object literals and function calls once arguments wrap, as in `src/cli/commands/run.ts` and `src/core/engine/cycle-runner.ts`.
- Prefer conditional object spread to omit absent fields instead of writing `undefined`, as in `src/cli/commands/run.ts` and `src/cli/commands/accept.ts`.

**Linting:**
- No ESLint or Biome ruleset is configured.
- Treat `tsconfig.json` as the enforced quality bar. Current strictness includes `strict`, `noImplicitOverride`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.
- Keep ESM-compatible imports with explicit `.js` extensions in TypeScript source, matching every file under `src/**`.

## Import Organization

**Order:**
1. Node built-ins, usually via the `node:` prefix, as in `src/adapters/fs/manifest-loader.ts` and `tests/command-runtime.test.ts`.
2. Third-party packages, such as `yaml`, `zod`, `commander`, `execa`, `pino`, and `vitest`.
3. Local imports from the app, generally relative and grouped after a blank line.

**Path Aliases:**
- None detected. All source and test files use relative imports such as `../../app/services/run-cycle-service.js` or `../src/core/state/frontier-engine.js`.
- Use `import type` for type-only imports where possible. This pattern appears across `src/cli/commands/*.ts`, `src/core/engine/cycle-runner.ts`, and `tests/*.test.ts`.

## Error Handling

**Patterns:**
- Wrap boundary failures with domain-specific errors when context matters. Examples: `ManifestLoadError` in `src/adapters/fs/manifest-loader.ts`, `RunNotFoundError` in `src/app/services/project-state-service.ts`, and `LockAcquisitionError` in `src/adapters/fs/lockfile.ts`.
- Return `null` or `[]` for expected missing-file cases in storage adapters, using `isMissingFileError` from `src/shared/fs-errors.ts`, instead of throwing for absent persisted state.
- Throw plain `Error` for invariant violations and unsupported states inside core logic. Examples include frontier invariant checks in `src/core/state/frontier-engine.ts`, candidate selection failures in `src/core/engine/cycle-runner.ts`, and missing metric errors in `src/core/state/constraint-engine.ts`.
- CLI commands catch all errors and convert them to exit codes plus human-readable or JSON output. Follow the pattern in `src/cli/commands/run.ts`, `src/cli/commands/accept.ts`, and `src/cli/commands/validate.ts`.
- Prefer schema validation over manual property checks. Zod parsing and `superRefine` rules in `src/core/manifest/schema.ts` and `src/core/model/run-record.ts` enforce object shape and cross-field invariants.

## Logging

**Framework:** `pino`

**Patterns:**
- Shared logging is centralized in `src/shared/logger.ts`.
- Application logging is minimal. The only direct structured log observed in source is the scaffold check in `src/cli/main.ts`.
- Command handlers primarily emit user-facing output through `CommandIO` interfaces in `src/cli/commands/run.ts`, `src/cli/commands/accept.ts`, and sibling files rather than logging.
- Avoid `console.*` in production source. Console output appears only in generated fixture scripts inside tests such as `tests/cli-commands.test.ts` and `tests/run-cycle-service.test.ts`.

## Comments

**When to Comment:**
- Keep comments rare. Most files rely on descriptive names and type signatures instead of inline commentary.
- The only comments detected in `src/**` are placeholder module comments in `src/adapters/index.ts` and `src/core/index.ts`.
- When adding comments, use them only to explain a module boundary or non-obvious invariant. Do not add narrating comments for routine assignments or control flow.

**JSDoc/TSDoc:**
- No JSDoc or TSDoc usage is established in `src/**` or `tests/**`.
- Prefer explicit interfaces and Zod schemas over docblocks for API communication.

## Function Design

**Size:** Keep most logic in small to medium functions. Large orchestration functions exist, but they delegate aggressively to helpers. `src/core/engine/cycle-runner.ts` is the main example: one exported coordinator plus many file-local helper functions.

**Parameters:**
- Use typed object parameters for operations with multiple inputs or optional fields. Examples: `runCycle` in `src/core/engine/cycle-runner.ts`, `getProjectStatus` in `src/app/services/project-state-service.ts`, and `evaluateRatchet` consumers throughout `tests/judge-trusted-signal.test.ts`.
- Use positional parameters for compact helpers with stable meaning, such as `compareSingleBestFrontier(currentFrontier, candidateEntry, primaryMetric)` in `src/core/state/frontier-engine.ts`.

**Return Values:**
- Return typed domain objects from core and service layers: `CycleRunResult`, `ProjectStatus`, `InspectRunResult`.
- CLI execution functions return `Promise<number>` exit codes and write output through `CommandIO`, as in `src/cli/commands/run.ts` and `src/cli/commands/accept.ts`.
- Persisted models are round-tripped through schema-validated records before they leave storage adapters, as in `src/adapters/fs/json-file-run-store.ts`.

## Module Design

**Exports:** 
- Prefer named exports for production code. Source files export interfaces, classes, schemas, helper functions, and type aliases by name.
- The main exception is tool/config entrypoints that need a default export, such as `vitest.config.ts`.
- Keep supporting helpers private unless they are shared across modules. Internal helpers in `src/core/engine/cycle-runner.ts` and `src/core/state/frontier-engine.ts` are intentionally file-local.

**Barrel Files:** 
- Barrel usage is effectively absent. `src/adapters/index.ts` and `src/core/index.ts` are placeholders, not active re-export surfaces.
- Import from the concrete module path instead of routing through a barrel.

## Prescriptive Summary

- Match the existing ESM TypeScript style: explicit `.js` import specifiers, type-only imports, double quotes, and semicolons.
- Add runtime validation with Zod when introducing new persisted models or manifest-like configuration. Follow `src/core/model/run-record.ts` and `src/core/manifest/schema.ts`.
- For new CLI commands, mirror the `CommandIO` plus `Promise<number>` pattern in `src/cli/commands/run.ts`.
- For new adapters and services, prefer explicit interfaces and thin classes around side effects, with plain functions for pure logic.
- Preserve the current error boundary style: custom error classes at IO/service edges, plain `Error` for internal invariant failures.

---

*Convention analysis: 2026-04-05*
