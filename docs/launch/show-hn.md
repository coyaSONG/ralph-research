# Show HN — draft

## Title (≤80 chars, one of these)

- `Show HN: ralph-research – bounded write-evaluate-accept loop for local research`
- `Show HN: A local-first recursive research runtime with resumable sessions`
- `Show HN: ralph-research – ratchet only verified improvements into your repo`

Pick the title that matches the post you're actually making. The first is the
clearest framing for HN — it names the mechanism in seven words.

## URL

`https://github.com/coyaSONG/ralph-research`

## Body (post into the first comment, not the submission text)

Hey HN,

I built `ralph-research` because I wanted a recursive-improvement loop I could
actually trust on my own laptop. Most "AI agent" frameworks I tried either
locked me into a hosted service, replayed a prompt over an opaque chat history,
or quietly forgot what they had already accepted when the process restarted.

`ralph-research` is small and deliberately narrow:

- a CLI binary (`rrx`) and a stdio MCP server that share the same service layer
- a bounded write-evaluate-accept loop driven by a `ralph.yaml` manifest
- persisted run, decision, and frontier state under `.ralph/` so you can resume,
  inspect, and audit the loop after a crash or a Ctrl-C
- a ratchet engine that promotes a candidate only after it beats the current
  frontier on a trusted signal (a local metric script or a pairwise judge)

The bundled `writing` template runs end-to-end without an API key — it ships a
local heuristic metric so the first cycle works as soon as you `npm install`.
The runtime is broader than the bundled template (you can plug in any
proposer/experiment/metric commands), but I'm holding the onboarding path
narrow until the wider surface is equally reliable.

Verifiable trust signals on the repo:

- GitHub Actions CI runs `typecheck + test + build` on every push
- 370+ Vitest specs, including persistence/recovery regressions and a
  cross-platform resume-safety pin that just landed
- `CHANGELOG.md` and tagged releases — current latest is `v0.1.4`

I'd love feedback on:

1. Where the manifest schema makes hard things harder. The runtime's job is to
   stay out of the way; surfaces that fight you are bugs.
2. Recovery semantics. The current contract is documented in
   `docs/operation-model.md`; if something there reads as a footgun, please
   tell me before someone hits it for real.
3. What you'd want the second bundled template to be after `writing`. I have
   opinions, but I'd rather start from yours.

License is MIT. Code is TypeScript on Node 24. Repo:
https://github.com/coyaSONG/ralph-research

## Top-comment seed (post after the submission lands)

A short note about what `ralph-research` is **not**, to head off the usual
expectations:

- not a hosted service and not headed there
- not a no-config autonomous agent for arbitrary domains
- not a prompt-only protocol — every behavior is grounded in persisted run
  state you can grep

If you only have 90 seconds, run `npx github:coyaSONG/ralph-research demo writing`
in a scratch directory and look at `.ralph/runs/` afterward.

## Where NOT to post this

- `Ask HN` — this is a `Show HN`, not a request for advice
- `r/programming` — different audience, post the `reddit.md` draft instead
- product marketing newsletters or Twitter giveaway threads
