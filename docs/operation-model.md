# Operation Model

`ralph-research` is a stateful local runtime. The core contract is that every meaningful step in a cycle should either be persisted durably or rejected as untrustworthy.

## Workflow Contract

At a high level, one research cycle does this:

1. Load and validate `ralph.yaml`
2. Acquire the storage lock
3. Inspect the latest persisted run and classify recovery
4. Create or resume a candidate workspace
5. Run proposer and experiment commands
6. Extract metrics and evaluate constraints
7. Write a decision record
8. If accepted, commit and update the frontier
9. Release the lock

The service entrypoint that coordinates this flow is [src/app/services/run-cycle-service.ts](/Users/chsong/Developer/Personal/ralph-research/src/app/services/run-cycle-service.ts:48).

## Persisted State

State lives under `manifest.storage.root`, which defaults to `.ralph` in the bundled writing template.

Typical contents:

- `runs/`: one `RunRecord` per run id
- `decisions/`: one `DecisionRecord` per completed decision
- `frontier.json`: the current accepted frontier
- `lock`: active runtime ownership and heartbeat metadata

These records are not just debug output. They are the runtime's source of truth for resume, inspection, and manual review.

## Key Records

### Run

A run captures execution progress, proposal metadata, metric outputs, artifacts, and the current phase. It is written incrementally so recovery can reason over a partially completed run instead of guessing.

### Decision

A decision captures the outcome and rationale for one evaluated run. Accepted decisions also carry promotion details such as commit SHA.

### Frontier

The frontier is the accepted best-known state under the configured frontier strategy. For `single_best`, it is the current incumbent. Other strategies can retain more than one accepted entry.

## Recovery Classes

The runtime currently classifies the latest persisted run into four states in [src/core/state/recovery-classifier.ts](/Users/chsong/Developer/Personal/ralph-research/src/core/state/recovery-classifier.ts:1):

| Classification | Meaning | `rrx run` behavior |
| --- | --- | --- |
| `idle` | No resumable work exists | Start a fresh run |
| `resumable` | Latest run has enough durable evidence to continue truthfully | Resume by default |
| `manual_review_blocked` | Latest run is waiting on human accept/reject | Block until resolved |
| `repair_required` | Latest run cannot be resumed truthfully | Warn and start fresh |

`parallel` proposer runs are intentionally classified as `repair_required` today because truthful resume is not implemented for that mode yet.

## Runtime and CLI Semantics

### `rrx run`

`rrx run` delegates to the run loop service and uses the recovery classification of the latest run.

- Default: auto-resume the latest recoverable run
- `--fresh`: force a new run id
- `--until-target`: continue until `stopping.target` is satisfied
- `--until-no-improve N`: continue until the frontier stops improving for `N` cycles

The command surface is defined in [src/cli/commands/run.ts](/Users/chsong/Developer/Personal/ralph-research/src/cli/commands/run.ts:1).

### `rrx status`

`rrx status` reports both persisted state and the live runtime view derived from the lock heartbeat. That distinction matters because a stale lock and a dead process are not the same thing as a cleanly stopped runtime.

See [src/cli/commands/status.ts](/Users/chsong/Developer/Personal/ralph-research/src/cli/commands/status.ts:1).

## Why Git Matters

For Git-backed projects, candidate work runs in detached worktrees and accepted changes are promoted back into the main checkout. This is how `ralph-research` keeps experiment execution isolated while still leaving an inspectable accepted history.

The runtime also warns when proposer, experiment, or metric command files are dirty in the working tree, because candidate worktrees only see committed baseline content.

## Why This Differs From Prompt-Only Loops

The important distinction is not whether a loop sounds plausible in documentation. It is whether the runtime can:

- resume without lying
- explain why a run was accepted or rejected
- tell you when manual review is required
- persist enough evidence to inspect the result later

That is the bar this repo is trying to hold.
