# Comparison

`ralph-research` sits between three things people sometimes confuse it with:

1. **Prompt-only "ralph loop" patterns** — the original write-evaluate-accept
   idea this project is named after, when run as a single LLM transcript
   without a runtime underneath it.
2. **General agent orchestrators** — frameworks like
   [LangGraph](https://github.com/langchain-ai/langgraph) that let you wire up
   arbitrary state-machine graphs of LLM and tool calls.
3. **Vertical coding agents** — tools like
   [aider](https://github.com/Aider-AI/aider) that pair-program over a Git
   repository with an LLM driving edits.

This page exists so you can place `ralph-research` on the map honestly before
filing an issue that asks it to be one of the other three.

## Where `ralph-research` lives on the map

| Concern | `ralph-research` | Prompt-only ralph loop | LangGraph | aider |
| --- | --- | --- | --- | --- |
| Primary surface | CLI + stdio MCP | LLM transcript | Python library + LangGraph Cloud | CLI |
| Bounded write-evaluate-accept loop | yes, manifest-driven | yes, in prose | possible, you build it | yes, for code |
| Persisted run / decision / frontier state on disk | yes, JSON under `.ralph/` | no | configurable checkpointers | git history + chat log |
| Inspectable recovery classifier | yes (`rrx status`, `rrx inspect`, `docs/operation-model.md`) | n/a | depends on checkpointer + your code | replay from git |
| Hosted alternative | none planned | n/a | LangSmith / LangGraph Cloud | none |
| First-run UX | `npx ralph-research demo writing` / `demo code`, no API key needed | model + prompt required | LLM key required | LLM key required |
| Domain coverage | small, bounded — prose + tiny code template today | as broad as your prompt | very broad | code editing |

Where every cell in that table is honest, including the ones where another
project is plainly broader (LangGraph) or more polished for a specific domain
(aider).

## When to pick something else

- You want a hosted product with a UI for non-CLI users → look at LangGraph
  Cloud or any of the agent-platform vendors.
- You want a code-editing pair programmer → use aider; it has years of
  domain-specific affordances `ralph-research` does not.
- You want maximum flexibility to wire arbitrary agent graphs → LangGraph
  gives you a richer state-machine API than this runtime intentionally
  exposes.
- You want a one-shot LLM loop in a single transcript with no persisted
  state → just write the ralph loop as a prompt; you don't need a runtime.

## When `ralph-research` is the better default

- You are running the loop locally and want **the same artifact set** that the
  CLI promises to leave behind — runs, decisions, frontier, lockfile —
  available for `rrx status`, `rrx inspect`, and any post-mortem you might
  need.
- You want **resume semantics enforced by code**, not described in prose,
  including the explicit "this session is not safely resumable" case (see
  [`docs/operation-model.md`](operation-model.md)).
- You want the bundled onboarding path to **actually work end-to-end** without
  setting up API keys for the first cycle.
- You want a runtime that says "no" to its own contract surface when it
  cannot prove the behavior — see the
  ["What It Is Not"](../README.md#what-it-is-not) list in the README.

## The quality bar this repo holds itself to

Beyond feature lists, three things define the difference:

1. **A run is resumable only when it is actually resumable.** The recovery
   classifier in `src/core/state/research-session-recovery-classifier.ts`
   refuses to mark a session resumable when the persisted lifecycle and the
   live process disagree — including the Linux-CI edge case fixed in
   [`v0.1.5`](../CHANGELOG.md#015---2026-05-17).
2. **Blocked manual review is surfaced as a block, not hidden.** `rrx status`
   reports pending human runs instead of pretending the loop is healthy.
3. **Accepted changes leave persisted evidence.** Every accepted run writes
   its diff, metric deltas, rationale, and frontier transition. `rrx inspect`
   reads from that file, not from a re-derived narrative.

If any of those three properties is what you came for, this runtime is the
better default. If you need something broader and you do not need those
properties enforced, one of the alternatives above is the more honest pick.

## Related docs

- [README.md](../README.md)
- [playbook.md](playbook.md)
- [operation-model.md](operation-model.md)
- [examples.md](examples.md)
- [faq.md](faq.md)
