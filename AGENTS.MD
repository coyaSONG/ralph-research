# AGENTS.MD

## Workflow
- Keep changes small and reviewable.
- Before editing, check `git status --short` for unexpected work in progress.
- Do not revert or overwrite user changes unless explicitly asked.

## Git
- If the user says `commit`, use `./scripts/committer`, not `git commit` directly.
- Pass an explicit commit message first, then list only the files that belong in that commit.
- Never pass `.` to `./scripts/committer`.
- Prefer atomic commits scoped to the edited paths.

## Commands
- Repo-local commit helper: `./scripts/committer`
