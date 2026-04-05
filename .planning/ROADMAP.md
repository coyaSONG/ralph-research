# Roadmap: ralph-research

## Overview

This milestone hardens the existing local-first runtime in the order the trust model actually depends on: first make the manifest and run admission contract truthful, then make interrupted execution safely resumable, then make promotion and frontier persistence durable, then unify manual review with those same semantics, and finally lock the whole path down with regression coverage.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Contract Truth & Run Admission** - Unsupported manifest/runtime combinations are rejected before a destructive run can start. (completed 2026-04-05)
- [ ] **Phase 2: Resume Control Plane** - Interrupted runs can resume safely on the same `runId` with truthful recovery state.
- [ ] **Phase 3: Promotion Durability & Frontier Persistence** - Accepted runs promote changes through a repairable path and keep frontier state rebuildable.
- [ ] **Phase 4: Manual Review Semantic Unification** - Human accept/reject decisions preserve the same frontier and read-model semantics as automation.
- [ ] **Phase 5: Regression Hardening Matrix** - Recovery, contract, promotion, and review guarantees stay protected by automated tests.

## Phase Details

### Phase 1: Contract Truth & Run Admission
**Goal**: Operators can start only runs whose declared manifest capabilities match real runtime behavior.
**Depends on**: Nothing (first phase)
**Requirements**: CONT-01, CONT-02, CONT-03
**Success Criteria** (what must be TRUE):
  1. Operator can run validation or doctor checks and see unsupported proposer, workspace, or baseline declarations rejected before any repo mutation starts.
  2. Operator can rely on every supported manifest field to change runtime behavior exactly as documented instead of being silently ignored.
  3. Operator can distinguish executable manifests from capability-mismatched manifests through a stable preflight surface before starting a run.
**Plans**: 3 plans
Plans:
- [x] 01-01-PLAN.md - Define the shared manifest admission contract and unsupported-surface rejection matrix
- [x] 01-02-PLAN.md - Enforce baseline-aware run admission before workspace and run-state mutation
- [x] 01-03-PLAN.md - Unify doctor and validate preflight on the shared admission gate

### Phase 2: Resume Control Plane
**Goal**: Operators can resume interrupted work on the same run safely and know whether a run is resumable, manual-review-blocked, or repair-required.
**Depends on**: Phase 1
**Requirements**: RECV-01, RECV-02, RECV-03, RECV-04
**Success Criteria** (what must be TRUE):
  1. Operator can resume an interrupted run with the same `runId` instead of starting a fresh run.
  2. Operator can resume from the last durable execution step after interruption during proposal, experiment, evaluation, decision writing, commit, or frontier update.
  3. Operator can inspect stable `status` and `inspect` output that labels a run as resumable, blocked for manual review, or in need of repair.
  4. Operator can recover long-running execution without a stale lock incorrectly allowing another process to take over active work.
**Plans**: TBD

### Phase 3: Promotion Durability & Frontier Persistence
**Goal**: Accepted runs mutate the repository and frontier through a durable, repairable promotion path.
**Depends on**: Phase 2
**Requirements**: STAB-01, STAB-02
**Success Criteria** (what must be TRUE):
  1. Operator can accept a run without being left in ambiguous partially committed or partially promoted repository state.
  2. Operator can recover or repair an interrupted promotion path from durable records instead of reconstructing repo state manually.
  3. Operator can rebuild persisted frontier state after crashes or partial failures and get internally consistent frontier data back.
**Plans**: TBD

### Phase 4: Manual Review Semantic Unification
**Goal**: Manual review uses the same promotion and frontier semantics as automated acceptance and leaves post-decision read models consistent.
**Depends on**: Phase 3
**Requirements**: REVW-01, REVW-02, REVW-03, REVW-04
**Success Criteria** (what must be TRUE):
  1. Operator can manually accept a `needs_human` run without corrupting frontier membership for `single_best` or `pareto` strategies.
  2. Operator can manually reject a `needs_human` run and keep run state, frontier state, and cleanup behavior internally consistent.
  3. Operator can compare `status`, `frontier`, and `inspect` after manual review and see the same post-decision truth in each surface.
  4. Operator can trust manual approval and automated acceptance to produce the same promotion and frontier semantics.
**Plans**: TBD

### Phase 5: Regression Hardening Matrix
**Goal**: Core runtime hardening remains trustworthy because the highest-risk recovery, contract, and review paths are covered by automated regression tests.
**Depends on**: Phase 4
**Requirements**: STAB-03, STAB-04, STAB-05
**Success Criteria** (what must be TRUE):
  1. Maintainer can run automated tests that simulate interruption points and verify same-`runId` resume behavior across recovery boundaries.
  2. Maintainer can run automated tests that fail when manifest/runtime contract enforcement drifts from documented support.
  3. Maintainer can run automated tests that catch manual review, frontier integrity, and post-decision read-model regressions before release.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Contract Truth & Run Admission | 3/3 | Complete    | 2026-04-05 |
| 2. Resume Control Plane | 0/TBD | Not started | - |
| 3. Promotion Durability & Frontier Persistence | 0/TBD | Not started | - |
| 4. Manual Review Semantic Unification | 0/TBD | Not started | - |
| 5. Regression Hardening Matrix | 0/TBD | Not started | - |
