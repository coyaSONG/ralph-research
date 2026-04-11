# ralph-research

Local-first runtime for recursive research improvement over real artifacts.

`ralph-research` ships an actual CLI and stdio MCP server that run a bounded loop:

1. load a manifest
2. generate one candidate change
3. evaluate it with trusted signals
4. persist the run, decision, and frontier state
5. promote only verified improvements

The current product bar is reliability, not breadth. The bundled success path is the `writing` template, while the runtime itself is manifest-driven and reusable for other local workflows.

## Trust Signals

- Actual shipped surfaces: CLI binary `rrx` and stdio MCP server
- Development verification commands: `npm test`, `npm run typecheck`, `npm run build`
- Persisted runtime evidence: runs, decisions, frontier, and lock metadata
- Recovery semantics are enforced by code and persisted state, not described only in prompts
- Supported onboarding path is intentionally narrower than the full manifest surface

## What It Is

- A Node/TypeScript runtime with a real CLI: `rrx`
- A stdio MCP server backed by the same service layer as the CLI
- A Git-aware candidate execution loop with persisted run, decision, and frontier state
- A local-first system designed to be resumed, inspected, and trusted after interruptions

## What It Is Not

- Not a no-config autonomous agent for arbitrary domains out of the box
- Not a hosted service
- Not a prompt-only protocol with undocumented runtime behavior
- Not broader than the shipped contract: one bundled template (`writing`) and three MCP tools

## Quick Decision Guide

| If you want to... | Use |
| --- | --- |
| Check whether a repo is runnable | `rrx validate` then `rrx doctor` |
| Materialize the bundled example project | `rrx init --template writing` |
| Run a disposable end-to-end demo | `rrx demo writing` |
| Execute one cycle | `rrx run --json` |
| Resume the latest recoverable run | `rrx run` |
| Force a fresh run id | `rrx run --fresh` |
| Inspect runtime and recovery state | `rrx status --json` |
| Inspect why one run was accepted or rejected | `rrx inspect <runId> --json` |
| Review the current accepted frontier | `rrx frontier --json` |
| Serve the same contract over MCP stdio | `rrx serve-mcp --stdio` |

## Five-Minute Start

### Option A: disposable demo

```bash
npx ralph-research demo writing
```

This creates a temporary Git repo, runs one accepted cycle, and prints the temp path plus the run id.

### Option B: initialize a local repo

```bash
npx ralph-research init --template writing
npx ralph-research doctor
npx ralph-research run --json
npx ralph-research status --json
npx ralph-research inspect run-0001 --json
```

This is the current truth contract for the bundled template: `init -> run -> inspect` should succeed quickly on a local machine.

## Runtime Model

The runtime is manifest-driven. `ralph.yaml` defines the project, proposer, experiment, metrics, ratchet, and storage root. The service layer then:

- loads and validates the manifest
- acquires a durable lock
- classifies recovery against the latest persisted run
- executes or resumes a candidate
- writes run, decision, and frontier state under the storage root

See [docs/operation-model.md](docs/operation-model.md) for the full lifecycle and recovery model.

## Current Scope

- Bundled template: `writing`
- Default template metric: local command metric, no API key required
- Optional judge path: pairwise LLM judge packs
- MCP tools:
  - `run_research_cycle`
  - `get_research_status`
  - `get_frontier`

The runtime supports broader manifests than the bundled template demonstrates, but the shipped onboarding path is intentionally narrow until those flows are equally reliable.

## Writing Template

The bundled writing template is self-contained:

- `docs/draft.md`: sample draft
- `scripts/propose.mjs`: bounded rewrite
- `scripts/experiment.mjs`: output materialization
- `scripts/metric.mjs`: local heuristic metric
- `prompts/judge.md`: pairwise judge prompt starter

`templates/writing/ralph.yaml` uses a local command metric by default, so the first run works without model credentials.

## Progressive Runs

`rrx run` executes one cycle by default and auto-resumes the latest recoverable run when one exists.

Progressive stop modes are opt-in:

- `--fresh`: start a new `runId` instead of auto-resuming the latest recoverable run
- `--until-target`: keep iterating until `manifest.stopping.target` is met
- `--until-no-improve N`: stop after `N` consecutive cycles without frontier improvement
- `--cycles N` with a progressive flag: treat `N` as a max-cycle cap instead of an exact count

The bundled `writing` template ships with `stopping.target` commented out, so enable that block in `ralph.yaml` before using `--until-target`.

```bash
npx ralph-research run --until-target --until-no-improve 3 --json
```

## More Docs

- [docs/operation-model.md](docs/operation-model.md): lifecycle, persisted state, recovery classes
- [docs/playbook.md](docs/playbook.md): situation-to-command operator guide
- [docs/examples.md](docs/examples.md): quickstart and manifest examples pulled from shipped templates and fixtures
- [docs/examples-catalog.md](docs/examples-catalog.md): broader scenario catalog grounded in shipped templates and test fixtures
- [docs/comparison.md](docs/comparison.md): why this runtime is narrower and more stateful than prompt-only loop systems
- [docs/faq.md](docs/faq.md): common runtime, recovery, and inspection questions
- [docs/knowledge/INDEX.md](docs/knowledge/INDEX.md): project knowledge log

## CLI

```text
rrx validate
rrx doctor
rrx init --template writing
rrx demo writing
rrx run
rrx run --fresh
rrx run --until-target
rrx run --until-no-improve 3
rrx run --until-target --until-no-improve 3
rrx status
rrx frontier
rrx inspect <runId>
rrx accept <runId>
rrx reject <runId>
rrx serve-mcp --stdio
```

## Core Concepts

- `Manifest`: `ralph.yaml` defines the research program
- `Metric`: how candidate quality is measured
- `Frontier`: the currently accepted best candidate set
- `Ratchet`: the acceptance policy that decides whether the frontier advances
- `Proposer`: how a bounded candidate change is generated
- `Judge`: how qualitative outputs are compared when numeric metrics are not enough

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

## License

MIT
