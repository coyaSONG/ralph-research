# ralph-research

## What This Is

`ralph-research` is a local-first runtime for recursive research improvement over real artifacts. It currently ships as a CLI and stdio MCP server with a bounded write-evaluate-accept loop, and this project focuses on making that core loop actually reliable for the primary user: me.

## Core Value

When I run the tool, the workflow contract must match reality and stateful operations must be safe to resume, inspect, and trust.

## Requirements

### Validated

- ✓ User can initialize and run a local bounded research cycle through the CLI using the existing writing template — existing
- ✓ User can inspect run status, frontier state, and persisted decision records after a cycle completes — existing
- ✓ User can expose the same core runtime through a stdio MCP server for thin tool-based access — existing
- ✓ User can enter a manual review flow for `needs_human` runs and accept or reject candidates — existing

### Active

- [ ] User can resume an interrupted run from persisted state instead of being forced to restart manually
- [ ] Manifest options exposed to users match actual runtime behavior for workspace strategy, baseline selection, and proposer support
- [ ] User can manually accept or reject a `needs_human` run without corrupting frontier semantics or follow-up inspection/status views
- [ ] Core stability paths are locked down with regression tests so the same failures do not reappear silently

### Out of Scope

- New end-user templates beyond the current writing flow — reliability is higher priority than expanding template surface area
- Major MCP product expansion beyond the existing thin runtime surface — transport breadth is not the current bottleneck
- Broad UX polish or branding work — the primary issue is behavioral correctness, not visual presentation

## Context

This is a brownfield TypeScript/Node codebase with a layered CLI + MCP + engine architecture documented in `.planning/codebase/`. The current runtime already supports a bounded candidate loop, persisted run/decision/frontier state, Git worktree-based execution, and a manual review path, but the codebase map surfaced several trust gaps: `--resume` advertises recoverability without real phase-aware resume execution, the manifest schema exposes options the runtime does not honor, and manual acceptance appears to collapse frontier state in ways that conflict with multi-entry frontier models.

The primary user is me, so the quality bar is practical reliability: if the tool says a run is recoverable, it must actually recover; if the manifest accepts an option, the runtime must either honor it or reject it clearly; if a human accepts a run, status/frontier/inspect must stay internally consistent. Existing test coverage is decent for the happy path, but critical operational paths still need targeted regression coverage.

## Constraints

- **Tech stack**: Keep the implementation within the existing TypeScript + Node + Vitest architecture — avoid a rewrite and preserve the current package/runtime model
- **Brownfield compatibility**: Preserve the existing CLI and MCP mental model where possible — users should not need to relearn the core flow just to gain reliability
- **Behavioral correctness**: Prefer removing unsupported contract surface over pretending to support it — misleading configuration is worse than narrower scope
- **Testability**: Every stability fix in scope must be backed by automated regression coverage — "works once" is not enough for this project

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Prioritize core stability over feature expansion | Current pain is low trust and weak usability in operational paths, not lack of breadth | — Pending |
| Treat this as a brownfield hardening project | The runtime already has validated value; the work is to make existing promises true | — Pending |
| Define done as real runtime behavior plus tests | The user explicitly wants the system to actually work, not just look more complete | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-05 after initialization*
