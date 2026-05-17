# X (Twitter) thread — draft

Five tweets, each ≤280 characters. Numbers in brackets are character counts at
the time of writing; re-check after any edits because Unicode + URLs change the
math.

## Tweet 1 — hook [263]

> Spent the spring shipping `ralph-research`: a local-first runtime that runs a
> bounded write-evaluate-accept loop over real artifacts and only promotes
> verified improvements into your repo.
>
> CLI + stdio MCP server. TypeScript. MIT.
>
> https://github.com/coyaSONG/ralph-research

## Tweet 2 — mechanism [251]

> The loop:
> 1. Load a `ralph.yaml` manifest.
> 2. Generate one candidate change.
> 3. Run an experiment, extract a metric.
> 4. Compare against the current frontier via a ratchet engine.
> 5. Promote only if it beats the trusted signal.
>
> Everything persists under `.ralph/`.

## Tweet 3 — trust [240]

> Why bother with a tiny runtime instead of just looping a chat agent?
>
> - resumable across crashes and process boundaries
> - inspectable run/decision/frontier records
> - GitHub Actions CI on every push
> - 370+ Vitest regressions, including a Linux-only resume-safety pin

## Tweet 4 — start [223]

> 90-second test:
>
> `npx github:coyaSONG/ralph-research demo writing`
>
> Creates a disposable Git repo, runs one accepted cycle, prints the path.
> Then `ls .ralph/runs` to see exactly what got accepted and why. No API key
> required for the bundled template.

## Tweet 5 — ask [222]

> What I'd love feedback on:
>
> - manifest schema friction
> - resume edge cases on Linux/WSL
> - the second bundled template after `writing`
>
> If you ship something on top of it, link me — I want to find the rough edges
> before the next release goes out.

## Posting notes

- Post all five as a thread, not five separate tweets.
- Attach a 5-second terminal capture of `rrx demo writing` to tweet 4 if you
  have one ready. A still screenshot of the README badges works for tweet 1.
- Tag at most one relevant account (e.g., a maintainer whose framework
  `ralph-research` compares with). Tagging more than one reads as spam.
- Quote-tweet the v0.1.4 GitHub release a few hours later to give the thread a
  second push without a second cold-start tweet.
