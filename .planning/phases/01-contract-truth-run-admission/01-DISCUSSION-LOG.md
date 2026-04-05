# Phase 1: Contract Truth & Run Admission - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-05
**Phase:** 1-Contract Truth & Run Admission
**Areas discussed:** Contract enforcement model, Compatibility policy, Admission gate surface

---

## Contract enforcement model

| Option | Description | Selected |
|--------|-------------|----------|
| Implement unsupported surface now | Preserve manifest breadth immediately by adding support for the currently unimplemented runtime branches | |
| Reject unsupported surface explicitly | Narrow support now and make the runtime truthful before adding breadth later | ✓ |
| Mixed approach | Implement one branch now and silently defer the rest | |

**User's choice:** Reject unsupported surface explicitly
**Notes:** User accepted the default recommendation. Phase 1 should favor truthful contract enforcement over widening support prematurely.

---

## Compatibility policy

| Option | Description | Selected |
|--------|-------------|----------|
| Silent fallback | Accept unsupported declarations and quietly run the closest supported path | |
| Fail-fast with explicit errors | Stop before destructive execution and explain exactly which declared capability is unsupported | ✓ |
| Warning-only | Allow execution but emit warnings about unsupported fields | |

**User's choice:** Fail-fast with explicit errors
**Notes:** User accepted the default recommendation. Compatibility should be preserved through diagnostics, not through implicit fallback.

---

## Admission gate surface

| Option | Description | Selected |
|--------|-------------|----------|
| Shared admission gate | `validate`, `doctor`, and `run` use the same capability truth checks | ✓ |
| Validate-only gate | Keep capability truth checks only in preflight commands and let `run` drift | |
| Run-only gate | Keep validation light and enforce truth only during execution | |

**User's choice:** Shared admission gate
**Notes:** User accepted the default recommendation. Phase 1 should make preflight and execution agree on what manifests are actually runnable.

---

## the agent's Discretion

- Internal design of the shared admission check abstraction
- Exact placement of capability truth checks across schema refinement vs service-level admission
- Exact diagnostic wording and output structure

## Deferred Ideas

- JSON-state migration strategy for the later recovery/control-plane work
- Promotion evidence format for later durability phases
- Broader workspace backend expansion beyond Git worktrees
