# Release process

The runtime is small enough to release by hand and the release surface area
matters enough that we should not automate it before we have automated tests
covering the release surface itself. This document is the maintainer
checklist.

Time budget: under 10 minutes per release.

## Before you start

- You are on `main` with `git status` clean.
- Local `npm run typecheck`, `npm test`, and `npm run build` all exit 0.
- The latest CI run on `main` is green for both `ubuntu-latest` and
  `macos-latest`.
- You are logged into npm as the package owner (`npm whoami` returns
  the right account).
- You have a draft of the user-visible changes ready to paste into both
  `CHANGELOG.md` and the GitHub release notes.

If any of those is false, fix it first; do not "release through it."

## 1. Decide the version bump

- **Patch** (`0.1.5 → 0.1.6`) — bug fixes, internal hardening, docs.
- **Minor** (`0.1.x → 0.2.0`) — new CLI commands, new MCP tools, new
  manifest fields, new bundled templates. Anything that widens the public
  surface non-breakingly.
- **Major** (`0.x → 1.0` and beyond) — any breaking change to CLI command
  names, MCP tool names, or the manifest schema. See the Non-Goals list
  in [`AGENTS.MD`](../AGENTS.MD) before reaching for this.

When in doubt, bump the smaller version and write a tighter changelog entry.

## 2. Promote `[Unreleased]` in the CHANGELOG

```markdown
## [Unreleased]

## [0.X.Y] - YYYY-MM-DD

### Added / Changed / Fixed
- ...
```

Also append the corresponding compare link at the bottom of the file.

## 3. Bump the version string in four places

```bash
npm version <patch|minor|major> --no-git-tag-version
```

Then update the two hardcoded literals — the `version-consistency` regression
will fail until both match:

- `src/cli/program.ts` → `.version("0.X.Y")`
- `src/mcp/server.ts` → `version: "0.X.Y"`

Confirm the four files agree:

```bash
grep -RIn '"version":\s*"' package.json package-lock.json
grep -n '0\.[0-9]\+\.[0-9]\+' src/cli/program.ts src/mcp/server.ts
npx vitest run tests/version-consistency.test.ts
```

## 4. Re-run the local checkpoints

```bash
npm run typecheck && npm test && npm run build
```

All three must exit 0. Otherwise stop, fix, and start step 4 over.

## 5. Commit and push through `./scripts/committer`

```bash
./scripts/committer "chore: release 0.X.Y" \
  CHANGELOG.md package.json package-lock.json \
  src/cli/program.ts src/mcp/server.ts
git push origin main
```

Wait for the CI run on the release commit to go green before continuing.
If CI is red, the released tag will point at a known-broken state — fix it
first and bump again.

## 6. Cut the GitHub release

```bash
gh release create v0.X.Y --title "v0.X.Y" --notes "$(cat <<'EOF'
... user-visible summary ...
See [CHANGELOG.md](https://github.com/coyaSONG/ralph-research/blob/main/CHANGELOG.md) for the full history.
EOF
)"
```

## 7. Publish to npm

```bash
npm pack --dry-run        # eyeball the file list
npm publish               # registers the new latest
npm view ralph-research version  # verify the registry caught up
```

If `npm publish` prompts for 2FA, complete it — do not pipe the OTP from a
flag, do not disable the prompt.

## 8. Smoke test the published artifact

In any scratch directory:

```bash
npx ralph-research --version           # should print 0.X.Y
npx ralph-research demo writing
npx ralph-research demo code
```

If either demo fails on a clean machine, the release is broken; cut a patch
bump immediately and document the regression in the CHANGELOG.

## 9. Tell the world (optional, only when there is something to say)

- For substantive releases, edit `docs/launch/show-hn.md`,
  `docs/launch/reddit.md`, or `docs/launch/x-thread.md` to mention the new
  version and post one of them.
- For routine patches, the CHANGELOG and the GitHub release are enough.

## What to do when something goes wrong

- **Forgot to bump a version literal.** `version-consistency` will fail in
  CI. Bump locally, commit a follow-up patch, do not amend the published
  release tag.
- **Published a broken npm version.** Cut a patch bump that reverts or
  fixes the regression and publish that. Do not `npm unpublish` once the
  72-hour window has passed.
- **Pushed a CI-red release commit.** Fix in a follow-up commit. Update the
  GitHub release notes if the tag was already cut to call out that the next
  patch is preferred.

If you need to escape the release entirely (security-sensitive content, for
example), the documented escape hatch is `npm deprecate ralph-research@<ver>
"reason"` plus a follow-up patch with the fix. Do not delete the tag.
