# Contributing to ralph-research

Thanks for the interest. The runtime is intentionally small; please read this
short guide before opening a non-trivial PR.

## Ground rules

- The runtime is bounded by the shipped CLI, MCP, and manifest contract. Changes
  that widen that contract need a "why this can't live in user-land" answer.
- Every behavior change must be backed by a Vitest regression that fails against
  the previous code. "Works once on my laptop" is not enough — see
  [`AGENTS.MD`](AGENTS.MD) for the project's own working agreement.
- Commits are made through [`./scripts/committer`](scripts/committer). It is
  a thin helper that stages explicit paths and refuses to commit with an empty
  message, the literal `.` path, or against a missing file.
- Do not bypass commit hooks (`--no-verify`), do not amend pushed commits, and
  do not force-push `main`.

## Local development loop

```bash
git clone https://github.com/coyaSONG/ralph-research.git
cd ralph-research
npm install
npm run typecheck
npm test
npm run build
```

The smoke test:

```bash
npm run dev -- demo writing
```

That runs the CLI from source, materializes the `writing` template into a
disposable Git repo, runs one cycle, and prints the temp path. Inspecting
`.ralph/` in that temp path is the fastest way to understand what the runtime
actually persists.

## What lives where

- `src/cli/` — Commander commands. One file per command.
- `src/mcp/` — Stdio MCP server. Reuses the application services from `src/app/`.
- `src/app/services/` — Per-request orchestration. Wires up adapters, acquires
  locks, classifies recovery.
- `src/core/` — Pure logic and Zod schemas. No IO.
- `src/adapters/` — Filesystem, Git, and process boundaries.
- `tests/` — Vitest specs, one per service or command.

See [`docs/operation-model.md`](docs/operation-model.md) for the lifecycle the
core engines enforce.

## Filing issues

Use the templates under `.github/ISSUE_TEMPLATE/`. Bug reports without a
reproduction will be closed; we do not have the bandwidth to guess from a
description alone.

## Pull request expectations

The PR template asks for the four things every change needs:

1. What changes (user-visible, not implementation).
2. Why.
3. How you verified it (typecheck + test + build, plus a regression).
4. The risk / blast radius.

Small, single-purpose PRs land quickly. Large refactors that touch multiple
layers will be asked to split.

## Security disclosure

See [`SECURITY.md`](SECURITY.md). Do not file public issues for vulnerabilities.

## License

By contributing you agree your code is licensed under the
[MIT License](LICENSE).
