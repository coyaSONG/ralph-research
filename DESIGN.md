# ralph-research — Design Document

## 1. Vision & Positioning
`ralph-research` is a local-first runtime for recursive research improvement: define metrics, run search, keep only verified improvements.

- Core differentiator: this is not just an agent that "does research"; it is an execution layer that measures candidate quality, records provenance, and only preserves verified improvements.
- Product wedge: open-source CLI with optional MCP exposure, designed for brownfield repos and local workflows.
- Positioning versus AutoResearch: generalizes metric-driven keep/discard beyond ML experiments into writing, literature synthesis, prompt iteration, and code improvement.
- Positioning versus orchestration systems: adds measurable progress, ratchet policies, and decision logs to agent workflows.
- Category framing: `CI for recursive research improvement`.

## 2. Architecture
### CLI-first hybrid
```text
                     +---------------------------+
                     |      User / Agent         |
                     +-------------+-------------+
                                   |
                 +-----------------+-----------------+
                 |                                   |
         +-------v--------+                 +--------v-------+
         |  CLI (`rrx`)   |                 |   MCP Server   |
         |  human-first   |                 |  agent-first   |
         +-------+--------+                 +--------+-------+
                 |                                   |
                 +-----------------+-----------------+
                                   |
                          +--------v--------+
                          |  App Services   |
                          | shared use-cases|
                          +--------+--------+
                                   |
                    +--------------+--------------+
                    |                             |
            +-------v--------+            +-------v--------+
            |  Core Engine   |            |  State Engine  |
            | run/evaluate   |            | frontier/      |
            | propose/judge  |            | ratchet        |
            +-------+--------+            +-------+--------+
                    |                             |
          +---------+---------+         +---------+---------+
          | Adapters / Ports  |         | File Stores       |
          | git, fs, process, |         | runs, decisions,  |
          | proposer, judge   |         | frontier          |
          +---------+---------+         +---------+---------+
                    |                             |
                    +--------------+--------------+
                                   |
                          +--------v--------+
                          | Repo / Worktree |
                          | .ralph state    |
                          +-----------------+
```

### Role split
- `CLI`: primary execution surface for humans, local dev, CI, and scripting.
- `MCP`: interoperability surface so external agents can invoke the same runtime through tools/resources.
- `Skill`: thin agent-specific UX wrapper that teaches usage patterns but does not reimplement policy.
- `Template`: onboarding layer for fast starts. The current bundled template set is `writing` only.

## 3. Core Concepts
- `Manifest`: executable research spec declaring project type, proposer, experiment command, metrics, constraints, frontier, ratchet policy, and storage.
- `Metric`: measurable signal used to evaluate a candidate. Can be numeric or LLM-judged.
- `Frontier`: currently accepted candidate set. `single_best` is the v0.1 default.
- `Ratchet`: acceptance logic that decides whether a candidate advances the frontier.
- `Proposer`: bounded mutation mechanism that creates a candidate artifact.
- `Judge`: versioned evaluation pack used for qualitative comparison.

## 4. CLI Surface
| Command | Purpose | Key Flags |
|---|---|---|
| `rrx doctor` | Print scaffold status | none |
| `rrx init` | Copy the starter template into the target directory | `--template <name>`, `--path`, `--force`, `--json` |
| `rrx validate` | Validate the manifest file | `--path`, `--json` |
| `rrx run` | Execute one or more research cycles | `--cycles`, `--resume`, `--json` |
| `rrx status` | Show current state, latest run, and pending review items | `--path`, `--json` |
| `rrx frontier` | Show current frontier entries | `--path`, `--json` |
| `rrx inspect <runId>` | Show run details, metrics, and decision rationale | `--path`, `--json` |
| `rrx accept <runId>` | Manually accept a pending candidate | `--note`, `--by` |
| `rrx reject <runId>` | Manually reject a pending candidate | `--note`, `--by` |
| `rrx serve-mcp` | Run the minimal MCP server over stdio | `--stdio` |
| `rrx demo writing` | Run the zero-config quickstart demo | `--path`, `--force`, `--json` |

## 5. MCP Surface
### Tools
- `run_research_cycle`: run one or more cycles end-to-end, including proposal, execution, evaluation, and decision.
- `get_research_status`: return current project status, last run, pending human gates, and summary.
- `get_frontier`: return current best candidate or frontier entries.

### Transport
- v0.1 ships stdio only.

## 6. Key Design Decisions
- The product core is `metric definition + experiment executor + ratchet policy + provenance log`.
- Policy enforcement must live in code, not prompts.
- The optimal delivery model is `CLI-first hybrid`.
- Role split is `CLI = execution engine`, `MCP = interoperability surface`, `Skill = agent UX adapter`, `Template = bootstrap`.
- `TypeScript/Node` is the most pragmatic runtime for v0.1 because it supports `CLI + MCP + schema + orchestration` in one codebase and enables `npx` distribution.
- `ralph.yaml` top-level fields are `project`, `proposer`, `experiment`, `judgePacks`, `metrics`, `constraints`, `frontier`, `ratchet`, and `storage`.
- Qualitative research should use `llm_judge` extractors with `pairwise`, `blind`, `repeats`, `aggregation`, and `factuality gates`.
- Multi-objective support should live in `frontier.strategy = pareto`, not inside metric declarations.
- The essential ratchet set is `epsilon_improve`, `approval_gate`, and later `pareto_dominance`.
- v0.1 should ship `single_best` only; Pareto comes later.
- Proposers should be `operator-based mutation planners`, not unconstrained free-form generators.
- Judge calls should be treated as versioned `judge packs`, not ad hoc model calls.
- Judge reliability needs `cross-family judges`, `version pinning`, `anchor calibration`, `human audit sampling`, and `low-confidence human gates`.
- Architecture should follow `CLI/MCP thin`, `app/services shared`, `core/state pure`, `adapters isolated`.
- Core state entities are `RunRecord`, `DecisionRecord`, and `FrontierEntry`.
- `git commit` must happen before frontier persistence to avoid inconsistent accepted state.
- Zero-config mode is allowed only for quickstart/demo use and should persist an inferred manifest afterward.
- First-run UX must reach value in under five minutes, preferably through a writing/README improvement demo.
- `template-first` is better than `wizard-first` for the MVP.
- Dogfooding is valuable but core engine changes should remain behind human review.
- v0.1 distribution should prioritize `npm + npx`; Homebrew, Docker, and GitHub Actions can wait.
- The key product difference is not “an agent that researches,” but “a local runtime that improves any artifact through measurable loops and keeps only verified gains.”
- The product name is `ralph-research`, with CLI alias `rrx`.

## 7. MVP Scope
### Included
- TypeScript/Node package with shared service layer
- `rrx doctor`, `rrx validate`, `rrx init`, `rrx demo`, `rrx run`, `rrx status`, `rrx frontier`, `rrx inspect`, `rrx accept`, `rrx reject`
- `single_best` frontier strategy
- `epsilon_improve` ratchet
- `approval_gate` ratchet
- `command` proposer
- `command` metric extractor
- `llm_judge` metric extractor with one basic judge pack format
- JSON-backed stores for runs, decisions, and frontier under `.ralph/`
- git worktree-based candidate workspace
- accepted candidate promotion with git commit
- thin MCP server exposing `run_research_cycle`, `get_research_status`, and `get_frontier` over stdio
- `writing` template and zero-config demo mode

### Excluded
- Pareto frontier automation
- significance testing and advanced statistical gates
- web UI
- multi-agent orchestration layer
- plugin marketplace
- distributed execution
- Homebrew, Docker, and GitHub Actions marketplace packaging
- complex provider abstraction beyond minimal judge/proposer needs
- additional bundled templates beyond `writing`
- MCP resources and extra management tools beyond the three-tool server

## 8. Revised 14-Day Plan
### Day 1
- Scaffold package, TypeScript config, test runner, command parser, logger, and source tree.

### Day 2
- Implement `RalphManifestSchema` and `rrx validate`.
- Include guardrail config fields up front: judge anchors, confidence thresholds, audit sampling, allowed globs, max files changed, max line delta, and storage root.

### Day 3
- Implement `RunRecord`, `DecisionRecord`, and `FrontierEntry`.
- Add state-phase metadata needed for resume-safe execution and recovery.

### Day 4
- Implement `frontier-engine`, `constraint-engine`, and `ratchet-engine`.
- Also define a recoverable state machine with explicit phases and idempotent transitions.
- Generate structured acceptance/rejection reasons as part of the state model.

### Day 5
- Implement lockfile, git worktree workspace manager, and stale workspace recovery.

### Day 6
- Implement proposer, experiment runner, and command extractors.
- Enforce bounded change with diff budget and file scope checks.

### Day 7
- Implement trusted-signal judge pack support.
- Include pairwise judging, anchor agreement, low-confidence human gates, and audit sampling.

### Day 8
- Compose the end-to-end cycle runner and service layer.
- Ensure accepted, rejected, needs-human, audit-required, and resume-required paths all work.

### Day 9
- Implement `inspect` first, then `run`, `frontier`, and `status`.
- Make `inspect` show diff summary, metric deltas, constraint results, decision reason, and judge rationale.

### Day 10
- Implement accept/reject CLI and transaction-safe promote/commit flow.
- Re-run scope checks before commit and support recovery after partial failure.

### Day 11
- Implement minimal MCP only: `run_research_cycle`, `get_research_status`, `get_frontier`.

### Day 12
- Ship one polished `writing` template and zero-config demo.
- Include sample corpus, sample anchors, and a demo inspect output.

### Day 13
- Improve README, logging, error messages, audit queue visibility, and first-run UX.

### Day 14
- Stabilize, run smoke tests, verify crash/restart behavior, and prepare the first npm release.

## 9. Critical Guardrails
- `trusted signal`: anchor set + pairwise judge + human audit sample.
- `transaction safety`: recoverable run/decision/frontier state machine.
- `bounded change`: patch budget + allowed file scope.
- `explainability`: inspect output must clearly show why a run was accepted or rejected.
