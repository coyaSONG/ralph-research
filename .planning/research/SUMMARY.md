# Project Research Summary

**Project:** ralph-research
**Domain:** local-first recursive research runtime for repo-mutating CLI and MCP workflows
**Researched:** 2026-04-05
**Confidence:** HIGH

## Executive Summary

`ralph-research` is already the right kind of product: a local-first runtime that evaluates candidate changes against real artifacts and can promote accepted work back into a real repository. The research is consistent on one point: trustworthy local runtimes are not defined by more autonomy, but by whether the operator can stop, inspect, resume, review, and repair a run without guessing what happened or corrupting the repo. The current architecture is close, but the control plane is not durable enough yet because runtime truth is split across JSON files, worktrees, and Git side effects.

The recommended approach is to keep the existing TypeScript + Node + Vitest stack, keep Git worktrees as the isolation model, and replace file-per-record operational state with a single SQLite-backed control plane. That control plane should own compiled manifest contracts, DB-backed leases, a durable step journal, promotion records, frontier projections, and operator-facing read models. Auto-accept and manual accept must converge on the same promotion pipeline so frontier semantics and recovery behavior stay identical regardless of who approves.

The main risks are false resume, non-transactional acceptance, frontier corruption through alternate code paths, and stale lock takeover during long-running work. Mitigation is straightforward but non-optional: phase-aware checkpoints, renewable leases with fencing, explicit acceptance sub-steps, rebuildable frontier projections, migration/version discipline, and crash-injection tests around every destructive boundary. Phase 1 should establish the truthful runtime contract and resumable control plane; later phases can then harden acceptance repair, frontier integrity, and shell/repair tooling on top of that foundation.

## Key Findings

### Recommended Stack

The stack recommendation is conservative by design. Do not rewrite the runtime or expand product surface in this milestone. Keep Node 24.x, TypeScript 5.9.x, and Vitest 3.x. The high-value change is to adopt `better-sqlite3` 12.8.0 as the canonical local runtime store, with SQLite WAL mode and durability-first pragmas, while leaving large artifacts, logs, patches, and workspaces on disk.

This stack supports the actual problem shape: a single-host CLI/MCP runtime that needs explicit transactions, savepoints, leases, durable run metadata, and predictable repair behavior. The research explicitly rejects `node:sqlite` for now because it remains active-development experimental, and rejects ORMs because the hard part is not CRUD ergonomics but clear transaction boundaries and auditability.

**Core technologies:**
- `Node.js 24.x`: existing CLI and MCP host runtime; stable base for hardening instead of rewriting.
- `TypeScript 5.9.x`: contract and workflow implementation language; strengthens state transitions and compiled plan types.
- `Vitest 3.x`: regression and interruption test runner; needed for crash-injection and replay safety coverage.
- `better-sqlite3 12.8.0`: canonical local runtime store; gives explicit transactions, savepoints, and durable single-host coordination.
- `SQLite 3.51.3`: durable control-plane engine; supports WAL, strict tables, integrity checks, and repair-oriented state handling.
- `Zod 4.x`: single contract authority; validates manifests and persisted payloads and can emit JSON Schema for tooling/docs.
- `Git worktrees`: workspace isolation boundary; still the right way to isolate candidate changes without inventing another workspace backend.

### Expected Features

For this domain, table stakes are mostly trust features, not product breadth. The runtime must resume from persisted execution state, expose explicit interruption states, enforce an honest manifest/runtime contract, support diff-first human review, isolate agent changes in Git-backed workspaces, and provide inspectable evidence through stable status and inspect surfaces. Manual accept/reject must use the same semantics as automated acceptance.

Differentiators are secondary. Transactional accept-and-repair, frontier-aware review UX, searchable run replay, repo policy hooks, and richer observability UI are valuable, but only after the core trust contract is real. The research is explicit that fake resume, silent contract drift, non-transactional accept paths, default auto-approve, and split manual-review code paths would actively reduce trust.

**Must have (table stakes):**
- Phase-aware resume from persisted execution state with stable `run_id`.
- Crash-safe checkpoints and explicit states such as `paused`, `resume_required`, `repair_required`, and `blocked_manual`.
- Honest manifest/capability validation with fail-fast rejection of unsupported options.
- Diff-first review before promotion, with metrics delta, rationale, and touched paths.
- Git-backed isolation plus reliable cleanup and one-step undo boundaries.
- Structured run evidence for `status`, `inspect`, and frontier views.
- Shared accept/reject semantics across automated and manual paths.

**Should have (competitive):**
- Transactional accept-and-repair workflow with resumable promotion stages.
- Frontier-aware comparison and review UX that explains membership changes and metric deltas.
- Searchable run timeline and replay for forensics and milestone audits.
- Repo policy hooks and deterministic guardrails around protected files or commands.

**Defer (v2+):**
- Risk-based approval escalation.
- Rich TUI or HTML observability UI.
- Broader workspace backend expansion beyond Git worktrees.
- Product-surface expansion beyond the current writing flow and thin MCP surface.

### Architecture Approach

The architecture should stay layered, but the missing layer is a durable control plane. Compile `ralph.yaml` into a `CompiledRunPlan` before any run starts. Use a SQLite execution store for runs, run steps, decisions, leases, events, frontier entries, and promotion metadata. Keep workspaces, patches, and large artifacts on disk. Drive execution through a deterministic workflow orchestrator that advances a durable step journal and calls side-effect executors for workspace, experiment, promotion, Git commit, frontier projection, and cleanup. Read models should power `status`, `inspect`, and frontier views from projections instead of reconstructing truth from scattered JSON and filesystem state.

**Major components:**
1. `Manifest Compiler` — turns `ralph.yaml` into an executable `CompiledRunPlan` and rejects unsupported surface early.
2. `Workflow Orchestrator` — owns run lifecycle, step sequencing, replay rules, and transition policy.
3. `Execution Store` — persists runs, steps, decisions, leases, events, and promotion/frontier metadata in SQLite.
4. `Workspace Manager` — creates, reopens, reconciles, and cleans Git worktree-based candidate workspaces.
5. `Experiment Executor` — runs proposer, experiment, metrics, and judge packs and persists outputs/artifact pointers.
6. `Decision Engine` — computes accept/reject/manual decisions under ratchet/frontier policy.
7. `Promotion Coordinator` — executes accept as a resumable multi-step workflow transaction.
8. `Manual Review Gateway` — records human approval/rejection and unblocks the same workflow graph used by automation.
9. `Frontier Projector` — maintains canonical frontier projections and rebuildable derived state.
10. `Read Models` — serve truthful `status`, `inspect`, and frontier responses from durable facts.

### Critical Pitfalls

1. **Heartbeat-free lockfiles** — replace fixed-TTL lockfiles with renewable DB-backed leases, fence destructive steps with the current lease token, and make takeover an explicit repair action.
2. **Resume without replayable execution history** — model each step as a durable journal entry with outputs and idempotency metadata; resume from persisted history, not a coarse phase enum.
3. **Non-transactional acceptance** — split acceptance into explicit sub-states such as `prepared`, `promoted`, `committed`, `frontier_saved`, `cleaned`, and `completed`, with repair metadata at each boundary.
4. **Frontier corruption through alternate code paths** — make frontier a rebuildable projection and route manual approval through the same frontier transition logic as automated acceptance.
5. **Persisted-state schema drift** — version the store and record families, migrate on open, fail fast on unknown versions, and keep migrations tested and forward-only.

## Implications for Roadmap

Based on the research, suggested phase structure:

### Phase 1: Trustworthy Runtime Foundation
**Rationale:** Everything else depends on truthful contracts and real resume semantics. If Phase 1 is weak, later acceptance and review work will sit on a false recovery model.
**Delivers:** `CompiledRunPlan`, preflight capability probes, SQLite execution store, DB-backed renewable leases, durable step journal, stable `run_id` resume, and operator-visible blocked/repair states.
**Addresses:** phase-aware resume, crash-safe checkpoints, honest contract surface, structured run evidence.
**Avoids:** fake resume, silent contract drift, heartbeat-free stale-lock recovery.

### Phase 2: Acceptance Transaction And Promotion Repair
**Rationale:** Once the control plane is durable, the next highest-risk gap is that accepted decisions can diverge from repo and frontier reality.
**Delivers:** promotion record model, idempotent promotion stages, durable commit/frontier effect tracking, replay-safe accept path, and repair/resume handling for partial promotions.
**Uses:** SQLite transactions/savepoints, Git worktrees, persisted patch or changed-path manifests.
**Implements:** promotion coordinator and side-effect executor boundaries.
**Avoids:** non-transactional accept path, duplicate commits, partial promotion ambiguity.

### Phase 3: Frontier Integrity And Manual Review Unification
**Rationale:** Manual review is already part of the product, but today it is a semantic fork. Fixing it after acceptance transactions prevents duplicating frontier logic again.
**Delivers:** `blocked_manual` state, shared accept/reject workflow graph, rebuildable frontier projections, and invariant checks for single-best and Pareto strategies.
**Addresses:** diff-first review, shared accept/reject semantics, truthful `status` and `inspect`.
**Avoids:** frontier overwrite bugs, diverging manual-review semantics, inconsistent read surfaces.

### Phase 4: Store Versioning And Migration Discipline
**Rationale:** Once SQLite is authoritative, storage evolution itself becomes a trust boundary and must be made explicit before more features pile on.
**Delivers:** store versioning, migration runner, integrity/open checks, forward-only migrations, and rebuild/export paths for projections.
**Addresses:** honest long-lived persisted state and cross-version recovery.
**Avoids:** silent schema drift and ad hoc repair-by-editing.

### Phase 5: Shell Execution Hardening
**Rationale:** The execution boundary should only be tightened after the core workflow semantics are trustworthy; otherwise shell cleanup still lacks a durable owner.
**Delivers:** argv-first execution contracts, env allowlists, durable stdout/stderr artifacts, timeouts, and opt-in shell compatibility mode.
**Addresses:** deterministic execution boundaries and safer replay.
**Avoids:** opaque command strings, ambient secret inheritance, parsing drift, and shell-driven control flow.

### Phase 6: Doctor Tooling And Crash-Recovery Test Matrix
**Rationale:** Repair tooling and interruption tests are the proving ground for the earlier phases; they validate that the new runtime claims are actually true.
**Delivers:** `doctor` / repair flows for workspaces, leases, and partial promotions; crash-injection harness; same-`run_id` recovery tests; frontier/manual-review regressions.
**Addresses:** operator confidence, long-term maintainability, and future roadmap safety.
**Avoids:** regressions that only appear in real repos after interruption.

### Phase Ordering Rationale

- Phase 1 comes first because trustworthy local runtimes require a truthful control plane before any repairable acceptance or review semantics can exist.
- Phase 2 follows because acceptance is the highest-severity correctness boundary once resume is real; it is where repo mutation, Git commits, and frontier persistence cross system boundaries.
- Phase 3 is separate so manual review and frontier semantics can be unified on top of the new promotion pipeline rather than rebuilt twice.
- Phase 4 comes after the runtime store exists; versioning and migration discipline only matter once SQLite is the source of truth.
- Phase 5 is later because shell execution hardening is important but does not unblock trustworthy resume and promotion.
- Phase 6 closes the loop by making the new guarantees testable and repairable under interruption, stale leases, and worktree drift.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** commit/promotion repair semantics may need a tighter decision on patch-based promotion versus direct workspace projection.
- **Phase 4:** migration and rebuild strategy needs careful planning if existing JSON state must be imported rather than reset.
- **Phase 5:** command execution hardening may require targeted repo-specific review of current proposer/experiment/judge command shapes.

Phases with standard patterns (skip research-phase):
- **Phase 1:** compiled config, SQLite control-plane store, WAL durability, leases, and step journals are well-documented patterns.
- **Phase 3:** manual-review unification and projection-based read models are straightforward once Phase 2 exists.
- **Phase 6:** crash-injection and recovery regression patterns are standard for this repo’s existing temp-repo integration style.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official Node, SQLite, Git, and better-sqlite3 guidance strongly supports the recommended local-first runtime stack. |
| Features | HIGH | Table-stakes patterns are consistent across comparable tools; differentiator ordering is slightly more inferential but directionally clear. |
| Architecture | HIGH | The codebase already has most needed layers; research converges on adding a durable control plane rather than changing the whole shape. |
| Pitfalls | HIGH | The identified pitfalls map directly onto current repo concerns and are reinforced by established runtime/storage guidance. |

**Overall confidence:** HIGH

### Gaps to Address

- **Existing-state migration scope:** decide during planning whether this milestone must import current JSON runtime history or can invalidate/reset it with a one-time migration boundary.
- **Promotion artifact format:** choose whether repair should rely on persisted patches, changed-path manifests, or both before Phase 2 implementation starts.
- **Lease takeover UX:** decide how much operator ceremony is required for forced takeover versus automated repair classification.
- **Shell contract surface:** inventory current command execution patterns before tightening defaults so compatibility breaks are deliberate.

## Sources

### Primary (HIGH confidence)
- [STACK.md](/Users/chsong/Developer/Personal/ralph-research/.planning/research/STACK.md)
- [FEATURES.md](/Users/chsong/Developer/Personal/ralph-research/.planning/research/FEATURES.md)
- [ARCHITECTURE.md](/Users/chsong/Developer/Personal/ralph-research/.planning/research/ARCHITECTURE.md)
- [PITFALLS.md](/Users/chsong/Developer/Personal/ralph-research/.planning/research/PITFALLS.md)
- [PROJECT.md](/Users/chsong/Developer/Personal/ralph-research/.planning/PROJECT.md)
- SQLite WAL, transactions, pragmas, strict tables, and optimize guidance
- Git worktree and lockfile references
- Node child process and SQLite docs
- better-sqlite3 release and API documentation

### Secondary (MEDIUM confidence)
- LangGraph durable resume patterns
- OpenAI Agents SDK human-in-the-loop and tracing patterns
- OpenHands and Codex CLI resume/review/status patterns
- aider git-backed isolation and undo guidance
- Temporal durable execution and replay patterns
- Claude Code hooks and policy controls

---
*Research completed: 2026-04-05*
*Ready for roadmap: yes*
