# Codebase Structure

**Analysis Date:** 2026-04-05

## Directory Layout

```text
[project-root]/
├── src/              # TypeScript source for CLI, MCP, core engine, adapters, and shared utilities
├── tests/            # Vitest suites and manifest fixtures
├── templates/        # Bundled starter repos copied by `rrx init` and `rrx demo`
├── docs/             # Project knowledge notes and design decisions
├── scripts/          # Repo-local automation helpers such as `scripts/committer`
├── dist/             # TypeScript build output consumed by the published CLI bin
├── spike/            # Research and prototype experiments outside the production runtime
├── package.json      # Build, test, CLI, and MCP entry configuration
├── tsconfig.json     # TypeScript compiler settings
└── vitest.config.ts  # Test discovery and Node test environment
```

## Directory Purposes

**`src/`:**
- Purpose: production runtime code only.
- Contains: CLI commands, MCP server, orchestration services, core state/policy code, adapters, shared utilities.
- Key files: `src/cli/main.ts`, `src/mcp/server.ts`, `src/app/services/run-cycle-service.ts`, `src/core/engine/cycle-runner.ts`, `src/core/manifest/schema.ts`

**`src/cli/`:**
- Purpose: command-line interface surface.
- Contains: bootstrap in `src/cli/main.ts` and one file per subcommand under `src/cli/commands/`.
- Key files: `src/cli/main.ts`, `src/cli/commands/run.ts`, `src/cli/commands/init.ts`, `src/cli/commands/inspect.ts`

**`src/mcp/`:**
- Purpose: stdio MCP surface that mirrors the service layer.
- Contains: process bootstrap plus tool registration.
- Key files: `src/mcp/main.ts`, `src/mcp/server.ts`

**`src/app/`:**
- Purpose: application assembly and use-case orchestration.
- Contains: request-scoped service classes/functions and the tiny app context object.
- Key files: `src/app/context.ts`, `src/app/services/run-cycle-service.ts`, `src/app/services/project-state-service.ts`, `src/app/services/manual-decision-service.ts`

**`src/core/`:**
- Purpose: domain contracts and decision logic.
- Contains: manifest schemas in `src/core/manifest/`, records in `src/core/model/`, persistence contracts in `src/core/ports/`, orchestration in `src/core/engine/`, and policy/state machines in `src/core/state/`.
- Key files: `src/core/manifest/schema.ts`, `src/core/engine/cycle-runner.ts`, `src/core/state/ratchet-engine.ts`, `src/core/state/frontier-engine.ts`

**`src/adapters/`:**
- Purpose: runtime infrastructure integrations.
- Contains: filesystem JSON stores and lockfiles, Git command wrapper, command proposer, metric extractors, judge provider.
- Key files: `src/adapters/fs/manifest-loader.ts`, `src/adapters/fs/json-file-run-store.ts`, `src/adapters/git/git-client.ts`, `src/adapters/judge/llm-judge-provider.ts`

**`src/shared/`:**
- Purpose: small reusable utilities that do not belong to domain policy.
- Contains: logger setup, template copy logic, filesystem error helpers.
- Key files: `src/shared/logger.ts`, `src/shared/template-utils.ts`, `src/shared/fs-errors.ts`

**`tests/`:**
- Purpose: Node integration-style test coverage around services, engines, adapters, and CLI command functions.
- Contains: `*.test.ts` files at the top level and fixtures under `tests/fixtures/manifests/`.
- Key files: `tests/run-cycle-service.test.ts`, `tests/cli-commands.test.ts`, `tests/state-engines.test.ts`, `tests/fixtures/manifests/valid-writing.ralph.yaml`

**`templates/`:**
- Purpose: user-facing starter projects copied into a target repo.
- Contains: one bundled template namespace under `templates/writing/` with its own `ralph.yaml`, docs, prompts, and scripts.
- Key files: `templates/writing/ralph.yaml`, `templates/writing/scripts/propose.mjs`, `templates/writing/scripts/metric.mjs`, `templates/writing/docs/draft.md`

**`docs/`:**
- Purpose: internal knowledge base rather than runtime code.
- Contains: decision logs, research notes, patterns, and gotchas under `docs/knowledge/`.
- Key files: `docs/knowledge/INDEX.md`, `docs/knowledge/decision-2026-03-29-cli-first-hybrid.md`

**`scripts/`:**
- Purpose: local repo helpers used during development workflows.
- Contains: the repo-local commit helper referenced by `AGENTS.md`.
- Key files: `scripts/committer`

**`dist/`:**
- Purpose: compiled output from `tsc`.
- Contains: the mirrored runtime tree rooted at `dist/cli/main.js`.
- Key files: `dist/cli/main.js`, `dist/mcp/main.js`

**`spike/`:**
- Purpose: exploratory prototype work and fixtures separate from `src/`.
- Contains: day-based experiment directories and generated sample runs.
- Key files: `spike/day1-judge-signal/`, `spike/day2-bounded-patch/`, `spike/day3-cross-domain/`

## Key File Locations

**Entry Points:**
- `src/cli/main.ts`: primary CLI bootstrap and command registration
- `src/mcp/main.ts`: MCP stdio bootstrap
- `src/mcp/server.ts`: MCP tool registration and service bridging

**Configuration:**
- `package.json`: scripts, binary mapping, dependency list
- `tsconfig.json`: TypeScript compile target and `src` -> `dist` mapping
- `vitest.config.ts`: test discovery pattern `tests/**/*.test.ts`
- `templates/writing/ralph.yaml`: canonical example manifest for the runtime

**Core Logic:**
- `src/app/services/run-cycle-service.ts`: request-scoped assembly for a run
- `src/core/engine/cycle-runner.ts`: end-to-end candidate execution and decision persistence
- `src/core/state/ratchet-engine.ts`: acceptance policy
- `src/core/state/frontier-engine.ts`: frontier comparison and updates
- `src/core/engine/workspace-manager.ts`: Git worktree lifecycle and promotion

**Testing:**
- `tests/run-cycle-service.test.ts`: service integration path
- `tests/cli-commands.test.ts`: command-function contract tests
- `tests/lockfile-workspace-manager.test.ts`: runtime infrastructure behavior
- `tests/fixtures/manifests/*.ralph.yaml`: manifest validation fixtures

## Naming Conventions

**Files:**
- Use lowercase kebab-case TypeScript filenames that describe one concept or use case, for example `src/app/services/run-cycle-service.ts`, `src/core/state/run-state-machine.ts`, and `src/adapters/fs/json-file-run-store.ts`.
- Keep command handlers in `src/cli/commands/` named after the command, for example `run.ts`, `status.ts`, and `accept.ts`.
- Keep tests as `tests/<subject>.test.ts`, for example `tests/manifest-loader.test.ts` and `tests/change-budget.test.ts`.

**Directories:**
- Use lowercase directory names that reflect architectural role rather than feature names, for example `src/core/engine`, `src/core/state`, `src/adapters/fs`, and `src/app/services`.
- Nest by responsibility, not by class name. Add new infrastructure code under the matching adapter subdirectory instead of directly under `src/`.

## Where to Add New Code

**New Feature:**
- Primary code: add orchestration in `src/app/services/` and shared domain logic in the relevant `src/core/` subdirectory.
- Tests: add integration coverage in `tests/` beside the nearest existing subject test, or add new fixtures in `tests/fixtures/` when the feature needs manifest or repo scaffolds.

**New CLI Command:**
- Implementation: add `src/cli/commands/<command>.ts`
- Wiring: register it from `src/cli/main.ts`
- Reuse: call an application service from `src/app/services/` instead of embedding store setup directly in the command

**New MCP Tool:**
- Implementation: register it in `src/mcp/server.ts`
- Reuse: route through `src/app/services/` or existing `src/core/` APIs; do not fork logic away from the CLI path

**New Core Policy or Algorithm:**
- Implementation: add deterministic policy/state code to `src/core/state/` or orchestration helpers to `src/core/engine/`
- Contracts: add or extend types in `src/core/model/` and `src/core/manifest/` first when the feature changes persisted or configured data

**New Adapter or External Integration:**
- Implementation: add it under `src/adapters/<area>/`
- Contracts: bind it to an existing or new port in `src/core/ports/` when the core should stay infrastructure-agnostic

**Utilities:**
- Shared helpers: put small non-domain helpers in `src/shared/`
- Avoid: adding generic helpers to `src/core/` unless they directly participate in runtime policy or records

**New Template Content:**
- Implementation: add a new subtree under `templates/<template-name>/`
- Wiring: keep `src/shared/template-utils.ts` generic; `src/cli/commands/init.ts` already copies templates by directory name

## Special Directories

**`.planning/codebase/`:**
- Purpose: generated mapping documents for planning tools
- Generated: Yes
- Committed: Yes

**`dist/`:**
- Purpose: compiled JavaScript and declaration output from `tsc`
- Generated: Yes
- Committed: Yes

**`templates/writing/`:**
- Purpose: packaged runtime example consumed by `rrx init` and `rrx demo`
- Generated: No
- Committed: Yes

**`tests/fixtures/`:**
- Purpose: static manifests and fixture data for automated tests
- Generated: No
- Committed: Yes

**`spike/`:**
- Purpose: prototype and research work that informs the runtime but is not part of the shipped `src/` tree
- Generated: Mixed
- Committed: Yes

**`.ralph/`:**
- Purpose: runtime state directory created inside initialized target repos according to `storage.root` in `src/core/manifest/schema.ts`
- Generated: Yes
- Committed: No in normal usage

---

*Structure analysis: 2026-04-05*
