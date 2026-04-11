# FAQ

## Does `rrx run` always start a new run?

No. By default it auto-resumes the latest recoverable run. Use `--fresh` when you want a new `runId` regardless of resumability.

## What blocks auto-resume?

Two things matter most:

- the latest run is waiting for human review
- the latest run does not have enough durable evidence to resume truthfully

The runtime surfaces this through recovery classification rather than trying to guess.

## What does `manual_review_blocked` mean?

It means the latest run ended in `needs_human`. The runtime will not continue until you resolve that run with `rrx accept <runId>` or `rrx reject <runId>`.

## What does `repair_required` mean?

It means the latest run exists, but the persisted checkpoint is not trustworthy enough to resume. Example causes include:

- missing workspace path for an in-flight proposal
- missing execution logs for an executed run
- missing persisted metrics for an evaluated run
- unsupported truthful resume for `parallel` proposer mode

In that state, `rrx run` warns and starts a fresh run instead of pretending it can continue.

## Why does the runtime care whether command files are committed?

For Git-backed projects, candidate work runs in detached worktrees built from committed baseline content. If your proposer, experiment, or metric script is only modified in the working tree, candidate worktrees will not see it. The runtime warns about this so the workflow contract stays honest.

## What is the frontier?

The frontier is the accepted best-known state under the configured frontier strategy. In the common `single_best` strategy, it is the current incumbent that future candidates must beat.

## Where do I inspect why something was accepted or rejected?

Use:

```bash
rrx inspect <runId> --json
```

That output is backed by persisted `RunRecord` and `DecisionRecord` state, not by reconstructing the answer from logs after the fact.

## Why is the bundled template only `writing` if the runtime supports more?

Because the repo is optimizing for truthful scope. The runtime is manifest-driven and broader than the default template, but the onboarding path only advertises the part that is currently packaged and reliable.

## Can I run this through MCP instead of the CLI?

Yes. The bundled stdio MCP server exposes:

- `run_research_cycle`
- `get_research_status`
- `get_frontier`

These tools use the same service layer as the CLI.

## What should I run first in a fresh repo?

If you want the safest path:

```bash
rrx validate
rrx doctor
rrx run --json
rrx status --json
```

If you want a disposable proof that the runtime works end to end:

```bash
rrx demo writing
```
