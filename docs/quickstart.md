# Five-Minute Quickstart

This page walks the absolute shortest path from "never heard of `ralph-research`"
to "looked at the persisted decision evidence of an accepted cycle." Total
elapsed time should be under five minutes on a laptop with Node 24 and Git
already installed.

If you would rather skim than do, the [README](../README.md) and the
[operation model](operation-model.md) cover the same ground in prose.

## Prerequisites

```bash
node --version    # expected: v24.x
git --version     # any modern Git is fine
```

If `node --version` reports something below 24, `npm install -g n` followed by
`n 24` is the fastest way to upgrade.

## Step 1 — run the bundled writing demo

```bash
npx ralph-research demo writing
```

What just happened:

1. `npx` fetched the published `ralph-research` package from npm.
2. The CLI created a disposable Git repo under `/tmp/rrx-demo-writing-...`.
3. One full write-evaluate-accept cycle ran end-to-end.
4. The CLI printed the temp path, the run id, and the decision reason.

Note the temp path the CLI printed — you will use it in the next step.

## Step 2 — inspect what the runtime persisted

```bash
cd <the temp path from step 1>
ls .ralph/
ls .ralph/runs/run-0001/
cat .ralph/runs/run-0001/run.json | python3 -m json.tool   # or jq
cat .ralph/runs/run-0001/decision.json | python3 -m json.tool
```

What to look for:

- `run.json` records the status (`accepted`), the metric value, and the diff
  summary the candidate produced.
- `decision.json` explains why the ratchet accepted, including the previous
  frontier (empty on the first cycle) and the new frontier.
- `frontier.json` shows the promoted candidate that future cycles will be
  measured against.

These three files are the runtime's contract with you — anything `rrx status`
or `rrx inspect` shows comes from them, not from a regenerated narrative.

## Step 3 — try the second bundled template

Back in any scratch directory:

```bash
npx ralph-research demo code
```

This runs the test-pass ratchet over a tiny calculator module. On the first
cycle, the proposer rewrites a deliberately-broken `sum`/`multiply` to make
all four `node --test` cases pass, and the ratchet promotes the candidate
from `tests_passed: 0` to `tests_passed: 4`.

If you want to see the exact files involved, `ls templates/code/` inside this
repository — `src/calculator.mjs`, `tests/calculator.test.mjs`, and the three
`scripts/*.mjs` files are everything the template ships.

## Step 4 — modify the manifest and run another cycle

In the directory from step 1:

```bash
$EDITOR ralph.yaml
```

A safe first edit is enabling the optional `stopping.target` block at the
bottom of the file. Then:

```bash
npx ralph-research run --until-target --until-no-improve 3 --json
```

The runtime will keep iterating until either the metric target is met or the
configured no-improve window expires. Inspecting `.ralph/runs/` again shows
exactly which cycles were accepted and which were rejected.

## Step 5 — resume after interrupt (optional)

To experience the recovery semantics in code:

1. Start a long-running cycle (`npx ralph-research run --until-target`).
2. Hit Ctrl-C partway through.
3. Run `npx ralph-research status --json` — the runtime classifies the
   interrupted session as resumable or not, based on persisted lifecycle
   evidence.
4. Run `npx ralph-research run` again — the runtime auto-resumes the latest
   recoverable run from the last completed cycle boundary.

The interesting case is when the runtime says **not** resumable. That happens
on purpose: `docs/operation-model.md` documents the four recovery
classifications and why each one chooses to refuse resume rather than
silently risk double-writing state.

## Where to go next

- [`docs/operation-model.md`](operation-model.md) — the full lifecycle and
  the rules the recovery classifier enforces.
- [`docs/playbook.md`](playbook.md) — situation-to-command operator guide.
- [`docs/examples-catalog.md`](examples-catalog.md) — additional manifest
  shapes (LLM judge, Python/uv tests, progressive stop).
- [`docs/comparison.md`](comparison.md) — when to pick this runtime versus
  LangGraph, aider, or a prompt-only ralph loop.
- [`docs/faq.md`](faq.md) — common runtime, recovery, and inspection
  questions.

If anything in this walkthrough does not work as described, the runtime is
wrong and the issue templates under `.github/ISSUE_TEMPLATE/` are the right
place to file a reproduction.
