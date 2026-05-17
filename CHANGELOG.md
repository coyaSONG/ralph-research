# Changelog

All notable changes to `ralph-research` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5] - 2026-05-17

### Added
- Second bundled template, `code`, demonstrating a test-pass ratchet on a tiny
  calculator module. `rrx demo code` now works end-to-end on a fresh checkout
  and runs one accepted cycle that promotes `tests_passed` from `0` to `4`.
- `tests/init-demo.test.ts` regressions covering `rrx demo code` (accepted run
  contract) and the explicit "unsupported demo template" error path.
- npm version badge on the README pointing at
  [`ralph-research` on npm](https://www.npmjs.com/package/ralph-research).
- Dependabot configuration (`.github/dependabot.yml`) running weekly
  npm and `github-actions` ecosystem checks with grouped TypeScript/Vitest/MCP
  updates so dependency drift surfaces as PRs instead of CI surprises.
- Issue, pull request, security policy, and contributing templates under
  `.github/` and the repo root, plus a `docs/launch/` set of ready-to-edit
  Show HN / Reddit / X drafts.

### Changed
- CI workflow now uses `actions/checkout@v6` and `actions/setup-node@v6`
  (Node 24 default), clearing the Node 20 deprecation warning that the first
  CI run annotated.
- `rrx demo` now accepts `writing` or `code` instead of only `writing` and
  emits the supported-template list in the JSON error payload when the
  argument is unrecognised.

### Fixed
- `tests/research-session-interactive-service.test.ts` resume-safety regression
  now injects a deterministic `isProcessAlive`, removing a Linux-CI-only
  failure where PID 42 happened to be a system process the runner user could
  not signal and was therefore (correctly) flagged as still alive.

## [0.1.4] - 2026-05-17

### Added
- GitHub Actions `verify` workflow (`.github/workflows/ci.yml`) running typecheck,
  tests, and build on every push and pull request to `main`.
- Vitest regression `tests/version-consistency.test.ts` that pins the CLI and MCP
  server version literals to `package.json`, preventing the version skew that
  previously slipped past `chore: release` commits.
- README status badges (CI, license, Node, TypeScript) so trust signals are visible
  before the first install.

### Fixed
- Run state locking and frontier read safety hardened in `b129c13` are now covered
  by an automated CI gate instead of relying on local-only verification.

## [0.1.3] - 2026-04-12

### Added
- Resume and termination semantics documented in `docs/operation-model.md` and
  surfaced in the README so callers can reason about which sessions are recoverable.
- Codex CLI research session orchestrator with persisted lifecycle, recovery, and
  single-cycle regression coverage.

### Fixed
- Cleanly exited research sessions now terminate without leaving the lock or run
  record in a state that blocks resume.
- `rrx resume` recovers across CLI process boundaries by reading durable state
  instead of in-memory caches.

### Changed
- README and operator playbook aligned with the current runtime contract: bundled
  `writing` template, three MCP tools, narrowed onboarding path, and trust signals
  for the local-first execution model.

## [0.1.2] and earlier

These versions predate the public CHANGELOG. See `git log` for the historical
record. Highlights:

- Parallel proposers and Pareto frontier (`feat: parallel proposers + Pareto frontier (v0.3)`).
- Graduated autonomy and compacted history for the proposer
  (`feat: graduated autonomy + compacted history for proposer`).
- The original `research-ratchet v0.1 MVP` that introduced metric-driven recursive
  improvement.

[Unreleased]: https://github.com/coyaSONG/ralph-research/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/coyaSONG/ralph-research/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/coyaSONG/ralph-research/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/coyaSONG/ralph-research/releases/tag/v0.1.3
