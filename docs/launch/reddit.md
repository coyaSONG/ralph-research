# Reddit — draft

## Subreddit shortlist (pick ONE per posting window)

| Subreddit | Best framing | Notes |
| --- | --- | --- |
| `r/programming` | "Bounded recursive research loop in TypeScript" | Strict self-promotion rules; lead with mechanism, not marketing |
| `r/LocalLLaMA` | "Local-first runtime for iterating on prompts/agents with persisted state" | Audience cares about resumability and no-API-key first run |
| `r/MachineLearning` | "Open-source ratchet engine for iterating writing artifacts under a trusted signal" | Must include reproducible example to avoid `[D]` rejection |
| `r/typescript` | "TypeScript CLI + MCP server with strict tsconfig (noUncheckedIndexedAccess, exactOptionalPropertyTypes)" | Tone toward the typing story |

Do not cross-post the same draft into two subreddits in the same hour. Reddit
spam filters will silently shadow you.

## Title

`ralph-research: a local-first runtime that only promotes verified
improvements (TypeScript, MIT)`

## Body

Hi all,

I've been working on a small runtime called
[`ralph-research`](https://github.com/coyaSONG/ralph-research) that runs a
bounded write-evaluate-accept loop over real artifacts on your own machine:

1. Load a `ralph.yaml` manifest.
2. Generate one candidate change via a proposer command.
3. Run an experiment command and extract a metric.
4. Compare against the current frontier with a ratchet engine.
5. Promote the candidate only if it actually wins on the trusted signal.

Everything — runs, decisions, frontier, lock metadata — is persisted under
`.ralph/`, so the loop is resumable and inspectable after a Ctrl-C or a crash.

What's in the box today:

- CLI binary `rrx` and a stdio MCP server that share the same service layer
- One bundled template (`writing`) that runs end-to-end without an API key
- Pairwise LLM judge path is optional, not required
- TypeScript 5.9 on Node 24, strict tsconfig (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`)
- 370+ Vitest specs, GitHub Actions CI green on every push

What I deliberately have **not** built:

- A no-config autonomous agent that does arbitrary tasks
- A hosted service
- A prompt-only protocol with hidden behavior — recovery semantics are written
  down in [`docs/operation-model.md`](https://github.com/coyaSONG/ralph-research/blob/main/docs/operation-model.md)

If you want to poke at it in 90 seconds:

```bash
npx ralph-research demo writing
# or, to see the test-pass ratchet on a tiny calculator:
npx ralph-research demo code
```

That creates a disposable Git repo, runs one accepted cycle, and prints the
temp path so you can `ls .ralph/runs` and read what actually happened.

I'd genuinely value:

- Critiques of the manifest schema (where does the API fight you?)
- Reports of resume edge cases on Linux/Windows/WSL
- Suggestions for the second bundled template after `writing`

License is MIT. PRs welcome — `CONTRIBUTING.md` covers the local dev loop.

## When to disengage

If the thread turns into "but does it support [hosted-service-feature]" — link
to `docs/comparison.md`, say "ralph-research is intentionally narrower than
that", and stop arguing.
