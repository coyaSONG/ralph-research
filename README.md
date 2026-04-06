# ralph-research

Local-first runtime for recursive research improvement.

`ralph-research` runs a bounded improvement loop over a real artifact:

1. define a metric
2. generate one candidate change
3. evaluate it
4. keep only verified improvements

The v0.1 focus is a writing workflow that is runnable in under five minutes on a local machine.

## Quickstart

### Zero-config demo

```bash
npx ralph-research demo writing
```

This creates a temporary writing repo, runs one accepted cycle, and prints the path plus the run id. The v0.1 demo supports the bundled `writing` template only.

### Template flow

```bash
npx ralph-research init --template writing
npx ralph-research run --json
npx ralph-research run --until-target --until-no-improve 3 --json
npx ralph-research inspect run-0001 --json
```

This path is the v0.1 success bar: `init -> run -> inspect` should work quickly and produce an acceptance reason you can inspect. The bundled template set is currently `writing` only.

## Core Concepts

- `Manifest`: `ralph.yaml` defines the research program.
- `Metric`: how candidate quality is measured.
- `Frontier`: the currently accepted best candidate set.
- `Ratchet`: the acceptance policy that decides whether the frontier advances.
- `Proposer`: how a bounded candidate change is generated.
- `Judge`: how qualitative outputs are compared when numeric metrics are not enough.

## Writing Template

The bundled writing template is self-contained:

- `docs/draft.md`: sample draft
- `scripts/propose.mjs`: bounded rewrite
- `scripts/experiment.mjs`: output materialization
- `scripts/metric.mjs`: local heuristic metric
- `prompts/judge.md`: pairwise judge prompt you can upgrade to later

The default template uses a local command metric so the first run does not require API keys. When you are ready, replace the numeric metric with an `llm_judge` extractor and use the included pairwise prompt as a starting point.

## CLI

```text
rrx validate
rrx doctor
rrx init --template writing
rrx demo writing
rrx run
rrx run --until-target
rrx run --until-target --until-no-improve 3
rrx status
rrx frontier
rrx inspect <runId>
rrx accept <runId>
rrx reject <runId>
rrx serve-mcp --stdio
```

`rrx run --cycles N` still executes a finite loop. Progressive modes are opt-in:

- `--until-target`: keep iterating until `manifest.stopping.target` is satisfied
- `--until-no-improve N`: stop after `N` consecutive cycles without a frontier improvement
- `--cycles N` with a progressive flag: treat `N` as a max-cycle cap instead of an exact count

## Stopping Targets

Use `stopping.target` when the workflow contract is "keep going until metric X reaches threshold Y":

```yaml
metrics:
  catalog:
    - id: exact_rate
      kind: numeric
      direction: maximize
      extractor:
        type: command
        command: "python scripts/metric.py"
        parser: plain_number

frontier:
  strategy: single_best
  primaryMetric: exact_rate

ratchet:
  type: epsilon_improve
  metric: exact_rate
  epsilon: 0

stopping:
  target:
    metric: exact_rate
    op: ">="
    value: 0.8
```

## Metric Diagnostics

If a metric script can explain why a candidate was zeroed or downgraded, prefer JSON output plus `parser: json_path` so the reason survives into `run`, `decision`, and `inspect` output:

```yaml
metrics:
  catalog:
    - id: exact_rate
      kind: numeric
      direction: maximize
      extractor:
        type: command
        command: "python scripts/metric.py"
        parser: json_path
        valuePath: $.value
```

```json
{
  "value": 0,
  "metricId": "overfit_safe_exact_rate",
  "reasons": ["all_missing_features", "normalized_order_leak"]
}
```

When `project.workspace=git`, rrx now warns if proposer, experiment, or metric command files are dirty in the working tree, because detached candidate worktrees only see committed baseline content.

## MCP

The bundled MCP server currently supports stdio transport and exposes three thin tools backed by the same service layer as the CLI:

- `run_research_cycle`
- `get_research_status`
- `get_frontier`

## Design Principles

- local-first execution
- bounded changes
- recoverable state transitions
- trusted signal before automation
- inspectable accept/reject decisions

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

## License

MIT
