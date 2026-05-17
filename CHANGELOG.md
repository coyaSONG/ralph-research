# Changelog

All notable changes to `ralph-research` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `scripts/record-demo.sh` — reproducible terminal recording script that runs
  the bundled `code` demo end-to-end in roughly sixty seconds, with a Vitest
  regression pinning the script's executable bit, bash syntax, and required
  commands.
- `tests/readme-link-integrity.test.ts` walks every relative link in the
  README and CHANGELOG to catch link rot before it reaches the public site.
- `docs/troubleshooting.md` covers the common installation, scope, recovery,
  and CI failure modes that come up in practice.
- CI verify matrix now runs `npm audit --audit-level=high` before typecheck
  so a transitive `high`-or-higher CVE fails the build instead of slipping
  through to a release.

### Changed
- `tests/version-consistency.test.ts` also asserts the npm `keywords` array
  is unique, trimmed, and non-empty.

### Fixed
- `npm audit fix` cleared seven transitive vulnerabilities (the vite /
  postcss / ip-address chain through the dev toolchain). The new
  audit-level gate prevents a regression.
- Untracked the stale `spike/day3-cross-domain/runs/code/workspace/tests/__pycache__/test_calculator.cpython-312-pytest-9.0.2.pyc`
  bytecode file that survived the original `__pycache__` `.gitignore`
  addition.

## [0.1.6] - 2026-05-17

### Added
- README now embeds a Mermaid flowchart of the write-evaluate-accept loop so
  the mechanism is visible at a glance on GitHub renderings.
- CI verify matrix now runs on `ubuntu-latest` **and** `macos-latest` so
  platform-specific regressions land as PR failures instead of "works on my
  laptop" stories.
- `docs/quickstart.md` walks the absolute shortest path from `npx
  ralph-research demo writing` to inspecting the persisted decision evidence
  in five minutes.
- `docs/release-process.md` captures the maintainer release ritual (bump
  four version literals, promote `[Unreleased]`, commit, push, cut the
  GitHub release, then `npm publish`).
- Per-template READMEs under `templates/writing/README.md` and
  `templates/code/README.md` so users who `rrx init` see the intent of
  each materialized file.
- README "Support the Project" section with explicit, no-emoji asks for
  stars, issues, and PRs.
- `package.json` now declares `repository`, `bugs`, `homepage`, `engines`,
  `author`, and a wider `keywords` array. `tests/version-consistency.test.ts`
  pins those fields so future contributors cannot quietly drop them.
- `SUPPORTED_DEMO_TEMPLATES` is now an exported constant in
  `src/cli/commands/demo.ts`. The Commander `<template>` argument surfaces
  the supported names in `--help`, and a regression in `tests/init-demo.test.ts`
  fails if a new template forgets to update the help text.

### Changed
- `docs/comparison.md` rewritten with a concrete side-by-side table naming
  LangGraph, aider, and the prompt-only "ralph loop" pattern this project is
  named after — including honest "when to pick something else" guidance.
- `docs/launch/` drafts now use the published `npx ralph-research ...`
  invocation (the `github:coyaSONG/ralph-research` form was only correct
  before `v0.1.4` reached npm) and mention the `code` demo alongside the
  `writing` one.
- `docs/examples-catalog.md` documents the bundled `code` template as the
  primary code example while keeping the Python/uv fixture as an
  alternative shape.

### Fixed
- `package-lock.json` now reports `name: "ralph-research"` instead of the
  pre-rename `research-ratchet` placeholder. `tests/version-consistency.test.ts`
  pins the name and version against `package.json` to prevent the next
  rename from silently drifting.

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

[Unreleased]: https://github.com/coyaSONG/ralph-research/compare/v0.1.6...HEAD
[0.1.6]: https://github.com/coyaSONG/ralph-research/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/coyaSONG/ralph-research/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/coyaSONG/ralph-research/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/coyaSONG/ralph-research/releases/tag/v0.1.3
