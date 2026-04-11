# Examples

These examples are intentionally split into two groups:

- shipped onboarding paths that work directly with the repo today
- manifest snippets that reflect runtime capabilities already covered by fixtures and tests

For a broader scenario catalog, see [docs/examples-catalog.md](examples-catalog.md).

## Shipped Quickstart Paths

### Disposable writing demo

```bash
npx ralph-research demo writing
```

Use this when you want to validate the full loop on a temporary local repo without setting anything up manually.

### Initialize the bundled template

```bash
npx ralph-research init --template writing
npx ralph-research doctor
npx ralph-research run --json
```

This uses the bundled local command metric from [templates/writing/ralph.yaml](/Users/chsong/Developer/Personal/ralph-research/templates/writing/ralph.yaml:1).

### Inspect the accepted run

```bash
npx ralph-research status --json
npx ralph-research frontier --json
npx ralph-research inspect run-0001 --json
```

Use this path when you want to verify that the runtime persisted enough evidence to explain the result.

## Progressive Run Example

The bundled writing template ships with `stopping.target` commented out. After enabling it in `ralph.yaml`, you can run:

```bash
npx ralph-research run --until-target --until-no-improve 3 --json
```

This keeps iterating until the target is met or the frontier stalls for three consecutive cycles.

## Local Command Metric Example

The bundled writing template is the smallest honest example of a local-first loop:

```yaml
schemaVersion: "0.1"

project:
  name: writing-demo
  artifact: manuscript
  baselineRef: main
  workspace: git

scope:
  allowedGlobs:
    - "**/*.md"

proposer:
  type: command
  command: "node scripts/propose.mjs"

experiment:
  run:
    command: "node scripts/experiment.mjs"

metrics:
  catalog:
    - id: quality
      kind: numeric
      direction: maximize
      extractor:
        type: command
        command: "node scripts/metric.mjs"
        parser: plain_number
```

Full file: [templates/writing/ralph.yaml](/Users/chsong/Developer/Personal/ralph-research/templates/writing/ralph.yaml:1)

## LLM Judge Example

The runtime also supports a judge-driven metric path. A compact example already exists in the fixture suite:

```yaml
judgePacks:
  - id: writing-pairwise-v1
    mode: pairwise
    judges:
      - model: openai:gpt-5.4-mini
    anchors:
      path: eval/anchors.jsonl

metrics:
  catalog:
    - id: paper_quality
      kind: llm_score
      direction: maximize
      extractor:
        type: llm_judge
        judgePack: writing-pairwise-v1
        prompt: prompts/paper_quality_judge.md
        inputs:
          candidate: out/review.md
```

Source fixture: [valid-writing.ralph.yaml](/Users/chsong/Developer/Personal/ralph-research/tests/fixtures/manifests/valid-writing.ralph.yaml:1)

## Code-Oriented Manifest Example

The runtime is not limited to writing artifacts. The test fixtures include a code-oriented manifest that uses pytest as the experiment and a JSON metric extractor:

```yaml
project:
  name: code-demo
  artifact: code
  baselineRef: main
  workspace: git

scope:
  allowedGlobs:
    - src/**/*.py
    - tests/**/*.py

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

Source fixture: [valid-code.ralph.yaml](/Users/chsong/Developer/Personal/ralph-research/tests/fixtures/manifests/valid-code.ralph.yaml:1)

## Choosing The Right Example

| Goal | Start here |
| --- | --- |
| Validate the whole runtime quickly | `demo writing` |
| Create a repo you can inspect and modify | `init --template writing` |
| Understand the persisted state contract | `status`, `frontier`, `inspect` |
| Add model-based judging later | LLM judge fixture |
| Adapt the runtime to code-oriented experiments | Code fixture |
