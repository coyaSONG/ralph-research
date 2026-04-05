# Requirements: ralph-research

**Defined:** 2026-04-05
**Core Value:** When I run the tool, the workflow contract must match reality and stateful operations must be safe to resume, inspect, and trust.

## v1 Requirements

### Recovery

- [ ] **RECV-01**: Operator can resume an interrupted run with the same `runId` instead of starting a fresh run
- [ ] **RECV-02**: Operator can resume from the last durable execution step after interruption during proposal, experiment, evaluation, decision writing, commit, or frontier update
- [ ] **RECV-03**: Operator can see whether a run is resumable, blocked for manual review, or requires repair via stable `status` and `inspect` output
- [ ] **RECV-04**: Operator can recover from long-running execution without a stale lock incorrectly allowing another process to take over active work

### Contract

- [ ] **CONT-01**: Operator gets fail-fast validation when a manifest declares unsupported proposer, workspace, or baseline behavior
- [ ] **CONT-02**: Operator can rely on supported manifest fields to affect runtime behavior exactly as documented
- [ ] **CONT-03**: Operator can run validation or doctor checks that reveal capability mismatches before a destructive run starts

### Review

- [ ] **REVW-01**: Operator can manually accept a `needs_human` run without collapsing or corrupting the active frontier for `single_best` or `pareto` strategies
- [ ] **REVW-02**: Operator can manually reject a `needs_human` run and keep frontier state, run state, and cleanup behavior internally consistent
- [ ] **REVW-03**: Operator can see consistent post-decision results across `status`, `frontier`, and `inspect` after manual review
- [ ] **REVW-04**: Operator manual approval and automated acceptance use the same promotion and frontier semantics

### Stability

- [ ] **STAB-01**: Operator can trust accepted runs not to leave partially committed or partially promoted repository state without a durable repair path
- [ ] **STAB-02**: Operator can trust frontier persistence to remain rebuildable and internally consistent after crashes or partial failures
- [ ] **STAB-03**: Maintainer has automated regression tests covering resume behavior across interruption points
- [ ] **STAB-04**: Maintainer has automated regression tests covering manifest/runtime contract enforcement
- [ ] **STAB-05**: Maintainer has automated regression tests covering manual review, frontier integrity, and post-decision read models

## v2 Requirements

### Tooling

- **TOOL-01**: Operator can run dedicated repair tooling for abandoned workspaces, broken promotions, and frontier rebuilds
- **TOOL-02**: Operator can inspect a richer run timeline with replay-oriented event views

### Hardening

- **HARD-01**: Operator can run manifest commands in a stricter execution sandbox with env allowlists and reduced shell dependence
- **HARD-02**: Operator can attach repository policy hooks or branch-based promotion controls before accepting changes

### UX

- **UX-01**: Operator can review manual approval decisions through a richer TUI or HTML interface
- **UX-02**: Operator can use broader MCP controls beyond the current thin runtime surface

## Out of Scope

| Feature | Reason |
|---------|--------|
| New bundled templates | Core trust and runtime correctness are more important than expanding template breadth right now |
| New major MCP product surface | Existing thin MCP interface is sufficient for this milestone; reliability comes first |
| Visual UX polish or branding work | The current problem is behavioral correctness, not presentation |
| Non-Git workspace expansion as a primary milestone goal | Workspace contract truth matters now, but broad backend expansion can wait until the current Git-based model is trustworthy |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| RECV-01 | TBD | Pending |
| RECV-02 | TBD | Pending |
| RECV-03 | TBD | Pending |
| RECV-04 | TBD | Pending |
| CONT-01 | TBD | Pending |
| CONT-02 | TBD | Pending |
| CONT-03 | TBD | Pending |
| REVW-01 | TBD | Pending |
| REVW-02 | TBD | Pending |
| REVW-03 | TBD | Pending |
| REVW-04 | TBD | Pending |
| STAB-01 | TBD | Pending |
| STAB-02 | TBD | Pending |
| STAB-03 | TBD | Pending |
| STAB-04 | TBD | Pending |
| STAB-05 | TBD | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 0
- Unmapped: 16 ⚠️

---
*Requirements defined: 2026-04-05*
*Last updated: 2026-04-05 after initial definition*
