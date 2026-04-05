# Feature Landscape

**Domain:** local-first recursive research runtime / agentic CLI that mutates a repo and persists run state
**Researched:** 2026-04-05
**Scope:** trustworthy v1 capabilities around interruption recovery, contract clarity, manual review, and observability
**Overall confidence:** HIGH for table-stakes patterns, MEDIUM for differentiator ranking

## Executive Cut

For this category, a trustworthy v1 is not defined by more autonomy. It is defined by whether the operator can stop, inspect, resume, and verify the system without losing the repo or guessing what the runtime actually did.

The ecosystem has already normalized conversation resume, approval controls, diff review, and structured session visibility. For `ralph-research`, the bar is stricter than generic chat-session resume because it persists frontier state, emits decisions, and mutates a real repository. The minimum viable product therefore needs true execution recovery, not just transcript recovery.

Inference from sources: tools like OpenHands and Codex CLI make resume, approval modes, status, and review visible in the interface; LangGraph and the OpenAI Agents SDK treat interruption plus serialized resume state as a first-class runtime concern; aider treats git-backed review and undo as part of the default operating model. For this project, those patterns translate into a smaller, sharper requirement set: make the contract honest, make recovery real, and make every promoted change inspectable.

## Table Stakes

Features users should expect from a trustworthy v1 in this category. Missing these, the runtime feels unsafe or misleading.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| Phase-aware run resume from persisted execution state | Resume is already exposed by OpenHands and Codex CLI, while LangGraph and the OpenAI Agents SDK support interruption plus resume from stored state. For a repo-mutating runtime, resuming only chat history is not enough. | High | Versioned run-state machine, stable workspace identity, persisted phase checkpoints, idempotent step handlers | Must resume from `proposed`, `executed`, `evaluated`, `decision_written`, `committed`, or `frontier_pending` without minting a new run id. |
| Crash-safe checkpoints and explicit interruption states | Durable runtimes persist pause/resume state explicitly. A trustworthy v1 needs distinguishable states such as `paused`, `resume_required`, `repair_required`, and `completed`, not one generic failed bucket. | High | Append-only event journal or transactional store, checkpoint schema, migration strategy | This is the foundation for safe restarts after Ctrl+C, process death, timeout, or lock takeover. |
| Explicit approval controls and operator pause | OpenHands defaults to confirmation, supports `--always-approve` and `--llm-approve`, and lets the operator pause with `Esc`. Codex CLI exposes `/permissions`. Users now expect visible control over mutation risk. | Medium | Policy model, CLI/TUI controls, persisted approval mode, pending-action serialization | Safe default should be ask-first for repo writes and accept-path promotion. |
| Diff-first manual review before promotion | Codex CLI exposes `/diff` and `/review`, and aider assumes users may review or undo agent commits. A local runtime that changes files must show what changed before the repo is advanced. | Medium | Workspace isolation, git diff generation, decision record, rationale renderer | Review payload should include diff, metrics delta, acceptance reason, touched paths, and next action. |
| Git-backed isolation and one-step undo of agent changes | Aider auto-commits edits and separates existing dirty work before it edits. Users expect agent changes to be reviewable, reversible, and isolated from their own uncommitted work. | Medium-High | Branch or worktree isolation, commit boundaries, cleanup flow, restore semantics | Never let agent mutations silently merge with unrelated local dirt. |
| Honest contract surface and capability introspection | Codex CLI exposes `/status` and `/debug-config` so users can verify approval policy, writable roots, and effective config. In this category, exposed flags and manifest fields must match reality. | Medium | Schema validation, capability probes, config source reporting, docs and tests | Unsupported fields should fail fast. Silent ignore is worse than narrower scope. |
| Structured run evidence and inspectable status surfaces | OpenHands surfaces live status, the OpenAI Agents SDK provides tracing, and Claude Code supports transcript-mode logging and hooks. Users expect an inspectable record of actions, not just final prose. | Medium | Stable run ids, structured event schema, timestamps, inspect/status/frontier APIs | Minimum evidence: phase timeline, pending approvals, workspace path, lock owner, last checkpoint, metrics, decision, and cleanup state. |
| Shared accept/reject semantics between automated and manual paths | Manual review is not credible if it updates state through a separate, less-correct code path. The operator should be invoking the same promotion semantics the runtime uses automatically. | High | Shared promotion service, frontier update abstraction, transactional acceptance model | This is especially important for multi-entry frontier strategies such as Pareto-style frontiers. |

## Differentiators

Valuable features that improve trust and operability, but a v1 can ship without them if the table stakes above are solid.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| Transactional accept-and-repair workflow | Stronger than basic resume: the runtime can detect a half-applied promotion and either finish it or roll it back deterministically. This is unusually strong for local agent tooling and would materially differentiate `ralph-research`. | High | Acceptance transaction journal, compensating actions, repair CLI/service | Example outcome: `repair run-0042` can reconcile decision record, git commit, frontier update, and workspace cleanup. |
| Frontier-aware comparison and review UX | Most coding agents review a single diff. `ralph-research` can differentiate by showing before/after frontier membership, metric deltas, and why a candidate enters or exits the frontier. | High | Frontier model, shared comparison renderer, decision provenance | This is domain-specific leverage, not generic coding-agent parity. |
| Searchable run timeline and replay | Structured event playback makes forensic debugging and milestone audits much faster than grepping JSON files. | Medium-High | Indexed event store, replay formatter, timeline query API | Useful once run volume grows beyond dozens of runs. |
| Repo policy hooks and deterministic guardrails | Claude Code hooks show demand for deterministic controls, logging, and custom permissions around sensitive files or commands. A local runtime with repo-specific policy hooks would stand out. | Medium | Hook lifecycle, safe snapshotting, JSON event payloads, docs | Good fit for blocking protected paths or enforcing review requirements before promotion. |
| Risk-based approval escalation | OpenHands already offers LLM-based approval analysis. Adopting a narrower local version could reduce operator fatigue while keeping sensitive actions gated. | Medium-High | Action classifier, trust policy model, override controls, evaluation set | Useful later; not required for v1 if ask-first is reliable. |
| Rich observability UI on top of structured events | A TUI or HTML trace view is not required if `inspect` and `status` are strong, but it becomes a differentiator for long-running research loops and post-mortems. | Medium | Stable event schema, renderer, filtering/search | Build only after the underlying event model is correct. |

## Anti-Features

Things to explicitly avoid. They create the appearance of capability while reducing trust.

| Anti-Feature | Why Avoid | Complexity if Built Anyway | Dependencies It Drags In | What to Do Instead |
|--------------|-----------|-----------------------------|--------------------------|--------------------|
| Fake resume | A `--resume` flag that reloads metadata or transcript but restarts execution is worse than having no resume flag. It teaches the operator not to trust the tool. | High | Brittle ad hoc re-entry code, hidden new-run creation, manual cleanup burden | Either implement true phase resume or remove the flag and say recovery is not supported yet. |
| Silent contract drift | Accepting manifest fields, modes, or config values that are ignored at runtime creates false confidence and invalidates documentation. | Medium | Long-term support debt, bug reports, misleading tests | Reject unsupported fields at validation time and expose actual supported capabilities via status/debug surfaces. |
| Non-transactional accept path | Writing an accepted decision before promotion, commit, frontier update, and cleanup complete leaves mixed state that is expensive to repair. | High | Manual forensics, orphaned workspaces, inconsistent inspect/status output | Treat acceptance as a resumable transaction with explicit intermediate state. |
| Auto-approve as the default interactive mode | OpenHands documents `--always-approve` with caution for a reason. Defaulting to hands-off mutation for local repo writes makes the first trust failure too expensive. | Low | Higher support burden, harder incident recovery | Default to ask-first, then let advanced users opt into stronger automation consciously. |
| Manual review on a separate code path | If human accept/reject bypasses the same frontier and promotion logic as automated accept/reject, invariants drift and bugs multiply. | Medium | Duplicate business logic, state divergence, weak tests | Route manual decisions through the same promotion engine and frontier updater. |
| Unstructured logs without stable run ids | Raw console text is not enough for recovery or audit. Without stable ids and event types, operators cannot reconstruct what happened. | Low | Ad hoc grep workflows, brittle parsing, poor tooling | Emit structured events with run id, phase, timestamp, actor, and result. |

## Feature Dependencies

```text
Capability probes + schema validation
  -> Honest contract surface

Workspace isolation + explicit checkpoints
  -> Phase-aware resume

Phase-aware resume + approval state serialization
  -> Safe interruption recovery

Structured events + stable run ids
  -> inspect/status/frontier evidence

Shared promotion engine + acceptance transaction model
  -> Manual review that preserves frontier semantics

Git-backed isolation + diff generation
  -> Diff-first human review + one-step undo
```

## MVP Recommendation

Prioritize, in this order:

1. Phase-aware resume plus crash-safe checkpoints.
2. Honest capability surface plus preflight validation.
3. Shared manual review and acceptance semantics with diff-first inspection.
4. Structured run evidence in `status`, `inspect`, and frontier views.
5. Git-backed isolation and reliable undo/cleanup.

Defer:

- Risk-based approval escalation.
- Hook/plugin policy framework.
- Rich timeline UI.
- Full repair CLI, unless accept-path failures remain common after resume work.

## Sources

Local project context:

- `/Users/chsong/Developer/Personal/ralph-research/.planning/PROJECT.md`
- `/Users/chsong/Developer/Personal/ralph-research/.planning/codebase/CONCERNS.md`
- `/Users/chsong/Developer/Personal/ralph-research/README.md`

Authoritative external sources:

- LangGraph docs: durable resume and interruptions via persisted state
  - https://docs.langchain.com/oss/python/langgraph/functional-api
  - https://docs.langchain.com/oss/python/langgraph/use-subgraphs
- OpenAI Agents SDK docs: human-in-the-loop approvals, serialized `RunState`, and tracing
  - https://github.com/openai/openai-agents-python/blob/main/docs/human_in_the_loop.md
  - https://openai.github.io/openai-agents-js/guides/tracing/
- OpenHands docs: terminal pause, approval modes, live status, and local conversation resume
  - https://docs.openhands.dev/openhands/usage/cli/terminal
  - https://docs.openhands.dev/openhands/usage/cli/resume
- Codex CLI docs: permissions, diff, review, resume, status, and config diagnostics
  - https://developers.openai.com/codex/cli/slash-commands
- aider docs: git-backed commit isolation and undo
  - https://aider.chat/docs/git.html
- Claude Code docs: deterministic hooks, logging, and custom permissions
  - https://docs.anthropic.com/en/docs/claude-code/hooks
  - https://docs.anthropic.com/en/docs/claude-code/hooks-guide
