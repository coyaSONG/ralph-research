# Code template

A self-contained `ralph-research` template that drives a test-pass ratchet
over a tiny JavaScript calculator module. Uses only Node's built-in
`node:test` runner, so the first cycle runs with no external toolchain.

## What ships in this template

- `src/calculator.mjs` — exports `sum` and `multiply` with deliberate bugs
- `tests/calculator.test.mjs` — four assertions covering both functions
- `scripts/propose.mjs` — overwrites `src/calculator.mjs` with the fixed
  implementation
- `scripts/experiment.mjs` — runs `node --test --test-reporter=tap` against
  the test file and parses the TAP summary into `out/test-results.json`
- `scripts/metric.mjs` — reads `out/test-results.json` and prints the
  pass count as the `tests_passed` metric
- `ralph.yaml` — wires the above into a `single_best` frontier with an
  `epsilon_improve` ratchet

## Running this template

From the directory that contains `ralph.yaml`:

```bash
rrx validate
rrx doctor
rrx run --json
rrx inspect run-0001 --json
```

On a fresh checkout the cycle promotes `tests_passed` from `0` to `4` and
the ratchet accepts. Subsequent cycles run against the already-fixed
calculator and are rejected because the candidate cannot improve on the
incumbent.

To extend the template into a real research loop, replace the proposer with
a real candidate generator (for example, a small LLM call that rewrites
`src/calculator.mjs` to add a new function) and broaden the test suite so
the ratchet has something meaningful to compare on each cycle.

See [`docs/operation-model.md`](../../docs/operation-model.md) for the
runtime contract every manifest must honor.
