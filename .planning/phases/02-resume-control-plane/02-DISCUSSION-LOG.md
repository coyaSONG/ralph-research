# Phase 2: Resume Control Plane - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-05T00:00:00.000Z
**Phase:** 2-resume-control-plane
**Areas discussed:** Resume trigger and selection, Recovery truth surface, Legacy and ambiguous partial runs, Lock lease behavior

---

## Resume trigger and selection

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit `--resume` | Plain `rrx run` refuses when recovery is available and asks for explicit resume. | |
| Auto-resume latest | Plain `rrx run` resumes the latest recoverable run automatically. | ✓ |
| Separate `rrx resume` command | Keep `run` fresh-only and introduce a dedicated resume entrypoint. | |
| `You decide` | Leave trigger semantics to planning. | |
| Other | Custom entrypoint behavior outside the listed options. | |

**User's choice:** Plain `rrx run` should resume if recoverable, otherwise start fresh. `rrx run --fresh` should always start fresh.
**Notes:** The user wants auto-resume as the default contract, with explicit opt-out for a new run.

| Option | Description | Selected |
|--------|-------------|----------|
| Always latest recoverable | Default selection always targets the latest recoverable run. | ✓ |
| Error on multiple recoverable runs | Refuse auto-resume if multiple recoverable runs exist. | |
| Prefer latest but warn on older runs | Resume the latest and emit warnings about older recoverable runs. | |
| `You decide` | Leave selection policy open. | |
| Other | Custom selection semantics. | |

**User's choice:** Always latest.
**Notes:** Starting a newer run is treated as an implicit abandonment signal for older runs. Warning on older runs was rejected as noise.

| Option | Description | Selected |
|--------|-------------|----------|
| Latest-only in Phase 2 | Do not add arbitrary run targeting yet. | ✓ |
| `--run-id` for recoverable runs only | Allow explicit resume by run id when that run is recoverable. | |
| Best-effort `--run-id` | Allow explicit run targeting even if recoverability is ambiguous. | |
| `You decide` | Leave targeting scope to planning. | |
| Other | Custom targeting behavior. | |

**User's choice:** Phase 2 should stay latest-only.
**Notes:** The user rejected `--run-id` for now because it generalizes the problem too early and is not needed once default behavior is latest-only auto-resume.

---

## Recovery truth surface

| Option | Description | Selected |
|--------|-------------|----------|
| Classification only | `status` shows only a high-level recovery state. | |
| Classification + next action | `status` shows the recovery label plus the next action to take. | ✓ |
| Classification + next action + reason | `status` includes the full reason inline. | |
| `You decide` | Leave status detail open. | |
| Other | Custom status reporting. | |

**User's choice:** `status` should show summary status plus next action.
**Notes:** The user wants `status` to answer “what should I do next?” without becoming verbose.

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated recovery section | `inspect` includes `classification`, `nextAction`, `reason`, and `resumeAllowed`. | ✓ |
| Raw phase/status only | Keep `inspect` limited to existing fields and let users infer recovery state. | |
| Dedicated section plus structured missing-evidence detail | Add full repair-evidence taxonomy now. | |
| `You decide` | Leave inspect detail open. | |
| Other | Custom inspect reporting. | |

**User's choice:** Dedicated recovery section with `classification`, `nextAction`, `reason`, and `resumeAllowed`.
**Notes:** The user views `inspect` as the diagnostic surface and does not want to delay truthful recovery reporting behind a richer repair model.

---

## Legacy and ambiguous partial runs

| Option | Description | Selected |
|--------|-------------|----------|
| `repair_required` on ambiguity | Do not guess; refuse resume for legacy or incomplete durable state. | ✓ |
| Limited automatic repair | Auto-fix only obviously safe legacy cases. | |
| Best-effort resume | Try to continue and fail later if needed. | |
| `You decide` | Leave ambiguity handling open. | |
| Other | Custom legacy-handling behavior. | |

**User's choice:** Mark ambiguous or legacy partial runs as `repair_required`.
**Notes:** The user explicitly rejected guesswork because resume should only happen when the persisted state is trustworthy.

| Option | Description | Selected |
|--------|-------------|----------|
| Fail until `--fresh` is explicit | A `repair_required` latest run blocks fresh work by default. | |
| Warn and start fresh | Plain `rrx run` emits a warning, then starts a fresh run. | ✓ |
| Prompt interactively | Ask the operator what to do at runtime. | |
| `You decide` | Leave behavior open. | |
| Other | Custom behavior. | |

**User's choice:** Auto fresh start plus a warning.
**Notes:** This preserves the higher-level contract already chosen for plain `rrx run`: resume if recoverable, otherwise start fresh.

| Option | Description | Selected |
|--------|-------------|----------|
| Latest-only even past repair-required | Do not search backward; if latest is not recoverable, do not revive older runs. | ✓ |
| Resume the older recoverable run | Make an exception when an older run is still resumable. | |
| Fail and force explicit intervention | Block until the operator chooses a recovery path. | |
| `You decide` | Leave fallback semantics open. | |
| Other | Custom fallback behavior. | |

**User's choice:** Latest-only even when an older run is recoverable.
**Notes:** The user wants the “always latest” rule to stay intact and rejected any recursive search behavior as unnecessary complexity.

---

## Lock lease behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Heartbeat / lease renewal | Refresh lock ownership during active work. | ✓ |
| Longer fixed TTL | Keep the current lock shape but extend timeout length. | |
| PID-only ownership | Treat PID liveness as the main ownership check. | |
| `You decide` | Leave lease semantics open. | |
| Other | Custom lock strategy. | |

**User's choice:** Heartbeat / lease renewal.
**Notes:** The user wants short stale detection after crashes without long-running healthy work being misclassified as stale.

| Option | Description | Selected |
|--------|-------------|----------|
| One missed TTL means stale | Treat first TTL expiry as enough for takeover. | |
| Grace window after TTL | Require one additional grace period before takeover. | ✓ |
| TTL + PID + state checks | Add deeper consistency checks before takeover. | |
| `You decide` | Leave stale detection policy open. | |
| Other | Custom stale-detection behavior. | |

**User's choice:** Add a grace window after TTL expiry.
**Notes:** The user accepted a single extra heartbeat interval as the right balance between false-positive protection and quick post-crash recovery.

| Option | Description | Selected |
|--------|-------------|----------|
| Immediate failure on active lease | Refuse new work immediately and show active owner details. | ✓ |
| Poll and wait | Keep retrying until the lease becomes stale or clears. | |
| Optional `--wait` only | Support waiting only through an explicit future flag. | |
| `You decide` | Leave contention behavior open. | |
| Other | Custom contention behavior. | |

**User's choice:** Immediate failure on active lease.
**Notes:** The user wants actionable operator feedback, not silent blocking. An example desired message includes active `runId`, PID, and recent heartbeat age.

---

## the agent's Discretion

- Exact naming of recovery classifications.
- Exact heartbeat interval and grace-window values.
- Exact wording and shape of warnings and immediate lock-contention errors.

## Deferred Ideas

- Arbitrary `runId` resume targeting for non-latest runs.
- Rich repair tooling and structured repair-evidence schemas.
- Optional wait mode for lock contention, such as a future `--wait`.
