# External Integrations

**Analysis Date:** 2026-04-05

## APIs & External Services

**Local Process Orchestration:**
- Shell-command execution - The core runtime delegates proposing, experiment runs, and metric extraction to local commands defined in `ralph.yaml` and executed from `src/adapters/proposer/command-proposer.ts`, `src/core/engine/experiment-runner.ts`, and `src/adapters/extractor/command-extractor.ts`.
  - SDK/Client: `execa` from `src/adapters/proposer/command-proposer.ts`, `src/core/engine/experiment-runner.ts`, and `src/adapters/extractor/command-extractor.ts`
  - Auth: No hardcoded auth scheme. Commands inherit `process.env` plus manifest-provided env maps defined in `src/core/manifest/schema.ts`.

**Version Control:**
- Git CLI - Used for worktree creation, diff inspection, repo bootstrap, and acceptance commits in `src/core/engine/workspace-manager.ts`, `src/adapters/git/git-client.ts`, `src/cli/commands/init.ts`, and `src/cli/commands/demo.ts`.
  - SDK/Client: `execa` wrappers around the `git` binary in `src/adapters/git/git-client.ts` and `src/core/engine/workspace-manager.ts`
  - Auth: No application-managed auth. Git uses the developer’s local Git configuration and credentials outside this repository.

**MCP Host Integration:**
- Model Context Protocol over stdio - The repo exposes a local MCP server with three tools in `src/mcp/server.ts`, launched from `src/mcp/main.ts` or `src/cli/commands/serve-mcp.ts`.
  - SDK/Client: `@modelcontextprotocol/sdk` in `src/mcp/server.ts`
  - Auth: None in-repo. The server assumes local-process trust on stdio.

**Optional LLM Operator/Judge Backends:**
- Codex CLI and Claude CLI - An adapter exists in `src/adapters/judge/llm-judge-provider.ts` for `codex exec` and `claude -p` based judging, and manifest schema supports `operator_llm` and `llm_judge` definitions in `src/core/manifest/schema.ts`.
  - SDK/Client: `execaCommand` in `src/adapters/judge/llm-judge-provider.ts`
  - Auth: No repo-defined env var names. Credentials are expected to come from the parent shell environment consumed through `process.env`.
- Current wiring note - The shipped CLI and MCP flows instantiate `new RunCycleService()` without `createCliJudgeProvider(...)` in `src/cli/commands/run.ts`, `src/cli/commands/demo.ts`, and `src/mcp/server.ts`. Treat LLM judging as adapter support, not a fully wired default integration.
- Manifest examples - The optional model-driven path appears in `tests/fixtures/manifests/valid-writing.ralph.yaml`; the bundled starter template in `templates/writing/ralph.yaml` keeps a placeholder judge model and defaults to a numeric local metric.

## Data Storage

**Databases:**
- None - No PostgreSQL, MySQL, SQLite, MongoDB, or Redis client libraries are declared in `package.json`, and no network/database access code was detected in `src/`.
- Local JSON persistence - Run, decision, and frontier state are stored on disk by `src/adapters/fs/json-file-run-store.ts`, `src/adapters/fs/json-file-decision-store.ts`, and `src/adapters/fs/json-file-frontier-store.ts`.
  - Connection: Filesystem path selected by `storage.root` in `src/core/manifest/schema.ts`
  - Client: Filesystem adapters in `src/adapters/fs/*.ts`

**File Storage:**
- Local filesystem only - Templates are copied from `templates/` by `src/shared/template-utils.ts`, manifests are loaded by `src/adapters/fs/manifest-loader.ts`, and runtime state is read/written through the adapters in `src/adapters/fs/`.

**Caching:**
- None - No dedicated cache layer or cache service is implemented in `src/`.

## Authentication & Identity

**Auth Provider:**
- Custom/ambient shell environment only - The repo does not implement login, token exchange, or an auth provider. External command integrations inherit credentials from the parent environment in `src/adapters/proposer/command-proposer.ts`, `src/adapters/extractor/command-extractor.ts`, `src/core/engine/experiment-runner.ts`, and `src/adapters/judge/llm-judge-provider.ts`.
  - Implementation: Pass-through environment propagation with optional manifest-level env maps from `src/core/manifest/schema.ts`

## Monitoring & Observability

**Error Tracking:**
- None - No Sentry, Honeycomb, Datadog, or equivalent SDK is present in `package.json` or `src/`.

**Logs:**
- Local structured logs - `src/shared/logger.ts` creates a `pino` logger used by `src/cli/main.ts` for the `doctor` command. Most other flows rely on returned JSON payloads and persisted run artifacts under the storage root managed by `src/app/services/run-cycle-service.ts` and `src/app/services/project-state-service.ts`.

## CI/CD & Deployment

**Hosting:**
- Not applicable as a hosted service - Distribution is local CLI/MCP package execution via the `rrx` bin declared in `package.json`.

**CI Pipeline:**
- None detected - No GitHub Actions workflows, build pipeline configs, or hosted deployment manifests were found in the repository root during this scan.

## Environment Configuration

**Required env vars:**
- None hardcoded by the repository - No concrete variable names like `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` are declared in `src/`, `templates/`, or `package.json`.
- Internal runtime env vars injected by the engine are `RRX_HISTORY_ENABLED`, `RRX_HISTORY_SUMMARY`, and `RRX_HISTORY_PATH` in `src/core/engine/cycle-runner.ts`.
- Optional command-specific env vars may be supplied in manifest command blocks because `env` is part of `commandSpecSchema` in `src/core/manifest/schema.ts`.

**Secrets location:**
- Not stored in-repo - No `.env` files were detected at the repo root during this scan, and the code reads credentials only from the live process environment in `src/adapters/proposer/command-proposer.ts`, `src/adapters/extractor/command-extractor.ts`, `src/core/engine/experiment-runner.ts`, and `src/adapters/judge/llm-judge-provider.ts`.

## Webhooks & Callbacks

**Incoming:**
- None - `src/mcp/server.ts` exposes stdio tools only and there are no HTTP server endpoints in `src/`.

**Outgoing:**
- None - No HTTP client or webhook delivery code was detected in `src/`. External communication is process-based through local shell commands and stdio MCP only.

---

*Integration audit: 2026-04-05*
