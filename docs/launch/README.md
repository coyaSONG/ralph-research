# Launch artifacts

Ready-to-post drafts for the people who actually move the needle. Edit before
posting — these are written to be honest about what `ralph-research` is and is
not, so don't oversell.

- `show-hn.md` — Hacker News (Show HN) post draft
- `reddit.md` — `r/programming` (or `r/LocalLLaMA`/`r/MachineLearning`) draft
- `x-thread.md` — 5-tweet thread draft

## Operator checklist before posting

1. Confirm the CI badge on the README is green for the latest `main`.
2. Confirm the most recent `gh release view` matches the version in
   `package.json`.
3. If you publish to npm, replace the `npx github:coyaSONG/ralph-research`
   stanzas with the `npx ralph-research ...` form.
4. Pick one target audience per slot; do not cross-post the same draft to
   multiple subreddits in the same hour.
5. Be present in the comments for the first 90 minutes — that's where stars come
   from, not the headline.

## What these drafts deliberately avoid

- No "AI agent that does everything" framing. The runtime is bounded and
  manifest-driven. Calling it an autonomous agent invites the wrong crowd and
  the wrong feedback.
- No fake benchmarks. The only numbers in the drafts come from `npm test`,
  shipped CHANGELOG entries, and the bundled `writing` template.
- No comparison to specific competitors by name without linking
  `docs/comparison.md` so readers can verify.
