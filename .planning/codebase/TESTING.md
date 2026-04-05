# Testing Patterns

**Analysis Date:** 2026-04-05

## Test Framework

**Runner:**
- Vitest `^3.2.4`
- Config: `vitest.config.ts`
- Environment: Node only (`environment: "node"` in `vitest.config.ts`)
- Included files: `tests/**/*.test.ts`

**Assertion Library:**
- Vitest `expect`, including sync assertions, async `rejects`, and exception assertions.

**Run Commands:**
```bash
npm test              # Run all tests via `vitest run`
npm run test:watch    # Watch mode via `vitest`
# Coverage is not configured in package scripts; `vitest.config.ts` sets `coverage.enabled: false`
```

**Observed verification:**
- `npm test` passes: 12 test files, 63 tests.
- `npm run typecheck` passes.

## Test File Organization

**Location:**
- Tests are centralized under `tests/`, not co-located with source files.
- Static manifest fixtures live under `tests/fixtures/manifests/`.

**Naming:**
- Use `*.test.ts` names that mirror the domain under test: `tests/state-engines.test.ts`, `tests/run-cycle-service.test.ts`, `tests/cli-commands.test.ts`.

**Structure:**
```text
tests/
├── *.test.ts
└── fixtures/
    └── manifests/
        └── *.ralph.yaml
```

## Test Structure

**Suite Organization:**
```typescript
let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "ralph-research-cli-"));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("CLI commands", () => {
  it("runs a cycle and returns JSON output", async () => {
    const repoRoot = await initFixtureRepo("numeric");
    const io = createCapturingIo();

    const exitCode = await runRunCommand({ cycles: 1, json: true }, io);

    expect(exitCode).toBe(0);
  });
});
```
- This pattern is taken directly from `tests/cli-commands.test.ts`.

**Patterns:**
- Use top-level `describe` blocks named after the module or behavior under test, such as `"JSON file stores"` in `tests/json-stores.test.ts` and `"trusted signal guardrails"` in `tests/judge-trusted-signal.test.ts`.
- Use `beforeEach` and `afterEach` to allocate and clean up temporary directories. This appears in `tests/cli-commands.test.ts`, `tests/run-cycle-service.test.ts`, `tests/command-runtime.test.ts`, `tests/lockfile-workspace-manager.test.ts`, and similar files.
- Keep per-file factory helpers close to the tests that use them. Examples: `makeRunRecord` in `tests/json-stores.test.ts`, `makeMetric` in `tests/state-engines.test.ts`, and `createBufferedIo` in `tests/validate-command.test.ts`.
- Assert end-to-end state, not only returned values, in integration tests. `tests/run-cycle-service.test.ts` and `tests/cli-commands.test.ts` verify persisted JSON stores, git commits, frontier snapshots, and changed files.

## Mocking

**Framework:** Handwritten fakes and seam injection; no `vi.mock`, `vi.spyOn`, or module auto-mocking is used.

**Patterns:**
```typescript
function createSequentialJudgeProvider(responses: JudgeResponse[]): JudgeProvider {
  let index = 0;
  return {
    async evaluate(_request: JudgeRequest): Promise<JudgeResponse> {
      const response = responses[index];
      index += 1;
      if (!response) {
        throw new Error("judge response sequence exhausted");
      }
      return response;
    },
  };
}
```
- This is the dominant mocking style in `tests/cli-commands.test.ts`, `tests/run-cycle-service.test.ts`, and `tests/judge-trusted-signal.test.ts`.

```typescript
function createCapturingIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout: (message: string) => {
      stdout.push(message);
    },
    stderr: (message: string) => {
      stderr.push(message);
    },
    stdoutText: () => stdout.join("\n"),
    stderrText: () => stderr.join("\n"),
  };
}
```
- IO seams are mocked with tiny in-memory collectors in `tests/cli-commands.test.ts` and `tests/validate-command.test.ts`.

**What to Mock:**
- External decision boundaries such as `JudgeProvider` in `tests/judge-trusted-signal.test.ts` and `tests/run-cycle-service.test.ts`.
- Human-facing IO contracts such as `CommandIO` in `tests/cli-commands.test.ts` and `tests/validate-command.test.ts`.
- Generated inputs at the test boundary, such as manifest YAML strings and temp repo scripts in `tests/cli-commands.test.ts` and `tests/run-cycle-service.test.ts`.

**What NOT to Mock:**
- Do not mock filesystem persistence for store tests. `tests/json-stores.test.ts` exercises real file writes and reads against temp directories.
- Do not mock Git behavior for workspace, cycle, or CLI integration paths. `tests/lockfile-workspace-manager.test.ts`, `tests/run-cycle-service.test.ts`, and `tests/cli-commands.test.ts` use real temp git repositories via `execa`.
- Do not mock pure state engines. `tests/state-engines.test.ts` and `tests/change-budget.test.ts` call the real functions directly.

## Fixtures and Factories

**Test Data:**
```typescript
function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-001",
    cycle: 1,
    candidateId: "candidate-001",
    status: "running",
    phase: "proposed",
    pendingAction: "execute_experiment",
    startedAt: "2026-03-29T00:00:00.000Z",
    manifestHash: "manifest-hash",
    workspaceRef: "main",
    proposal: {
      proposerType: "command",
      summary: "Generated a bounded patch.",
      operators: ["operator-a"],
    },
    artifacts: [],
    metrics: {},
    constraints: [],
    logs: {},
    ...overrides,
  };
}
```
- Inline factories like this appear in `tests/json-stores.test.ts` and `tests/state-engines.test.ts`.

**Location:**
- Simple factories stay inside the owning test file.
- Reusable static fixtures live in `tests/fixtures/manifests/*.ralph.yaml`.
- Complex integration fixtures are built imperatively in helper functions such as `initFixtureRepo` in `tests/cli-commands.test.ts` and `tests/run-cycle-service.test.ts`.

## Coverage

**Requirements:** None enforced. `vitest.config.ts` explicitly sets `coverage.enabled: false`.

**View Coverage:**
```bash
# Not configured in the current repo. Enable coverage in `vitest.config.ts`
# and add the relevant Vitest coverage provider before relying on reports.
```

## Test Types

**Unit Tests:**
- Pure logic tests target state engines and small helpers directly.
- Examples: `tests/state-engines.test.ts`, `tests/judge-trusted-signal.test.ts`, `tests/scaffold.test.ts`, and `tests/manifest-loader.test.ts`.
- Unit tests typically use inline factories and no process-level side effects beyond temporary directories.

**Integration Tests:**
- Integration coverage is strong and uses real OS and git boundaries.
- `tests/run-cycle-service.test.ts` exercises run orchestration, persistence, frontier updates, and git commits.
- `tests/cli-commands.test.ts` validates command JSON/text output and cross-checks persisted state after command execution.
- `tests/lockfile-workspace-manager.test.ts`, `tests/command-runtime.test.ts`, `tests/init-demo.test.ts`, and `tests/change-budget.test.ts` use actual temp repos, actual files, and real subprocesses.

**E2E Tests:**
- Not used. No Playwright, Cypress, or browser-based end-to-end setup is present.

## Common Patterns

**Async Testing:**
```typescript
it("prints success output for a valid manifest", async () => {
  const buffer = createBufferedIo();
  const exitCode = await runValidateCommand(
    {
      path: new URL("valid-writing.ralph.yaml", fixturesDir).pathname,
      json: false,
    },
    buffer.io,
  );

  expect(exitCode).toBe(0);
  expect(buffer.stdout[0]).toContain("Manifest is valid:");
});
```
- This async pattern comes from `tests/validate-command.test.ts`.

**Error Testing:**
```typescript
await expect(
  loadManifestFromFile(new URL("invalid-ratchet-metric.ralph.yaml", fixturesDir).pathname),
).rejects.toBeInstanceOf(ManifestLoadError);

expect(() => updateSingleBestFrontier([incumbentA, incumbentB], candidate, "quality")).toThrow(
  "single_best frontier expected at most one entry",
);
```
- Rejection assertions are used in `tests/manifest-loader.test.ts`.
- Synchronous invariant assertions are used in `tests/state-engines.test.ts`.

## Prescriptive Summary

- Put new tests in `tests/` and name them after the behavior under test with a `.test.ts` suffix.
- Prefer real filesystem and git integration in temp directories over deep mocking when testing adapters, commands, or services.
- Introduce small in-file helpers for repeated setup instead of shared global fixtures.
- Mock only explicit seams such as `JudgeProvider` and `CommandIO`; keep core workflows wired to real dependencies.
- If you add a new CLI command or service, include both success-path assertions and persisted-state assertions modeled on `tests/cli-commands.test.ts` and `tests/run-cycle-service.test.ts`.

---

*Testing analysis: 2026-04-05*
