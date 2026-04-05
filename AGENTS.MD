READ ~/Projects/agent-scripts/AGENTS.MD BEFORE ANYTHING (skip if missing).

## Repo Notes
- This repo provides `./scripts/committer`; prefer it over a global helper.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**ralph-research**

`ralph-research` is a local-first runtime for recursive research improvement over real artifacts. It currently ships as a CLI and stdio MCP server with a bounded write-evaluate-accept loop, and this project focuses on making that core loop actually reliable for the primary user: me.

**Core Value:** When I run the tool, the workflow contract must match reality and stateful operations must be safe to resume, inspect, and trust.

### Constraints

- **Tech stack**: Keep the implementation within the existing TypeScript + Node + Vitest architecture — avoid a rewrite and preserve the current package/runtime model
- **Brownfield compatibility**: Preserve the existing CLI and MCP mental model where possible — users should not need to relearn the core flow just to gain reliability
- **Behavioral correctness**: Prefer removing unsupported contract surface over pretending to support it — misleading configuration is worse than narrower scope
- **Testability**: Every stability fix in scope must be backed by automated regression coverage — "works once" is not enough for this project
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.9.x - Application source lives in `src/**/*.ts`, compiled from `src` to `dist` by `tsc -p tsconfig.json` defined in `package.json` and configured in `tsconfig.json`.
- JavaScript (ESM `.mjs`) - Bundled research template scripts live in `templates/writing/scripts/propose.mjs`, `templates/writing/scripts/experiment.mjs`, and `templates/writing/scripts/metric.mjs`.
- YAML - Runtime manifests and test fixtures are defined in `templates/writing/ralph.yaml`, `tests/fixtures/manifests/valid-writing.ralph.yaml`, and `tests/fixtures/manifests/valid-code.ralph.yaml`, then parsed by `src/adapters/fs/manifest-loader.ts`.
- Markdown - User-facing docs, prompts, and template content live in `README.md`, `templates/writing/prompts/judge.md`, and `templates/writing/docs/draft.md`.
## Runtime
- Node.js ESM runtime - `package.json` sets `"type": "module"` and exposes the CLI binary `rrx` at `dist/cli/main.js`.
- Observed local development runtime: Node.js `v24.11.0`, which is compatible with the Node-targeted configuration in `tsconfig.json`.
- The code assumes access to a Git-enabled local shell because `src/adapters/git/git-client.ts`, `src/core/engine/workspace-manager.ts`, `src/cli/commands/init.ts`, and `src/cli/commands/demo.ts` all execute `git` via `execa`.
- npm - `package-lock.json` is present and `package.json` defines the standard install/build/test scripts.
- Observed local package-manager version: npm `11.6.2`.
- Lockfile: present in `package-lock.json`.
## Frameworks
- Commander `^14.0.1` - CLI parsing and command registration in `src/cli/main.ts` and the command modules under `src/cli/commands/`.
- Zod `^4.1.11` - Manifest and model validation in `src/core/manifest/schema.ts`, `src/adapters/fs/lockfile.ts`, `src/core/model/decision-record.ts`, `src/core/model/frontier-entry.ts`, `src/core/model/metric.ts`, and `src/core/model/run-record.ts`.
- YAML `^2.8.1` - Manifest parsing in `src/adapters/fs/manifest-loader.ts`.
- Model Context Protocol SDK `^1.17.4` - MCP server implementation in `src/mcp/server.ts` and startup in `src/mcp/main.ts`.
- Execa `^9.6.0` - Shell/process orchestration in `src/adapters/proposer/command-proposer.ts`, `src/adapters/extractor/command-extractor.ts`, `src/core/engine/experiment-runner.ts`, `src/adapters/judge/llm-judge-provider.ts`, `src/adapters/git/git-client.ts`, `src/core/engine/workspace-manager.ts`, `src/cli/commands/init.ts`, and `src/cli/commands/demo.ts`.
- Pino `^10.0.0` - Structured logging via `src/shared/logger.ts`.
- Vitest `^3.2.4` - Test runner configured in `vitest.config.ts` and used across `tests/**/*.test.ts`.
- TypeScript compiler `^5.9.3` - Build and typecheck via `package.json` scripts and `tsconfig.json`.
- TSX `^4.20.6` - Development execution for `src/cli/main.ts` and `src/mcp/main.ts` through `package.json` scripts `dev` and `mcp`.
## Key Dependencies
- `@modelcontextprotocol/sdk` `^1.17.4` - Required for the shipped stdio MCP server in `src/mcp/server.ts`.
- `commander` `^14.0.1` - Required for every CLI entrypoint registered from `src/cli/main.ts`.
- `execa` `^9.6.0` - Required for all manifest-driven proposer, experiment, metric, judge, and Git subprocess execution in `src/adapters/*`, `src/core/engine/*`, and selected CLI commands.
- `zod` `^4.1.11` - Required to keep `ralph.yaml` manifests and persisted state shapes valid in `src/core/manifest/schema.ts` and `src/core/model/*.ts`.
- `yaml` `^2.8.1` - Required to load `ralph.yaml` manifests in `src/adapters/fs/manifest-loader.ts`.
- `pino` `^10.0.0` - Logging infrastructure in `src/shared/logger.ts`.
- `@types/node` `^24.7.2` - Node typing support for the entire `src` tree and tests.
## Configuration
- Runtime configuration is manifest-driven. The canonical manifest filename is `ralph.yaml`, defined in `src/core/manifest/defaults.ts` and validated by `src/core/manifest/schema.ts`.
- Command-style proposer, experiment, and metric extractors accept arbitrary env maps through `src/core/manifest/schema.ts` and merge them with the parent shell environment in `src/adapters/proposer/command-proposer.ts`, `src/core/engine/experiment-runner.ts`, and `src/adapters/extractor/command-extractor.ts`.
- Optional LLM judge commands also merge shell env plus adapter-provided env in `src/adapters/judge/llm-judge-provider.ts`.
- Internal history propagation uses injected env vars `RRX_HISTORY_ENABLED`, `RRX_HISTORY_SUMMARY`, and `RRX_HISTORY_PATH` in `src/core/engine/cycle-runner.ts`.
- No `.env`, `.env.*`, or `*.env` files were detected under the repo root during this scan.
- Build and typecheck commands are defined in `package.json`.
- Compiler settings, output directory, and strictness live in `tsconfig.json`.
- Test runner settings live in `vitest.config.ts`.
- The packaged template assets copied by `rrx init` and `rrx demo` live under `templates/` and are resolved by `src/shared/template-utils.ts`.
## Platform Requirements
- Node.js with npm is required to run the scripts declared in `package.json`.
- Git CLI is required because repo setup, worktree management, and acceptance commits are implemented in `src/cli/commands/init.ts`, `src/cli/commands/demo.ts`, `src/adapters/git/git-client.ts`, and `src/core/engine/workspace-manager.ts`.
- A POSIX-like shell environment is assumed because manifest commands are executed with `shell: true` in `src/adapters/proposer/command-proposer.ts`, `src/adapters/extractor/command-extractor.ts`, `src/core/engine/experiment-runner.ts`, and `src/adapters/judge/llm-judge-provider.ts`.
- This repository ships as a local CLI and stdio MCP server, not a hosted web service. The package entrypoints are `dist/cli/main.js` via the `rrx` bin in `package.json` and `src/mcp/main.ts` / `src/mcp/server.ts` during development.
- Persistent runtime state is filesystem-backed under the manifest-selected storage root such as `.ralph` in `templates/writing/ralph.yaml` or `.rrx` in `tests/fixtures/manifests/valid-code.ralph.yaml`.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Use lowercase kebab-case for source files and tests, grouped by role. Examples: `src/core/engine/cycle-runner.ts`, `src/app/services/run-cycle-service.ts`, `src/cli/commands/serve-mcp.ts`, `tests/run-cycle-service.test.ts`.
- Keep one main concept per file. Adapters live under `src/adapters/**`, state engines under `src/core/state/**`, and CLI entrypoints under `src/cli/commands/**`.
- Use camelCase and lead with a verb for behavior: `runCycle` in `src/core/engine/cycle-runner.ts`, `loadManifestFromFile` in `src/adapters/fs/manifest-loader.ts`, `getProjectStatus` in `src/app/services/project-state-service.ts`.
- Helper functions stay file-local and descriptive: `stripConstraintReason` and `persistJson` in `src/core/engine/cycle-runner.ts`, `createBufferedIo` in `tests/validate-command.test.ts`.
- Command registration functions follow `register{Name}Command`: `registerRunCommand` in `src/cli/commands/run.ts`, `registerAcceptCommand` in `src/cli/commands/accept.ts`.
- Use lowerCamelCase for locals and parameters: `manifestPath`, `currentFrontier`, `priorConsecutiveAccepts`, `tempRoot`.
- Booleans read as predicates or states: `resume`, `json`, `frontierChanged`, `withinBudget`, `checked`.
- Arrays and maps use plural names: `results`, `decisions`, `judgeRationales`, `metricDeltas`, `anchorChecks`.
- Constants use `UPPER_SNAKE_CASE` only for shared defaults and exported literals, as in `src/core/manifest/defaults.ts`.
- Use PascalCase for interfaces, classes, and inferred domain types: `RunCycleService`, `CycleRunResult`, `RunRecord`, `JudgeProvider`.
- Zod schemas use lowerCamelCase plus a `Schema` suffix: `runRecordSchema` in `src/core/model/run-record.ts`, `judgePackSchema` in `src/core/manifest/schema.ts`.
- Literal unions come from Zod or explicit type aliases instead of enums: `JudgeMode` in `src/adapters/judge/llm-judge-provider.ts`, `runStatusSchema` in `src/core/model/run-record.ts`.
## Code Style
- No formatter config is detected. There is no `.prettierrc`, `eslint.config.*`, or `biome.json` in the repo root.
- Follow the existing TypeScript style in `src/**` and `tests/**`: two-space indentation, double quotes, semicolons, trailing commas on multiline literals, and blank lines between import groups.
- Prefer multiline object literals and function calls once arguments wrap, as in `src/cli/commands/run.ts` and `src/core/engine/cycle-runner.ts`.
- Prefer conditional object spread to omit absent fields instead of writing `undefined`, as in `src/cli/commands/run.ts` and `src/cli/commands/accept.ts`.
- No ESLint or Biome ruleset is configured.
- Treat `tsconfig.json` as the enforced quality bar. Current strictness includes `strict`, `noImplicitOverride`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.
- Keep ESM-compatible imports with explicit `.js` extensions in TypeScript source, matching every file under `src/**`.
## Import Organization
- None detected. All source and test files use relative imports such as `../../app/services/run-cycle-service.js` or `../src/core/state/frontier-engine.js`.
- Use `import type` for type-only imports where possible. This pattern appears across `src/cli/commands/*.ts`, `src/core/engine/cycle-runner.ts`, and `tests/*.test.ts`.
## Error Handling
- Wrap boundary failures with domain-specific errors when context matters. Examples: `ManifestLoadError` in `src/adapters/fs/manifest-loader.ts`, `RunNotFoundError` in `src/app/services/project-state-service.ts`, and `LockAcquisitionError` in `src/adapters/fs/lockfile.ts`.
- Return `null` or `[]` for expected missing-file cases in storage adapters, using `isMissingFileError` from `src/shared/fs-errors.ts`, instead of throwing for absent persisted state.
- Throw plain `Error` for invariant violations and unsupported states inside core logic. Examples include frontier invariant checks in `src/core/state/frontier-engine.ts`, candidate selection failures in `src/core/engine/cycle-runner.ts`, and missing metric errors in `src/core/state/constraint-engine.ts`.
- CLI commands catch all errors and convert them to exit codes plus human-readable or JSON output. Follow the pattern in `src/cli/commands/run.ts`, `src/cli/commands/accept.ts`, and `src/cli/commands/validate.ts`.
- Prefer schema validation over manual property checks. Zod parsing and `superRefine` rules in `src/core/manifest/schema.ts` and `src/core/model/run-record.ts` enforce object shape and cross-field invariants.
## Logging
- Shared logging is centralized in `src/shared/logger.ts`.
- Application logging is minimal. The only direct structured log observed in source is the scaffold check in `src/cli/main.ts`.
- Command handlers primarily emit user-facing output through `CommandIO` interfaces in `src/cli/commands/run.ts`, `src/cli/commands/accept.ts`, and sibling files rather than logging.
- Avoid `console.*` in production source. Console output appears only in generated fixture scripts inside tests such as `tests/cli-commands.test.ts` and `tests/run-cycle-service.test.ts`.
## Comments
- Keep comments rare. Most files rely on descriptive names and type signatures instead of inline commentary.
- The only comments detected in `src/**` are placeholder module comments in `src/adapters/index.ts` and `src/core/index.ts`.
- When adding comments, use them only to explain a module boundary or non-obvious invariant. Do not add narrating comments for routine assignments or control flow.
- No JSDoc or TSDoc usage is established in `src/**` or `tests/**`.
- Prefer explicit interfaces and Zod schemas over docblocks for API communication.
## Function Design
- Use typed object parameters for operations with multiple inputs or optional fields. Examples: `runCycle` in `src/core/engine/cycle-runner.ts`, `getProjectStatus` in `src/app/services/project-state-service.ts`, and `evaluateRatchet` consumers throughout `tests/judge-trusted-signal.test.ts`.
- Use positional parameters for compact helpers with stable meaning, such as `compareSingleBestFrontier(currentFrontier, candidateEntry, primaryMetric)` in `src/core/state/frontier-engine.ts`.
- Return typed domain objects from core and service layers: `CycleRunResult`, `ProjectStatus`, `InspectRunResult`.
- CLI execution functions return `Promise<number>` exit codes and write output through `CommandIO`, as in `src/cli/commands/run.ts` and `src/cli/commands/accept.ts`.
- Persisted models are round-tripped through schema-validated records before they leave storage adapters, as in `src/adapters/fs/json-file-run-store.ts`.
## Module Design
- Prefer named exports for production code. Source files export interfaces, classes, schemas, helper functions, and type aliases by name.
- The main exception is tool/config entrypoints that need a default export, such as `vitest.config.ts`.
- Keep supporting helpers private unless they are shared across modules. Internal helpers in `src/core/engine/cycle-runner.ts` and `src/core/state/frontier-engine.ts` are intentionally file-local.
- Barrel usage is effectively absent. `src/adapters/index.ts` and `src/core/index.ts` are placeholders, not active re-export surfaces.
- Import from the concrete module path instead of routing through a barrel.
## Prescriptive Summary
- Match the existing ESM TypeScript style: explicit `.js` import specifiers, type-only imports, double quotes, and semicolons.
- Add runtime validation with Zod when introducing new persisted models or manifest-like configuration. Follow `src/core/model/run-record.ts` and `src/core/manifest/schema.ts`.
- For new CLI commands, mirror the `CommandIO` plus `Promise<number>` pattern in `src/cli/commands/run.ts`.
- For new adapters and services, prefer explicit interfaces and thin classes around side effects, with plain functions for pure logic.
- Preserve the current error boundary style: custom error classes at IO/service edges, plain `Error` for internal invariant failures.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Keep orchestration in `src/app/services/` and `src/core/engine/`; keep transport concerns in `src/cli/` and `src/mcp/`.
- Express persistence behind ports in `src/core/ports/` and satisfy them with filesystem adapters in `src/adapters/fs/`.
- Treat Git worktrees plus `.ralph` state as first-class runtime infrastructure; the runtime mutates repositories through `src/core/engine/workspace-manager.ts` and `src/adapters/git/git-client.ts`.
## Layers
- Purpose: expose the runtime to humans and tools.
- Location: `src/cli/main.ts`, `src/cli/commands/*.ts`, `src/mcp/main.ts`, `src/mcp/server.ts`
- Contains: Commander command registration, JSON/text output formatting, MCP tool definitions, transport bootstrapping.
- Depends on: `src/app/context.ts`, `src/app/services/run-cycle-service.ts`, `src/app/services/project-state-service.ts`, `src/app/services/manual-decision-service.ts`
- Used by: the built CLI binary at `dist/cli/main.js` and the stdio MCP process started from `src/mcp/main.ts`
- Purpose: assemble dependencies per request and coordinate use cases.
- Location: `src/app/services/run-cycle-service.ts`, `src/app/services/project-state-service.ts`, `src/app/services/manual-decision-service.ts`
- Contains: manifest loading, `.ralph` path resolution, lock acquisition, store creation, service-level accept/reject/status/inspect flows.
- Depends on: adapters in `src/adapters/`, state transitions in `src/core/state/run-state-machine.ts`, orchestration in `src/core/engine/`
- Used by: `src/cli/commands/*.ts` and `src/mcp/server.ts`
- Purpose: run a bounded candidate cycle and compute the acceptance decision.
- Location: `src/core/engine/*.ts`
- Contains: cycle orchestration in `src/core/engine/cycle-runner.ts`, experiment execution in `src/core/engine/experiment-runner.ts`, worktree management in `src/core/engine/workspace-manager.ts`, guardrails such as `src/core/engine/change-budget.ts`, `src/core/engine/anchor-checker.ts`, and `src/core/engine/audit-sampler.ts`
- Depends on: manifest/model/ports modules in `src/core/manifest/`, `src/core/model/`, `src/core/ports/`, plus concrete adapters for proposer, extractor, judge provider, and Git
- Used by: `src/app/services/run-cycle-service.ts`
- Purpose: make decisions deterministic and reusable outside transport code.
- Location: `src/core/state/*.ts`
- Contains: frontier updates in `src/core/state/frontier-engine.ts`, ratchet policies in `src/core/state/ratchet-engine.ts`, constraint checks in `src/core/state/constraint-engine.ts`, resumability rules in `src/core/state/run-state-machine.ts`
- Depends on: manifest types from `src/core/manifest/schema.ts` and records from `src/core/model/*.ts`
- Used by: `src/core/engine/cycle-runner.ts`, `src/app/services/manual-decision-service.ts`
- Purpose: define the stable shapes the rest of the system passes around.
- Location: `src/core/manifest/schema.ts`, `src/core/manifest/defaults.ts`, `src/core/model/*.ts`, `src/core/ports/*.ts`
- Contains: `RalphManifest`, run/decision/frontier records, metric definitions, store interfaces.
- Depends on: `zod` schemas and default constants.
- Used by: every higher layer.
- Purpose: isolate filesystem, Git, command execution, and LLM judge integration behind narrow APIs.
- Location: `src/adapters/fs/*.ts`, `src/adapters/git/git-client.ts`, `src/adapters/proposer/command-proposer.ts`, `src/adapters/extractor/*.ts`, `src/adapters/judge/llm-judge-provider.ts`
- Contains: JSON persistence, manifest loading, lockfiles, Git commit helper, command proposer/metric extraction, CLI-backed judge provider.
- Depends on: Node filesystem/path APIs, `execa`, and core contracts.
- Used by: application services and the cycle runner.
## Data Flow
- Persistent runtime state lives under `manifest.storage.root`, which defaults to `.ralph` via `src/core/manifest/defaults.ts`.
- Mutable workflow state is represented by `RunRecord`, `DecisionRecord`, and `FrontierEntry` in `src/core/model/*.ts`.
- Phase transitions are centralized in `src/core/state/run-state-machine.ts`; do not hand-edit run status logic in CLI or service code.
## Key Abstractions
- Purpose: all runtime behavior is described by `ralph.yaml`.
- Examples: `src/core/manifest/schema.ts`, `templates/writing/ralph.yaml`, `src/adapters/fs/manifest-loader.ts`
- Pattern: validate once with Zod, then pass typed `RalphManifest` objects downward.
- Purpose: keep state persistence replaceable.
- Examples: `src/core/ports/run-store.ts`, `src/core/ports/decision-store.ts`, `src/core/ports/frontier-store.ts`, `src/adapters/fs/json-file-run-store.ts`, `src/adapters/fs/json-file-decision-store.ts`, `src/adapters/fs/json-file-frontier-store.ts`
- Pattern: services and engines depend on interfaces; JSON file adapters are composed at the application boundary.
- Purpose: isolate candidate changes from the main checkout until the ratchet accepts them.
- Examples: `src/core/engine/workspace-manager.ts`, `src/adapters/git/git-client.ts`, `tests/lockfile-workspace-manager.test.ts`
- Pattern: create detached Git worktrees, run changes there, copy accepted paths back, then commit only promoted files.
- Purpose: turn raw metric outputs into an acceptance outcome.
- Examples: `src/core/state/ratchet-engine.ts`, `src/core/state/frontier-engine.ts`, `src/core/state/constraint-engine.ts`, `src/core/engine/change-budget.ts`, `src/core/engine/anchor-checker.ts`
- Pattern: compose multiple gates rather than embedding policy branches in transport or adapter code.
- Purpose: preserve enough run data to justify decisions later.
- Examples: `src/app/services/project-state-service.ts`, `src/core/model/run-record.ts`, `src/core/model/decision-record.ts`
- Pattern: write logs, metrics, rationale, changed paths, and frontier deltas into persisted records; inspection only reads those records back.
## Entry Points
- Location: `src/cli/main.ts`
- Triggers: `npm run dev`, built `rrx` binary from `package.json`, or direct Node execution of `dist/cli/main.js`
- Responsibilities: register commands, expose the `doctor` scaffold check, and delegate all business logic to command modules
- Location: `src/cli/commands/run.ts`, `src/cli/commands/init.ts`, `src/cli/commands/demo.ts`, `src/cli/commands/status.ts`, `src/cli/commands/frontier.ts`, `src/cli/commands/inspect.ts`, `src/cli/commands/accept.ts`, `src/cli/commands/reject.ts`, `src/cli/commands/validate.ts`, `src/cli/commands/serve-mcp.ts`
- Triggers: end-user `rrx` subcommands
- Responsibilities: parse options, format text/JSON output, map exit codes, and call one application service per command
- Location: `src/mcp/main.ts`
- Triggers: `npm run mcp`
- Responsibilities: start stdio transport against the current working directory
- Location: `src/mcp/server.ts`
- Triggers: MCP client tool calls
- Responsibilities: register `run_research_cycle`, `get_research_status`, and `get_frontier`; reuse the same services as CLI code
- Location: `src/shared/template-utils.ts`
- Triggers: `src/cli/commands/init.ts` and `src/cli/commands/demo.ts`
- Responsibilities: materialize bundled templates from `templates/` into runnable repos
## Error Handling
- Validation failures are raised during manifest load in `src/adapters/fs/manifest-loader.ts` using `RalphManifestSchema` from `src/core/manifest/schema.ts`.
- Runtime orchestration failures are caught inside `src/core/engine/cycle-runner.ts`, which writes a failed `RunRecord` instead of losing state.
- CLI commands such as `src/cli/commands/run.ts` and `src/cli/commands/init.ts` convert thrown errors into stderr text or JSON payloads and set non-zero exit codes.
- Filesystem adapters use `src/shared/fs-errors.ts` to normalize missing-file handling instead of scattering `ENOENT` checks.
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
