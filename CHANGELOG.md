# Changelog

All notable changes to `ralph-research` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/coyaSONG/ralph-research/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/coyaSONG/ralph-research/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/coyaSONG/ralph-research/releases/tag/v0.1.3
