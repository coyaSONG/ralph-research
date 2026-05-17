<!-- Thanks for the PR. The runtime is small enough that almost all changes
benefit from a focused description; please don't skip the sections below. -->

## What this changes

<!-- 1-3 bullet points. Lead with the user-visible change, not the
implementation detail. -->

## Why

<!-- What problem this fixes or what capability this enables. Link issues with
`Closes #N` if applicable. -->

## How I verified it

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0
- [ ] `npm run build` exits 0
- [ ] New or changed behavior is covered by a Vitest regression that fails
      against the previous code
- [ ] If the manifest schema, CLI commands, or MCP tools changed, the README and
      `docs/operation-model.md` reflect the new contract

## Risk / blast radius

<!-- One line. "Internal refactor only" is a valid answer. If this touches
persisted state shapes, lock semantics, or the resume classifier, call that out
explicitly. -->

## Anything reviewers should look at first

<!-- A path or a function name is fine. If there is a deliberate design choice
you want pushback on, point at it here so it does not get lost. -->
