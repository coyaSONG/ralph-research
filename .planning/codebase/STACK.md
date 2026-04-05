# Technology Stack

**Analysis Date:** 2026-04-05

## Languages

**Primary:**
- TypeScript 5.9.x - Application source lives in `src/**/*.ts`, compiled from `src` to `dist` by `tsc -p tsconfig.json` defined in `package.json` and configured in `tsconfig.json`.

**Secondary:**
- JavaScript (ESM `.mjs`) - Bundled research template scripts live in `templates/writing/scripts/propose.mjs`, `templates/writing/scripts/experiment.mjs`, and `templates/writing/scripts/metric.mjs`.
- YAML - Runtime manifests and test fixtures are defined in `templates/writing/ralph.yaml`, `tests/fixtures/manifests/valid-writing.ralph.yaml`, and `tests/fixtures/manifests/valid-code.ralph.yaml`, then parsed by `src/adapters/fs/manifest-loader.ts`.
- Markdown - User-facing docs, prompts, and template content live in `README.md`, `templates/writing/prompts/judge.md`, and `templates/writing/docs/draft.md`.

## Runtime

**Environment:**
- Node.js ESM runtime - `package.json` sets `"type": "module"` and exposes the CLI binary `rrx` at `dist/cli/main.js`.
- Observed local development runtime: Node.js `v24.11.0`, which is compatible with the Node-targeted configuration in `tsconfig.json`.
- The code assumes access to a Git-enabled local shell because `src/adapters/git/git-client.ts`, `src/core/engine/workspace-manager.ts`, `src/cli/commands/init.ts`, and `src/cli/commands/demo.ts` all execute `git` via `execa`.

**Package Manager:**
- npm - `package-lock.json` is present and `package.json` defines the standard install/build/test scripts.
- Observed local package-manager version: npm `11.6.2`.
- Lockfile: present in `package-lock.json`.

## Frameworks

**Core:**
- Commander `^14.0.1` - CLI parsing and command registration in `src/cli/main.ts` and the command modules under `src/cli/commands/`.
- Zod `^4.1.11` - Manifest and model validation in `src/core/manifest/schema.ts`, `src/adapters/fs/lockfile.ts`, `src/core/model/decision-record.ts`, `src/core/model/frontier-entry.ts`, `src/core/model/metric.ts`, and `src/core/model/run-record.ts`.
- YAML `^2.8.1` - Manifest parsing in `src/adapters/fs/manifest-loader.ts`.
- Model Context Protocol SDK `^1.17.4` - MCP server implementation in `src/mcp/server.ts` and startup in `src/mcp/main.ts`.
- Execa `^9.6.0` - Shell/process orchestration in `src/adapters/proposer/command-proposer.ts`, `src/adapters/extractor/command-extractor.ts`, `src/core/engine/experiment-runner.ts`, `src/adapters/judge/llm-judge-provider.ts`, `src/adapters/git/git-client.ts`, `src/core/engine/workspace-manager.ts`, `src/cli/commands/init.ts`, and `src/cli/commands/demo.ts`.
- Pino `^10.0.0` - Structured logging via `src/shared/logger.ts`.

**Testing:**
- Vitest `^3.2.4` - Test runner configured in `vitest.config.ts` and used across `tests/**/*.test.ts`.

**Build/Dev:**
- TypeScript compiler `^5.9.3` - Build and typecheck via `package.json` scripts and `tsconfig.json`.
- TSX `^4.20.6` - Development execution for `src/cli/main.ts` and `src/mcp/main.ts` through `package.json` scripts `dev` and `mcp`.

## Key Dependencies

**Critical:**
- `@modelcontextprotocol/sdk` `^1.17.4` - Required for the shipped stdio MCP server in `src/mcp/server.ts`.
- `commander` `^14.0.1` - Required for every CLI entrypoint registered from `src/cli/main.ts`.
- `execa` `^9.6.0` - Required for all manifest-driven proposer, experiment, metric, judge, and Git subprocess execution in `src/adapters/*`, `src/core/engine/*`, and selected CLI commands.
- `zod` `^4.1.11` - Required to keep `ralph.yaml` manifests and persisted state shapes valid in `src/core/manifest/schema.ts` and `src/core/model/*.ts`.
- `yaml` `^2.8.1` - Required to load `ralph.yaml` manifests in `src/adapters/fs/manifest-loader.ts`.

**Infrastructure:**
- `pino` `^10.0.0` - Logging infrastructure in `src/shared/logger.ts`.
- `@types/node` `^24.7.2` - Node typing support for the entire `src` tree and tests.

## Configuration

**Environment:**
- Runtime configuration is manifest-driven. The canonical manifest filename is `ralph.yaml`, defined in `src/core/manifest/defaults.ts` and validated by `src/core/manifest/schema.ts`.
- Command-style proposer, experiment, and metric extractors accept arbitrary env maps through `src/core/manifest/schema.ts` and merge them with the parent shell environment in `src/adapters/proposer/command-proposer.ts`, `src/core/engine/experiment-runner.ts`, and `src/adapters/extractor/command-extractor.ts`.
- Optional LLM judge commands also merge shell env plus adapter-provided env in `src/adapters/judge/llm-judge-provider.ts`.
- Internal history propagation uses injected env vars `RRX_HISTORY_ENABLED`, `RRX_HISTORY_SUMMARY`, and `RRX_HISTORY_PATH` in `src/core/engine/cycle-runner.ts`.
- No `.env`, `.env.*`, or `*.env` files were detected under the repo root during this scan.

**Build:**
- Build and typecheck commands are defined in `package.json`.
- Compiler settings, output directory, and strictness live in `tsconfig.json`.
- Test runner settings live in `vitest.config.ts`.
- The packaged template assets copied by `rrx init` and `rrx demo` live under `templates/` and are resolved by `src/shared/template-utils.ts`.

## Platform Requirements

**Development:**
- Node.js with npm is required to run the scripts declared in `package.json`.
- Git CLI is required because repo setup, worktree management, and acceptance commits are implemented in `src/cli/commands/init.ts`, `src/cli/commands/demo.ts`, `src/adapters/git/git-client.ts`, and `src/core/engine/workspace-manager.ts`.
- A POSIX-like shell environment is assumed because manifest commands are executed with `shell: true` in `src/adapters/proposer/command-proposer.ts`, `src/adapters/extractor/command-extractor.ts`, `src/core/engine/experiment-runner.ts`, and `src/adapters/judge/llm-judge-provider.ts`.

**Production:**
- This repository ships as a local CLI and stdio MCP server, not a hosted web service. The package entrypoints are `dist/cli/main.js` via the `rrx` bin in `package.json` and `src/mcp/main.ts` / `src/mcp/server.ts` during development.
- Persistent runtime state is filesystem-backed under the manifest-selected storage root such as `.ralph` in `templates/writing/ralph.yaml` or `.rrx` in `tests/fixtures/manifests/valid-code.ralph.yaml`.

---

*Stack analysis: 2026-04-05*
