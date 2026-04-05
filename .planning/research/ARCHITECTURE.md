# Architecture Patterns

**Domain:** local-first recursive research runtime / agentic CLI with repo mutation and manual review
**Researched:** 2026-04-05
**Overall confidence:** HIGH for runtime structure, MEDIUM for exact storage migration details

## Recommended Architecture

Use a split architecture:

1. **Compiled contract layer** for `ralph.yaml` to runtime-plan translation.
2. **Durable workflow ledger** for runs, steps, decisions, leases, and promotion state.
3. **Filesystem/Git side-effect layer** for workspaces, artifacts, promotion, and cleanup.
4. **Read-model layer** for status/frontier/inspect surfaces.

The current repo already has good separation between transport, services, engine, and adapters. The missing piece is not another layer. It is a durable control plane. Today, run state is spread across JSON files, worktrees, and Git side effects with no atomic boundary across them. That is why resume, manual acceptance, and post-decision recovery are weak.

For this milestone, the right move is:

- Keep artifacts, run logs, and workspaces on disk.
- Move control-plane state from file-per-record JSON into a single local SQLite database under `.ralph/state.db`.
- Treat every side-effectful transition as a named workflow step with persisted status and idempotency metadata.
- Route auto-accept and manual-accept through the same promotion pipeline.

SQLite is the right fit here because this is a single-host local-first tool. SQLite documents WAL mode, savepoints, and atomic commit behavior for same-host workloads, which matches this runtime well. WAL is explicitly not the right choice for network filesystems, but that is not this product's operating model. Temporal's workflow docs are also a good pattern reference here: persist immutable history, replay deterministic workflow state, and keep external side effects behind explicit activity boundaries rather than burying them inside in-memory orchestration.

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Manifest Compiler | Parse `ralph.yaml`, validate cross-field invariants, reject unsupported options, produce `CompiledRunPlan` | CLI/MCP, Workflow Orchestrator |
| Workflow Orchestrator | Own run lifecycle, step sequencing, resume rules, and transition policy | Manifest Compiler, Execution Store, Step Executors |
| Execution Store | Persist runs, step attempts, decisions, leases, recovery pointers, promotion records | Workflow Orchestrator, Read Models |
| Workspace Manager | Create/open/remove candidate workspaces from declared baseline and strategy | Workflow Orchestrator, Git Adapter |
| Experiment Executor | Run proposer, experiment, metrics, judge packs, and capture outputs | Workflow Orchestrator, Workspace Manager |
| Decision Engine | Produce ratchet/frontier decisions from metrics and constraints | Workflow Orchestrator |
| Promotion Coordinator | Execute accept path as a resumable multi-step transaction | Workflow Orchestrator, Workspace Manager, Git Adapter, Frontier Projector |
| Manual Review Gateway | Record human approve/reject input and enqueue the same transition graph used by automation | CLI/MCP, Workflow Orchestrator |
| Frontier Projector | Maintain canonical frontier state and projection tables for status/inspect | Promotion Coordinator, Execution Store |
| Read Models | Serve `status`, `frontier`, `inspect`, and MCP views without reconstructing from scattered files | CLI/MCP, Execution Store |

## Recommended Internal Shape

### Control Plane: SQLite

Store these tables in `.ralph/state.db`:

| Table | Purpose |
|-------|---------|
| `runs` | one row per logical run, stable `run_id`, manifest hash, current phase, current step |
| `run_steps` | step journal with `step_name`, `status`, attempt count, started/ended timestamps |
| `step_effects` | idempotency data such as workspace path, commit SHA, promoted paths snapshot |
| `decisions` | accepted/rejected/needs_human plus reasoning and actor metadata |
| `frontier_entries` | canonical frontier membership |
| `leases` | active lock/heartbeat ownership for long runs |
| `events` | append-only operator-visible audit trail for inspect/debug |

Keep these on disk outside SQLite:

- workspace directories under `.ralph/workspaces/`
- large stdout/stderr logs
- experiment artifacts
- optional diff snapshots or patches

This split keeps the transactional state small and robust while preserving simple filesystem access for bulky outputs.

### Runtime Contract Boundary

Do not let the engine branch on raw manifest objects after validation. Introduce:

```ts
type CompiledRunPlan = {
  manifestPath: string;
  manifestHash: string;
  workspaceStrategy: {
    kind: "git" | "copy";
    baselineRef: string;
  };
  proposerPlan: ...
  experimentPlan: ...
  decisionPlan: ...
  storagePlan: {
    dbPath: string;
    artifactRoot: string;
  };
};
```

The compiler is where unsupported features die. If `project.workspace=copy` or `baselineRef` is not implemented yet, reject it there. Do not keep pretending support exists deeper in the runtime.

### Workflow Boundary

The orchestrator should be a deterministic step runner over persisted state. It should decide:

- what the next legal step is
- whether a step is replayable
- whether a step is already complete
- whether compensation or repair is required

It should not directly do Git or filesystem mutations. Those belong in step executors that can report durable effect records back to the store.

## Data Flow

### Run Start

1. CLI or MCP calls `RunCycleService`.
2. Manifest Compiler loads `ralph.yaml` and emits `CompiledRunPlan`.
3. Workflow Orchestrator opens the execution store transaction, allocates `run_id`, writes `runs` + first `run_steps` row, and acquires a renewable lease.
4. Orchestrator dispatches the next step executor.

### Candidate Evaluation

1. `prepare_workspace`
2. `propose_candidate`
3. `execute_experiment`
4. `evaluate_metrics`
5. `compute_decision`
6. `persist_decision`

Each step writes its own durable completion record before the orchestrator advances the pointer. Resume means rereading the last completed step and continuing, not recreating a new run.

### Accept Path

1. `prepare_promotion`
2. `promote_workspace_to_repo`
3. `commit_repo_changes`
4. `project_frontier`
5. `finalize_run`
6. `cleanup_workspace`

Manual accept uses the same steps. The only difference is the actor on the decision record and the entry condition for the accept path.

### Reject Path

1. `persist_decision`
2. `finalize_run`
3. `cleanup_workspace`

### Read Flow

`status`, `frontier`, and `inspect` should read from projection tables and event/audit rows, not by re-listing entire directories or trying to infer truth from Git plus JSON fragments.

## Resume Model

Use a **step-journal replay model**, not a phase-only model.

### Principles

- `run_id` is stable across crashes and resumes.
- A run always has one current step pointer.
- Every step is one of `pending`, `running`, `succeeded`, `failed`, or `blocked_manual`.
- Every side-effectful step records an idempotency payload.
- Recovery chooses between `resume`, `repair`, or `abandon`, and that choice is explicit in persisted state.

### Lease Model

Replace the fixed-TTL lockfile with a renewable lease:

- acquire lease at run start
- heartbeat during long proposer/experiment/judge steps
- only allow takeover when the lease is expired and the prior owner is clearly dead

This directly addresses the current five-minute stale-lock hazard.

### Step Replay Rules

| Step Type | Resume Rule |
|-----------|-------------|
| Pure compute from persisted inputs | rerun freely |
| Workspace creation | reopen existing workspace if recorded |
| Experiment execution | reuse prior outputs if marked complete; otherwise rerun only if outputs are known incomplete |
| Decision persistence | idempotent upsert by `run_id` |
| Git commit | reuse recorded `commit_sha` if present; never create a second commit for the same promotion attempt |
| Frontier update | idempotent compare-and-set against promotion record |
| Cleanup | best-effort and repeatable |

### Manual Review State

Represent manual review as `blocked_manual`, not as an awkward terminal-ish state hidden inside a normal run phase. That gives you:

- clear UI semantics
- safe rejection/acceptance resumption
- one place to ask "what is waiting on a human?"

## Transaction Boundaries

Do not pretend the entire accept path is a single ACID transaction. It crosses SQLite, filesystem mutation, and Git. Model it as a **workflow transaction with durable sub-steps**.

### Boundary 1: Control-Plane Transaction

Use a SQLite transaction for:

- run row updates
- step journal updates
- decision row writes
- frontier projection writes
- promotion metadata writes

This is the actual atomic boundary you can trust.

### Boundary 2: Side-Effect Step

Each external effect is wrapped as:

1. mark step `running`
2. execute side effect
3. persist effect record
4. mark step `succeeded`

If the process crashes between 2 and 4, recovery checks the effect record and repairs the journal. That is the critical missing behavior today.

### Promotion Transaction

Model acceptance as a dedicated promotion record:

```ts
type PromotionRecord = {
  runId: string;
  status:
    | "pending"
    | "workspace_promoted"
    | "commit_written"
    | "frontier_projected"
    | "completed";
  candidateId: string;
  promotedPaths: string[];
  deletedPaths: string[];
  commitSha?: string;
};
```

Rules:

- `DecisionRecord.outcome=accepted` means "policy accepted candidate", not "all promotion side effects finished".
- Frontier must not change until `commit_written` is durable.
- Run must not become `completed` until frontier projection succeeds.
- Cleanup is outside the correctness boundary; it is resumable janitorial work.

### Compensation Rules

Use compensation selectively:

- `workspace_promoted` before commit: restore repo from baseline snapshot or abort if no files changed
- `commit_written` before frontier projection: do not reset Git history; instead resume forward and complete frontier projection
- failed cleanup: leave an orphan record and surface it in `doctor` / `status`

This follows the same broad discipline as saga-style compensation: compensate where you can, otherwise continue forward from the last durable milestone.

## Patterns to Follow

### Pattern 1: Compiled Manifest Contract

**What:** Compile user configuration into an executable runtime plan before any run is created.
**When:** Always, at the CLI/MCP boundary.
**Why:** Prevent schema/runtime drift and make unsupported features fail early.

### Pattern 2: Durable Step Journal

**What:** Persist each workflow step as a first-class record.
**When:** For all steps after run creation.
**Why:** Resume and forensic inspection depend on more than a coarse phase enum.

### Pattern 3: Unified Acceptance Pipeline

**What:** Auto-accept and human-accept share the same promotion coordinator.
**When:** Any candidate is approved.
**Why:** Manual review is currently a divergent implementation and already corrupts frontier semantics.

### Pattern 4: Projections for Read APIs

**What:** Maintain small read models for status/frontier/inspect.
**When:** After each durable step transition.
**Why:** Status should not scan all history to answer basic questions.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Phase Enum As the Only Recovery Primitive

**Why bad:** `decision_written` does not tell you whether promotion started, whether Git committed, or whether frontier projection happened.
**Instead:** persist step rows plus effect records.

### Anti-Pattern 2: Raw Manifest Flowing Through the Whole Engine

**Why bad:** runtime truth diverges from schema truth and support becomes ambiguous.
**Instead:** compile once, execute compiled intent only.

### Anti-Pattern 3: Separate Manual Review Code Path

**Why bad:** it duplicates promotion logic and drifts from the automated frontier semantics.
**Instead:** manual review should only change actor identity and unblock the same workflow graph.

## Suggested Build Order

1. **Manifest Compiler and Contract Tightening**
   - Add `CompiledRunPlan`
   - Reject unsupported `workspace`, `baselineRef`, and proposer modes unless implemented
   - Add contract tests that compare accepted manifests to executable capabilities

2. **SQLite Execution Store**
   - Introduce `.ralph/state.db`
   - Migrate runs, decisions, frontier, leases, and events
   - Keep logs/artifacts/workspaces on disk

3. **Step Journal Orchestrator**
   - Replace phase-only resume logic with step records
   - Add renewable leases
   - Make `--resume` reopen an existing `run_id`

4. **Promotion Coordinator**
   - Create `PromotionRecord`
   - Split accept path into `prepare`, `promote`, `commit`, `project_frontier`, `finalize`, `cleanup`
   - Make each step idempotent

5. **Manual Review Unification**
   - Route `accept` and `reject` through the orchestrator
   - Represent manual review as `blocked_manual`
   - Reuse frontier update logic from automated runs

6. **Read Models and Repair Tooling**
   - Add efficient `status` / `inspect` projections
   - Add `doctor repair` for orphan workspaces, partial promotions, and stale leases

7. **Crash/Resume Tests**
   - Add failure injection after each promotion step
   - Verify same `run_id` resume, no duplicate commits, no frontier corruption

## Milestone Implications

For this milestone, do not try to solve broad distributed orchestration. Solve honest local durability:

- make config surface match runtime truth
- make acceptance promotion resumable
- make manual review semantically identical to automated approval
- make inspect/status tell the truth after crashes

If those four things are done, the runtime becomes trustworthy enough to extend later.

## Sources

- Local codebase analysis: `.planning/PROJECT.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md`, plus runtime files in `src/app/services/`, `src/core/engine/`, `src/core/state/`, and `src/core/model/`
- Temporal Workflow Execution docs: https://docs.temporal.io/workflow-execution
- Temporal documentation on deterministic workflow logic, replay, and saga-style compensation patterns via Context7: `/temporalio/documentation`
- SQLite WAL docs: https://sqlite.org/wal.html
- SQLite savepoints docs: https://sqlite.org/lang_savepoint.html
- SQLite atomic commit docs: https://sqlite.org/atomiccommit.html
