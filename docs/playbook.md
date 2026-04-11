# Operator Playbook

This is the shortest honest map of the current `ralph-research` runtime.

Use `rrx` when you want to work against a real manifest-backed loop. Use the docs in [operation-model.md](operation-model.md) and [faq.md](faq.md) when you need the state semantics behind the commands.

## Situation To Command

| If you want to... | Run |
| --- | --- |
| Check whether the repo is ready to run | `rrx validate` |
| Inspect the local scaffold and runtime assumptions | `rrx doctor` |
| Create the bundled example repo | `rrx init --template writing` |
| Run the disposable example end to end | `rrx demo writing` |
| Execute one research cycle | `rrx run --json` |
| Resume the latest recoverable run | `rrx run` |
| Force a fresh run id | `rrx run --fresh` |
| Keep running until the manifest target is met | `rrx run --until-target` |
| Stop after repeated no-improve cycles | `rrx run --until-no-improve 3` |
| See current project and recovery state | `rrx status --json` |
| Inspect one run's decision record | `rrx inspect <runId> --json` |
| Review the accepted frontier | `rrx frontier --json` |
| Accept a run that is waiting on human review | `rrx accept <runId>` |
| Reject a run that is waiting on human review | `rrx reject <runId>` |
| Serve the same contract over stdio MCP | `rrx serve-mcp --stdio` |

## Recovery Flow

When `rrx run` starts, it looks at the latest persisted run and classifies recovery.

- `idle`: no resumable run exists, so a fresh run starts
- `resumable`: the latest run has enough evidence to continue, so `rrx run` resumes it
- `manual_review_blocked`: the latest run is waiting on accept/reject, so `rrx run` blocks
- `repair_required`: the latest run cannot be resumed truthfully, so `rrx run` warns and starts fresh

The runtime state and recovery logic are described in [operation-model.md](operation-model.md).

### What To Do Next

| If status says... | Then do this |
| --- | --- |
| `resumable` | Run `rrx run` again to continue the same run id |
| `manual_review_blocked` | Run `rrx accept <runId>` or `rrx reject <runId>` |
| `repair_required` | Run `rrx run --fresh` after you understand why resume is unsafe |
| `stale (resumable)` in `rrx status` | Treat the runtime as resumable, not dead |

## Manual Review Flow

Use manual review when the runtime stops in `needs_human`.

1. Run `rrx status --json` to confirm the latest run and recovery state.
2. Run `rrx inspect <runId> --json` to read the reason, metrics, and judge output.
3. Decide whether the result should be kept.
4. Run `rrx accept <runId>` or `rrx reject <runId>`.
5. Re-run `rrx status --json` to confirm the project is no longer blocked.

Do not use `rrx run` to bypass a pending human review. The runtime blocks that path intentionally.

## Short Sequences

### First time in a fresh clone

```bash
rrx validate
rrx doctor
rrx init --template writing
rrx run --json
```

### Safe disposable demo

```bash
rrx demo writing
rrx status --json
```

### Inspect a result before deciding

```bash
rrx status --json
rrx inspect run-0001 --json
rrx frontier --json
```

### Resume after interruption

```bash
rrx status
rrx run
```

### Start over cleanly

```bash
rrx status --json
rrx run --fresh
```

### Work through a manual review

```bash
rrx status --json
rrx inspect run-0001 --json
rrx accept run-0001
rrx status --json
```

## What The Files Mean

The runtime persists its truth under the manifest storage root, which defaults to `.ralph` in the bundled template.

- `runs/`: incremental run records
- `decisions/`: accepted, rejected, or human-review decisions
- `frontier.json`: the currently accepted frontier
- `lock`: heartbeat and ownership metadata for the active runtime

If you are debugging state, inspect those files through the CLI first. The CLI is the supported surface; the files are the underlying evidence.

## What Not To Expect

- Do not expect a fresh `run` to ignore a blocked human review.
- Do not expect `repair_required` to resume truthfully.
- Do not expect the bundled `writing` template to cover every manifest shape.
- Do not expect undocumented subcommands or hidden automation.

## Related Docs

- [README.md](../README.md)
- [operation-model.md](operation-model.md)
- [examples.md](examples.md)
- [faq.md](faq.md)
