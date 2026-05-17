# Writing template

A self-contained `ralph-research` template that demonstrates the
write-evaluate-accept loop on a markdown draft.

## What ships in this template

- `docs/draft.md` — the baseline draft the runtime improves
- `scripts/propose.mjs` — overwrites `docs/draft.md` with a bounded rewrite
- `scripts/experiment.mjs` — copies the candidate draft into `out/draft.md`
- `scripts/metric.mjs` — emits a numeric `quality` score from keyword presence
  (no API key, no LLM call)
- `prompts/judge.md` — starter prompt for an optional pairwise LLM judge
- `ralph.yaml` — the manifest that wires the four pieces above into the
  runtime

The manifest enables `quality` as a numeric metric backed by `metric.mjs`. The
optional `judgePacks` block is commented-out scaffolding for when you swap
the numeric metric for an LLM judge.

## Running this template

From the directory that contains `ralph.yaml`:

```bash
rrx validate           # check the manifest parses
rrx doctor             # sanity-check the working tree
rrx run --json         # execute one cycle
rrx inspect run-0001 --json
```

`rrx run` writes `.ralph/runs/run-0001/run.json`,
`.ralph/runs/run-0001/decision.json`, and `.ralph/frontier.json`. Inspecting
those three files is the fastest way to understand what the runtime
actually persists.

## Extending this template

- Replace `scripts/metric.mjs` with a real quality metric you trust.
- Uncomment the `judgePacks` block in `ralph.yaml` and point it at a real
  judge model to compare candidates pairwise.
- Add files to `docs/` and broaden the `scope.allowedGlobs` if you want the
  proposer to touch more than a single draft.

See [`docs/operation-model.md`](../../docs/operation-model.md) for the
runtime contract every manifest must honor.
