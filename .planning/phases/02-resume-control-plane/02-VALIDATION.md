---
phase: 02
slug: resume-control-plane
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-05
---

# Phase 02 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/state-engines.test.ts tests/run-cycle-service.test.ts tests/lockfile-workspace-manager.test.ts tests/run-command.test.ts tests/status-inspect-command.test.ts` |
| **Full suite command** | `npm test && npm run typecheck` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/state-engines.test.ts tests/run-cycle-service.test.ts tests/lockfile-workspace-manager.test.ts`
- **After every plan wave:** Run `npx vitest run tests/state-engines.test.ts tests/run-cycle-service.test.ts tests/lockfile-workspace-manager.test.ts tests/run-command.test.ts tests/status-inspect-command.test.ts`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | RECV-03 | T-02-01 | Shared classifier returns `idle`, `resumable`, `manual_review_blocked`, and `repair_required` from durable evidence | state | `npx vitest run tests/state-engines.test.ts` | ✅ | ⬜ pending |
| 02-01-02 | 01 | 1 | RECV-02 | T-02-02 | Checkpoint phases mean last durable boundary completed and accepted-path ambiguity becomes `repair_required` | state | `npx vitest run tests/state-engines.test.ts` | ✅ | ⬜ pending |
| 02-02-01 | 02 | 2 | RECV-01 | T-02-05 | Latest recoverable run resumes on the same `runId`; `--fresh` always starts a new run | integration + CLI | `npx vitest run tests/run-cycle-service.test.ts tests/run-command.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | RECV-02 | T-02-04 | Same-run dispatcher resumes proposal, experiment, evaluation, decision, commit, and frontier checkpoints when durable evidence exists | integration + state | `npx vitest run tests/state-engines.test.ts tests/run-cycle-service.test.ts tests/run-command.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-00 | 03 | 3 | RECV-03 | T-02-07 | Wave 0 read-model tests exist for service, CLI, and MCP recovery payloads | service + CLI + MCP | `npx vitest run tests/project-state-service.test.ts tests/mcp-server.test.ts tests/status-inspect-command.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 3 | RECV-03 | T-02-09 | `status`, `inspect`, and MCP serialize one shared recovery payload with `classification`, `nextAction`, `reason`, and `resumeAllowed` | service + CLI + MCP | `npx vitest run tests/project-state-service.test.ts tests/mcp-server.test.ts tests/status-inspect-command.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-01 | 04 | 3 | RECV-04 | T-02-10 / T-02-11 | Lease tests lock in heartbeat renewal, grace-window takeover, and token protection | integration | `npx vitest run tests/lockfile-workspace-manager.test.ts tests/run-cycle-service.test.ts` | ✅ | ⬜ pending |
| 02-04-02 | 04 | 3 | RECV-04 | T-02-12 | Service-owned lease renewal prevents false stale takeover and reports active owner details immediately | integration | `npx vitest run tests/lockfile-workspace-manager.test.ts tests/run-cycle-service.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky*

---

## Wave 0 Requirements

- [ ] `tests/run-command.test.ts` - CLI coverage for auto-resume, `--fresh`, repair-required warning, and preserved-vs-fresh `runId`
- [ ] `tests/project-state-service.test.ts` - recovery classification coverage for `idle`, `resumable`, `manual_review_blocked`, and `repair_required`
- [ ] `tests/mcp-server.test.ts` - MCP parity for run and status recovery semantics
- [ ] `tests/status-inspect-command.test.ts` - dedicated `status` and `inspect` recovery output coverage
- [ ] Extend `tests/run-cycle-service.test.ts` - same-run resume fixtures for proposal through frontier checkpoints plus active-lease failures
- [ ] Extend `tests/lockfile-workspace-manager.test.ts` - heartbeat renewal, grace-window takeover, and token-mismatch lease loss

---

## Manual-Only Verifications

All phase behaviors should have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
