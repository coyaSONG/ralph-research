# Architecture

**Analysis Date:** 2026-04-05

## Pattern Overview

**Overall:** Layered ports-and-adapters architecture around a local research-cycle engine.

**Key Characteristics:**
- Keep orchestration in `src/app/services/` and `src/core/engine/`; keep transport concerns in `src/cli/` and `src/mcp/`.
- Express persistence behind ports in `src/core/ports/` and satisfy them with filesystem adapters in `src/adapters/fs/`.
- Treat Git worktrees plus `.ralph` state as first-class runtime infrastructure; the runtime mutates repositories through `src/core/engine/workspace-manager.ts` and `src/adapters/git/git-client.ts`.

## Layers

**Transport Layer:**
- Purpose: expose the runtime to humans and tools.
- Location: `src/cli/main.ts`, `src/cli/commands/*.ts`, `src/mcp/main.ts`, `src/mcp/server.ts`
- Contains: Commander command registration, JSON/text output formatting, MCP tool definitions, transport bootstrapping.
- Depends on: `src/app/context.ts`, `src/app/services/run-cycle-service.ts`, `src/app/services/project-state-service.ts`, `src/app/services/manual-decision-service.ts`
- Used by: the built CLI binary at `dist/cli/main.js` and the stdio MCP process started from `src/mcp/main.ts`

**Application Service Layer:**
- Purpose: assemble dependencies per request and coordinate use cases.
- Location: `src/app/services/run-cycle-service.ts`, `src/app/services/project-state-service.ts`, `src/app/services/manual-decision-service.ts`
- Contains: manifest loading, `.ralph` path resolution, lock acquisition, store creation, service-level accept/reject/status/inspect flows.
- Depends on: adapters in `src/adapters/`, state transitions in `src/core/state/run-state-machine.ts`, orchestration in `src/core/engine/`
- Used by: `src/cli/commands/*.ts` and `src/mcp/server.ts`

**Core Engine Layer:**
- Purpose: run a bounded candidate cycle and compute the acceptance decision.
- Location: `src/core/engine/*.ts`
- Contains: cycle orchestration in `src/core/engine/cycle-runner.ts`, experiment execution in `src/core/engine/experiment-runner.ts`, worktree management in `src/core/engine/workspace-manager.ts`, guardrails such as `src/core/engine/change-budget.ts`, `src/core/engine/anchor-checker.ts`, and `src/core/engine/audit-sampler.ts`
- Depends on: manifest/model/ports modules in `src/core/manifest/`, `src/core/model/`, `src/core/ports/`, plus concrete adapters for proposer, extractor, judge provider, and Git
- Used by: `src/app/services/run-cycle-service.ts`

**Core State and Policy Layer:**
- Purpose: make decisions deterministic and reusable outside transport code.
- Location: `src/core/state/*.ts`
- Contains: frontier updates in `src/core/state/frontier-engine.ts`, ratchet policies in `src/core/state/ratchet-engine.ts`, constraint checks in `src/core/state/constraint-engine.ts`, resumability rules in `src/core/state/run-state-machine.ts`
- Depends on: manifest types from `src/core/manifest/schema.ts` and records from `src/core/model/*.ts`
- Used by: `src/core/engine/cycle-runner.ts`, `src/app/services/manual-decision-service.ts`

**Domain Schema and Contract Layer:**
- Purpose: define the stable shapes the rest of the system passes around.
- Location: `src/core/manifest/schema.ts`, `src/core/manifest/defaults.ts`, `src/core/model/*.ts`, `src/core/ports/*.ts`
- Contains: `RalphManifest`, run/decision/frontier records, metric definitions, store interfaces.
- Depends on: `zod` schemas and default constants.
- Used by: every higher layer.

**Adapter Layer:**
- Purpose: isolate filesystem, Git, command execution, and LLM judge integration behind narrow APIs.
- Location: `src/adapters/fs/*.ts`, `src/adapters/git/git-client.ts`, `src/adapters/proposer/command-proposer.ts`, `src/adapters/extractor/*.ts`, `src/adapters/judge/llm-judge-provider.ts`
- Contains: JSON persistence, manifest loading, lockfiles, Git commit helper, command proposer/metric extraction, CLI-backed judge provider.
- Depends on: Node filesystem/path APIs, `execa`, and core contracts.
- Used by: application services and the cycle runner.

## Data Flow

**Research Cycle:**

1. `src/cli/commands/run.ts` or the `run_research_cycle` tool in `src/mcp/server.ts` calls `RunCycleService` in `src/app/services/run-cycle-service.ts`.
2. `RunCycleService` resolves the manifest, acquires the `.ralph` lock via `src/adapters/fs/lockfile.ts`, constructs JSON stores, loads the current frontier, and instantiates `GitWorktreeWorkspaceManager` plus `GitClient`.
3. `src/core/engine/cycle-runner.ts` creates a run record, prepares one or more candidate workspaces, runs the proposer from `src/adapters/proposer/command-proposer.ts`, then runs the experiment from `src/core/engine/experiment-runner.ts`.
4. The cycle evaluates metrics through `src/adapters/extractor/command-extractor.ts` or `src/adapters/extractor/llm-judge-extractor.ts`, then applies constraints, change-budget checks, anchor checks, and ratchet/frontier logic from `src/core/state/*.ts` and `src/core/engine/*.ts`.
5. The cycle persists `RunRecord` and `DecisionRecord` instances into `.ralph` using `src/adapters/fs/json-file-run-store.ts` and `src/adapters/fs/json-file-decision-store.ts`.
6. Accepted candidates are promoted from the worktree back into the repo by `src/core/engine/workspace-manager.ts`, committed by `src/adapters/git/git-client.ts`, and written to frontier state through `src/adapters/fs/json-file-frontier-store.ts`.

**Manual Review Flow:**

1. `src/cli/commands/accept.ts` or `src/cli/commands/reject.ts` calls `ManualDecisionService` in `src/app/services/manual-decision-service.ts`.
2. The service reloads the pending-human run and its decision record from `.ralph`.
3. Accept paths promote the candidate workspace and commit it; reject paths keep the incumbent frontier.
4. Both paths finalize the run through `advanceRunPhase` in `src/core/state/run-state-machine.ts` and clean up the candidate workspace.

**Read-Only Inspection Flow:**

1. `src/cli/commands/status.ts`, `src/cli/commands/frontier.ts`, `src/cli/commands/inspect.ts`, and MCP status/frontier tools call `src/app/services/project-state-service.ts`.
2. `project-state-service` reconstructs the current view from manifest + `.ralph` JSON stores without touching worktrees or Git history.

**State Management:**
- Persistent runtime state lives under `manifest.storage.root`, which defaults to `.ralph` via `src/core/manifest/defaults.ts`.
- Mutable workflow state is represented by `RunRecord`, `DecisionRecord`, and `FrontierEntry` in `src/core/model/*.ts`.
- Phase transitions are centralized in `src/core/state/run-state-machine.ts`; do not hand-edit run status logic in CLI or service code.

## Key Abstractions

**Manifest-Driven Runtime:**
- Purpose: all runtime behavior is described by `ralph.yaml`.
- Examples: `src/core/manifest/schema.ts`, `templates/writing/ralph.yaml`, `src/adapters/fs/manifest-loader.ts`
- Pattern: validate once with Zod, then pass typed `RalphManifest` objects downward.

**Store Ports + JSON Implementations:**
- Purpose: keep state persistence replaceable.
- Examples: `src/core/ports/run-store.ts`, `src/core/ports/decision-store.ts`, `src/core/ports/frontier-store.ts`, `src/adapters/fs/json-file-run-store.ts`, `src/adapters/fs/json-file-decision-store.ts`, `src/adapters/fs/json-file-frontier-store.ts`
- Pattern: services and engines depend on interfaces; JSON file adapters are composed at the application boundary.

**Workspace Promotion Model:**
- Purpose: isolate candidate changes from the main checkout until the ratchet accepts them.
- Examples: `src/core/engine/workspace-manager.ts`, `src/adapters/git/git-client.ts`, `tests/lockfile-workspace-manager.test.ts`
- Pattern: create detached Git worktrees, run changes there, copy accepted paths back, then commit only promoted files.

**Decision Policy Stack:**
- Purpose: turn raw metric outputs into an acceptance outcome.
- Examples: `src/core/state/ratchet-engine.ts`, `src/core/state/frontier-engine.ts`, `src/core/state/constraint-engine.ts`, `src/core/engine/change-budget.ts`, `src/core/engine/anchor-checker.ts`
- Pattern: compose multiple gates rather than embedding policy branches in transport or adapter code.

**Explainability Record:**
- Purpose: preserve enough run data to justify decisions later.
- Examples: `src/app/services/project-state-service.ts`, `src/core/model/run-record.ts`, `src/core/model/decision-record.ts`
- Pattern: write logs, metrics, rationale, changed paths, and frontier deltas into persisted records; inspection only reads those records back.

## Entry Points

**CLI Binary:**
- Location: `src/cli/main.ts`
- Triggers: `npm run dev`, built `rrx` binary from `package.json`, or direct Node execution of `dist/cli/main.js`
- Responsibilities: register commands, expose the `doctor` scaffold check, and delegate all business logic to command modules

**CLI Commands:**
- Location: `src/cli/commands/run.ts`, `src/cli/commands/init.ts`, `src/cli/commands/demo.ts`, `src/cli/commands/status.ts`, `src/cli/commands/frontier.ts`, `src/cli/commands/inspect.ts`, `src/cli/commands/accept.ts`, `src/cli/commands/reject.ts`, `src/cli/commands/validate.ts`, `src/cli/commands/serve-mcp.ts`
- Triggers: end-user `rrx` subcommands
- Responsibilities: parse options, format text/JSON output, map exit codes, and call one application service per command

**MCP Server Bootstrap:**
- Location: `src/mcp/main.ts`
- Triggers: `npm run mcp`
- Responsibilities: start stdio transport against the current working directory

**MCP Tool Registration:**
- Location: `src/mcp/server.ts`
- Triggers: MCP client tool calls
- Responsibilities: register `run_research_cycle`, `get_research_status`, and `get_frontier`; reuse the same services as CLI code

**Template Copying:**
- Location: `src/shared/template-utils.ts`
- Triggers: `src/cli/commands/init.ts` and `src/cli/commands/demo.ts`
- Responsibilities: materialize bundled templates from `templates/` into runnable repos

## Error Handling

**Strategy:** Throw typed or descriptive errors close to the failing adapter/core operation, then translate them into CLI exit codes or MCP text responses at the edge.

**Patterns:**
- Validation failures are raised during manifest load in `src/adapters/fs/manifest-loader.ts` using `RalphManifestSchema` from `src/core/manifest/schema.ts`.
- Runtime orchestration failures are caught inside `src/core/engine/cycle-runner.ts`, which writes a failed `RunRecord` instead of losing state.
- CLI commands such as `src/cli/commands/run.ts` and `src/cli/commands/init.ts` convert thrown errors into stderr text or JSON payloads and set non-zero exit codes.
- Filesystem adapters use `src/shared/fs-errors.ts` to normalize missing-file handling instead of scattering `ENOENT` checks.

## Cross-Cutting Concerns

**Logging:** Minimal process-level logging lives in `src/shared/logger.ts` and is currently used directly by `src/cli/main.ts` for the `doctor` command. Most flows rely on persisted run logs under `.ralph/runs/...` instead of structured runtime logging.

**Validation:** Use Zod schemas in `src/core/manifest/schema.ts`, `src/core/model/run-record.ts`, `src/core/model/decision-record.ts`, `src/core/model/frontier-entry.ts`, and `src/core/model/metric.ts` to validate input and persisted state boundaries.

**Authentication:** Not applicable inside the runtime. External judge/auth concerns are delegated to shell commands executed by `src/adapters/judge/llm-judge-provider.ts`; the repo does not contain an internal auth layer.

---

*Architecture analysis: 2026-04-05*
