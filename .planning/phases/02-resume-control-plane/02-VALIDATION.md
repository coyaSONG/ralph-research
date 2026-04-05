---
phase: 02
slug: resume-control-plane
status: draft
nyquist_compliant: false
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
| **Quick run command** | `npx vitest run tests/state-engines.test.ts tests/run-cycle-service.test.ts tests/lockfile-workspace-manager.test.ts tests/cli-commands.test.ts` |
| **Full suite command** | `npm test && npm run typecheck` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/state-engines.test.ts tests/run-cycle-service.test.ts tests/lockfile-workspace-manager.test.ts`
- **After every plan wave:** Run `npx vitest run tests/state-engines.test.ts tests/run-cycle-service.test.ts tests/lockfile-workspace-manager.test.ts tests/cli-commands.test.ts`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | RECV-01 | T-02-01 | Latest recoverable run resumes on the same `runId`; `--fresh` always bypasses resume | integration | `npx vitest run tests/run-cycle-service.test.ts tests/cli-commands.test.ts` | ✅ | ⬜ pending |
| 02-01-02 | 01 | 1 | RECV-02 | T-02-02 | Resume dispatches from the last durable checkpoint and never guesses past missing evidence | integration + state | `npx vitest run tests/run-cycle-service.test.ts tests/state-engines.test.ts` | ✅ | ⬜ pending |
| 02-02-01 | 02 | 1 | RECV-03 | T-02-03 | `status`, `inspect`, CLI, and MCP expose one shared recovery classification and next action | service + CLI + MCP | `npx vitest run tests/project-state-service.test.ts tests/cli-commands.test.ts tests/mcp-server.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 2 | RECV-04 | T-02-04 | Active lease renewal prevents false stale takeover; expiry requires `ttl + grace`; active-owner failures stay explicit | integration | `npx vitest run tests/lockfile-workspace-manager.test.ts tests/run-cycle-service.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky*

---

## Wave 0 Requirements

- [ ] `tests/project-state-service.test.ts` - recovery classification coverage for `idle`, `resumable`, `manual_review_blocked`, and `repair_required`
- [ ] `tests/mcp-server.test.ts` - MCP parity for run and status recovery semantics
- [ ] Extend `tests/run-cycle-service.test.ts` - same-run resume fixtures for each durable checkpoint and `--fresh`
- [ ] Extend `tests/lockfile-workspace-manager.test.ts` - heartbeat renewal, grace-window takeover, and token-mismatch lease loss
- [ ] Extend `tests/cli-commands.test.ts` - recovery sections in `status` and `inspect`, plus active-lease error messaging

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
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
