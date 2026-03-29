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
rrx status
rrx frontier
rrx inspect <runId>
rrx accept <runId>
rrx reject <runId>
rrx serve-mcp --stdio
```

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
