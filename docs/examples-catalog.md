# Examples Catalog

This catalog expands the short examples in [examples.md](examples.md) with a few operator-oriented scenarios. Every example here stays within the current shipped runtime contract.

## 1. Verify a Fresh Clone

Use this when you want to confirm the repo is runnable before touching anything else.

```bash
rrx validate
rrx doctor
rrx init --template writing
rrx run --json
rrx status --json
```

What to expect:

- the bundled `writing` template initializes successfully
- the first cycle writes run, decision, and frontier state
- `status` reports the current runtime and recovery view

## 2. Disposable End-To-End Demo

Use these when you want a temporary repo that proves the loop works without
manual setup. Both demos finish in seconds and need no API key.

```bash
rrx demo writing   # prose ratchet (markdown draft)
rrx demo code      # test-pass ratchet (tiny JavaScript calculator)
```

What to expect:

- a temporary Git repo is created
- one accepted cycle is executed
- the command prints the temp path and run id
- `demo code` additionally moves the `tests_passed` metric from `0` to `4`
  on the bundled `tests/calculator.test.mjs` suite

## 3. Resume After Interruption

Use this when a previous run was interrupted and the latest run is still recoverable.

```bash
rrx status
rrx run
```

What to expect:

- `rrx status` tells you whether the runtime is `running (alive)`, `stale (resumable)`, or stopped
- `rrx run` resumes the latest recoverable run by default
- if the latest run is blocked on human review, `rrx run` will not bypass it

## 4. Manual Review Handoff

Use this when the runtime has stopped in `needs_human`.

```bash
rrx status --json
rrx inspect run-0001 --json
rrx accept run-0001
rrx status --json
```

What to expect:

- `inspect` explains the decision and metric state
- `accept` resolves the pending review and lets the runtime continue
- `reject` is the symmetric path when the run should not be kept

## 5. Progressive Stop

Use this only after you have enabled `stopping.target` in the manifest.

```bash
rrx run --until-target --until-no-improve 3 --json
```

What to expect:

- the runtime keeps iterating until the target is met
- if progress stalls, it stops after the configured no-improve window
- the bundled `writing` template does not enable this by default

## 6. Compare By Artifact Type

### Writing

Use the bundled `writing` template when you want a minimal local command metric and a single markdown artifact.

### Code (bundled)

Use the bundled `code` template when you want a test-pass ratchet with no
external toolchain — it runs against Node's built-in test runner.

```yaml
experiment:
  run:
    command: "node scripts/experiment.mjs"
  outputs:
    - id: test-results
      path: out/test-results.json

metrics:
  catalog:
    - id: tests_passed
      kind: numeric
      direction: maximize
      extractor:
        type: command
        command: "node scripts/metric.mjs"
        parser: plain_number
```

### Code (Python/uv fixture)

The repo also ships a `tests/fixtures/manifests/valid-code.ralph.yaml`
fixture that drives the same shape against `uv run pytest`. Reach for it
when your project's tests already live behind `uv`/`pytest`.

```yaml
experiment:
  run:
    command: uv run pytest -q

metrics:
  catalog:
    - id: tests_passed
      kind: numeric
      direction: maximize
      extractor:
        type: command
        command: ./scripts/metric_tests.sh
        parser: json_path
        valuePath: $.passed
```

### LLM-Judged Writing Fixture

Use the LLM fixture when you want to preserve judge-backed quality signals in the manifest.

```yaml
metrics:
  catalog:
    - id: paper_quality
      kind: llm_score
      direction: maximize
      extractor:
        type: llm_judge
        judgePack: writing-pairwise-v1
        prompt: prompts/paper_quality_judge.md
```

## 7. What To Read Next

- [playbook.md](playbook.md)
- [operation-model.md](operation-model.md)
- [faq.md](faq.md)
