# Codebase Concerns

**Analysis Date:** 2026-04-05

## Tech Debt

**Manifest/runtime drift: declared capabilities exceed implemented runtime**
- Issue: The manifest schema advertises `project.workspace`, `project.baselineRef`, and `operator_llm`, but the runtime always creates Git worktrees from `HEAD` and only executes `command` proposers.
- Files: `src/core/manifest/schema.ts`, `src/core/engine/workspace-manager.ts`, `src/core/engine/cycle-runner.ts`, `templates/writing/ralph.yaml`, `tests/fixtures/manifests/valid-writing.ralph.yaml`
- Impact: Valid manifests can parse successfully and still fail at execution time, and manifest fields such as `baselineRef` and `workspace: copy` create false expectations for users and future contributors.
- Fix approach: Either remove unsupported schema branches and fields, or implement a workspace strategy abstraction that honors `project.workspace` and `project.baselineRef`, plus a real `operator_llm` proposer execution path.

**Recovery model exists on paper but not in execution**
- Issue: The service emits `resume_required` and computes `RecoveryPlan`, but `RunCycleService.run()` does not resume a persisted run. Passing `resume: true` bypasses the guard and starts a fresh `runCycle()` instead of continuing from the saved phase.
- Files: `src/app/services/run-cycle-service.ts`, `src/core/state/run-state-machine.ts`, `src/core/engine/cycle-runner.ts`
- Impact: Users can be told a run is recoverable while the runtime cannot actually continue it. Partial failures produce state that looks resumable but is not replayed safely.
- Fix approach: Add phase-aware recovery handlers for `execute_experiment`, `evaluate_metrics`, `write_decision`, `commit_candidate`, and `update_frontier`, and make `resume` load the latest run plus workspace instead of creating a new run id.

**Accepted-path persistence is non-transactional**
- Issue: The accepted decision is persisted before workspace promotion, commit, frontier save, and cleanup. Any failure after decision write leaves mixed state across `runs/`, `decisions/`, `frontier.json`, Git history, and `.ralph/workspaces/`.
- Files: `src/core/engine/cycle-runner.ts`, `src/core/state/run-state-machine.ts`, `src/adapters/git/git-client.ts`, `src/core/engine/workspace-manager.ts`
- Impact: A run can end in `failed` after an `accepted` decision record already exists, leaving manual cleanup and forensic repair as the only recovery path.
- Fix approach: Persist an explicit acceptance transaction state, add idempotent repair steps, and treat commit/frontier promotion as a resumable workflow rather than a best-effort sequence inside one `try` block.

## Known Bugs

**`--resume` does not resume the interrupted run**
- Symptoms: The CLI and service expose a resume pathway, but no code reloads the interrupted workspace or advances the existing run from its saved phase.
- Files: `src/cli/commands/run.ts`, `src/app/services/run-cycle-service.ts`, `src/core/state/run-state-machine.ts`
- Trigger: Start a run, interrupt it after `proposed`, `executed`, `evaluated`, `decision_written`, or `committed`, then run `rrx run --resume`.
- Workaround: Clean up the partial run manually and start a new cycle. There is no built-in resume execution path.

**Manual acceptance collapses the frontier to one entry**
- Symptoms: Human acceptance always writes a single-entry frontier snapshot and sets `afterFrontierIds` to only the accepted run.
- Files: `src/app/services/manual-decision-service.ts`
- Trigger: Use `ManualDecisionService.accept()` for a `needs_human` run in a manifest that expects a multi-entry frontier, especially `frontier.strategy=pareto`.
- Workaround: Avoid manual acceptance for Pareto workflows until the service merges the accepted candidate into the existing frontier using the same update logic as `runCycle()`.

## Security Considerations

**Manifest-driven shell execution inherits the full process environment**
- Risk: Proposer, experiment, command metric, and judge commands all execute with `shell: true` and merge `process.env` into the child environment.
- Files: `src/adapters/proposer/command-proposer.ts`, `src/core/engine/experiment-runner.ts`, `src/adapters/extractor/command-extractor.ts`, `src/adapters/judge/llm-judge-provider.ts`
- Current mitigation: Timeouts exist for command execution, and manifests are loaded from local files.
- Recommendations: Treat manifests as trusted code only, document that assumption clearly, add allowlists for inherited env vars, prefer argv-based execution where possible, and add a "safe mode" that disables shell expansion for common cases.

**Local automation can commit directly into the repo with no policy hook**
- Risk: Accepted candidates stage and commit directly through `git add -A -- <paths>` and `git commit -m ...`, with no review gate, branch isolation, or repository policy adapter.
- Files: `src/core/engine/cycle-runner.ts`, `src/adapters/git/git-client.ts`, `src/app/services/manual-decision-service.ts`
- Current mitigation: Scope checks and metric gates reduce bad accepts, and `needs_human` prevents some low-confidence promotion.
- Recommendations: Add branch-based promotion, optional dry-run mode, commit signing/policy hooks, and an adapter layer for repo-specific commit workflows.

## Performance Bottlenecks

**Run creation and status calls scan the entire run history**
- Problem: New run ids are computed by loading all runs, and project status loads all runs plus all decisions on each request.
- Files: `src/core/engine/cycle-runner.ts`, `src/adapters/fs/json-file-run-store.ts`, `src/adapters/fs/json-file-decision-store.ts`, `src/app/services/project-state-service.ts`
- Cause: The storage model is file-per-record with no index or append-only ledger. `list()` reads and parses every JSON file before sorting.
- Improvement path: Introduce monotonic counters or a metadata index for next run ids, and add targeted queries for latest run, pending-human runs, and recent decisions.

**Long judge packs and anchor checks execute serially**
- Problem: Each anchor prompt is evaluated per repeat and per judge in a nested loop, and every metric evaluation runs sequentially.
- Files: `src/core/engine/anchor-checker.ts`, `src/core/engine/judge-pack.ts`, `src/core/engine/cycle-runner.ts`
- Cause: The implementation favors simplicity over concurrency or batching.
- Improvement path: Parallelize per-judge requests within configured limits, cache anchor results by pack/version, and persist anchor health separately from per-run evaluation.

## Fragile Areas

**Lock lifetime can expire during a legitimate run**
- Files: `src/adapters/fs/lockfile.ts`, `src/app/services/run-cycle-service.ts`, `src/app/services/manual-decision-service.ts`
- Why fragile: Locks use a fixed five-minute TTL, but `updatedAt` is never refreshed once acquired. A long experiment or LLM judge run can make a live lock look stale and allow a second process to remove and replace it.
- Safe modification: Add a heartbeat or lease-renewal mechanism tied to active runs, and keep release idempotent even after lock replacement.
- Test coverage: `tests/lockfile-workspace-manager.test.ts` covers stale-lock takeover and release behavior, but it does not cover long-running leases under active work.

**Workspace promotion mixes filesystem copying, Git diff parsing, and destructive cleanup**
- Files: `src/core/engine/workspace-manager.ts`, `src/core/engine/cycle-runner.ts`
- Why fragile: Promotion copies modified and untracked files individually, removes deleted files directly from the repo root, and then relies on later Git commit and cleanup steps to complete. Any interruption leaves a half-promoted working tree.
- Safe modification: Keep promotion idempotent, stage to a temporary area before copying into the repo root, and add repair tooling for abandoned workspaces plus partial promotions.
- Test coverage: `tests/lockfile-workspace-manager.test.ts` exercises basic creation, promotion, and abandoned workspace detection, but not partial promotion failures or binary/large-file scenarios.

**Manual review and status surfaces are lightly defended**
- Files: `src/app/services/manual-decision-service.ts`, `src/app/services/project-state-service.ts`, `src/mcp/server.ts`
- Why fragile: These services mediate persisted run state and external interfaces, but they rely on optimistic assumptions about stored records and frontier shape.
- Safe modification: Add dedicated integration tests before changing record schemas, frontier semantics, or MCP payloads.
- Test coverage: No dedicated test file targets `src/app/services/manual-decision-service.ts`, `src/app/services/project-state-service.ts`, or `src/mcp/server.ts`.

## Scaling Limits

**History storage scales poorly beyond small local projects**
- Current capacity: Comfortable for dozens of runs and decisions stored under `.ralph/runs/` and `.ralph/decisions/`.
- Limit: Hundreds or thousands of runs will make run creation, status inspection, and decision listing increasingly slow because each operation reparses the full directory.
- Scaling path: Move to an indexed store such as SQLite or an append-only event log with materialized summaries for latest frontier and pending work.

**Runtime model assumes a single local operator**
- Current capacity: One active local process per repo, guarded by a lock file.
- Limit: Multi-process or multi-user usage breaks down once lock TTLs expire or multiple automations share the same repository.
- Scaling path: Replace local file locks with lease renewal plus stronger ownership semantics, or isolate runs onto branches/worktrees with explicit coordination.

## Dependencies at Risk

**External judge CLIs are assumed, not validated**
- Risk: The judge adapter can generate commands for `codex exec` or `claude -p`, but there is no startup validation that those CLIs exist or are correctly authenticated.
- Impact: LLM-backed manifests fail only at runtime, often after a run record and workspace already exist.
- Migration plan: Add preflight validation in `doctor` or `validate`, and move judge backend setup into an explicit capability probe.

## Missing Critical Features

**`operator_llm` proposer execution**
- Problem: The schema and fixture manifests allow `operator_llm`, but the cycle runner rejects every non-`command` proposer.
- Blocks: Any research program that depends on operator-based LLM proposal generation.

**`project.workspace=copy` and `project.baselineRef`**
- Problem: Both fields exist in the manifest model, but workspaces are always Git worktrees detached from `HEAD`.
- Blocks: Non-Git workflows, baseline pinning to a non-`HEAD` ref, and honest support for the manifest contract.

**True phase resume after interruption**
- Problem: Recovery metadata exists, but there is no re-entry implementation.
- Blocks: Reliable long-running automation, safe repair after crashes, and resumable post-decision promotion.

## Test Coverage Gaps

**Manual decision flows**
- What's not tested: Accept/reject behavior, frontier updates, commit writing, and cleanup for `needs_human` runs.
- Files: `src/app/services/manual-decision-service.ts`
- Risk: The current single-entry frontier bug can persist unnoticed because no dedicated tests exercise manual acceptance semantics.
- Priority: High

**Project status, inspect, and MCP server surfaces**
- What's not tested: `getProjectStatus()`, `getProjectFrontier()`, `inspectRun()`, and MCP tool registration/serialization.
- Files: `src/app/services/project-state-service.ts`, `src/mcp/server.ts`
- Risk: API shape regressions and stale explainability fields can break CLI or MCP consumers without failing the current suite.
- Priority: Medium

**Recovery after partial accept-path failures**
- What's not tested: Failures after `decision_written`, after commit, after frontier save, and behavior of `--resume` against persisted partial runs.
- Files: `src/core/engine/cycle-runner.ts`, `src/app/services/run-cycle-service.ts`, `src/core/state/run-state-machine.ts`
- Risk: The most operationally expensive failures occur in exactly the path that lacks recovery tests.
- Priority: High

---

*Concerns audit: 2026-04-05*
