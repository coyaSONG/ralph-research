# Troubleshooting

Common problems and the shortest path to a fix. Issues here are real ones that
have come up during development or in CI; we add to this page whenever a new
failure mode surfaces.

If your problem is not here, file an issue using
[`.github/ISSUE_TEMPLATE/bug_report.yml`](../.github/ISSUE_TEMPLATE/bug_report.yml).
The template asks for the version, Node version, OS, and exact commands so we
can convert your report into a fix quickly.

## Installation

### `npx ralph-research` prints "command not found" or hangs forever

Make sure you are on Node 24 or newer:

```bash
node --version    # expected: v24.x or higher
```

`ralph-research` declares `"engines": { "node": ">=24" }` in `package.json` and
relies on Node's built-in `node:test` runner for the bundled `code` template.
On older Node versions `npx` may resolve a cached install that no longer
runs.

### `npx ralph-research` resolves to an old version

Clear the npx cache and try again:

```bash
npm cache clean --force
npx --yes --package=ralph-research@latest ralph-research --version
```

`--yes` prevents npx from prompting and `@latest` forces a fresh fetch from
the registry.

## `rrx demo` / `rrx run`

### "Unsupported demo template ..."

`rrx demo` only accepts the templates listed in `SUPPORTED_DEMO_TEMPLATES`
(currently `writing` and `code`). The JSON error payload includes the
supported list:

```json
{ "ok": false, "error": "Unsupported demo template foo; supported templates: writing, code" }
```

Use `rrx demo writing`, `rrx demo code`, or `rrx init --template <name>` for
a non-bundled template you have copied into your project.

### "path X is outside allowed scope" on the first cycle

Your manifest's `scope.allowedGlobs` does not cover one of the files the
proposer or experiment touched. Two common pitfalls:

- A glob like `src/**/*.mjs` does **not** match `src/calculator.mjs` in the
  current matcher (the `**` requires at least one intermediate directory).
  Use `src/**` if you want to match flat files inside `src/`.
- The experiment writes outputs (for example `out/test-results.json`) into a
  directory not listed in `scope.allowedGlobs`. Add the output directory to
  the allowed list.

The bundled `code` template uses `src/**`, `tests/**`, `out/**` for exactly
this reason; check
[`templates/code/ralph.yaml`](../templates/code/ralph.yaml) for a working
shape.

### `rrx demo` runs but the cycle is rejected

Inspect the persisted decision first:

```bash
cat .ralph/runs/run-0001/decision.json | python3 -m json.tool
```

The common reject reasons are:

1. **Scope violation** — see the previous entry.
2. **Change budget** — `scope.maxFilesChanged` or `scope.maxLineDelta`
   exceeded.
3. **Frontier already better** — the candidate's metric did not improve on
   the incumbent. This is normal on the second and subsequent cycles of the
   bundled `writing` and `code` demos; the first cycle is the only one
   where the proposer makes a measurable change.

## Resume and recovery

### "Session X cannot resume safely: Codex lifecycle says ... but the process still appears alive"

The recovery classifier sees a lifecycle that says "exited" (signaled or
clean_exit) but `process.kill(pid, 0)` reports the PID is still live. This is
**intentional** — promoting a candidate while the previous process is still
running risks double-writing persisted state.

If you are in a test, inject a deterministic `isProcessAlive` via
`createRecoveryService`:

```ts
new ResearchSessionOrchestratorService({
  createRecoveryService: () =>
    new ResearchSessionRecoveryService({
      isProcessAlive: () => false, // or true, depending on what you exercise
    }),
});
```

See `tests/research-session-interactive-service.test.ts` for the canonical
example. The `v0.1.4` and `v0.1.5` CHANGELOG entries also explain the
Linux-CI flake that motivated this pattern.

### `rrx resume <sessionId>` refuses to resume

Only sessions that ended after a completed cycle checkpoint are resumable.
The runtime documents this contract in
[`docs/operation-model.md`](operation-model.md) and refuses to fake it.

If `rrx status --json` reports the session as `inspect_only` or
`non_recoverable`, the right next step is `rrx inspect <runId> --json` to
read the evidence, not to force resume. Forcing resume would be a documented
non-goal.

## CI and local builds

### Local tests pass but CI fails

Run the matrix yourself:

```bash
npm run typecheck && npm test && npm run build
```

If all three pass locally but CI fails on `ubuntu-latest` or
`macos-latest`, the most likely culprits are:

- Environment-dependent process checks (the `v0.1.4` Linux flake). Inject
  deterministic stubs as shown above.
- Filesystem case-sensitivity (macOS HFS+ is case-insensitive by default).
  Make sure your imports match the on-disk casing.
- Locale or timezone differences. The repo treats `Asia/Seoul` as the
  default for Dependabot, but the runtime itself reads `process.env.TZ`.

Open the CI run logs with `gh run view <id> --log-failed`. The first failing
test is usually the right place to start.

### `npm publish` says version already exists

You forgot to bump. Re-run the four-place version bump from
[`docs/release-process.md`](release-process.md) step 3 and commit before
publishing.

### `gh release create` errors with "release not found" for compare links

The CHANGELOG links to compare URLs that require the referenced tag to
exist. Cut the tag first (`gh release create vX.Y.Z`), then the compare
URL resolves. The CHANGELOG entry for unreleased work can use `HEAD`.

## Filing a good bug report

Include:

1. `rrx --version` output.
2. `node --version` output.
3. The exact `rrx` (or MCP) commands you ran.
4. The contents of `.ralph/runs/<runId>/run.json` and
   `.ralph/runs/<runId>/decision.json` for the run that misbehaved.
5. The full stderr from the failing command.

The runtime is designed to leave enough evidence behind to debug after the
fact; please include that evidence.
