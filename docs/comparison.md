# Comparison

This repo is narrower than a prompt-only "autonomous loop" package, but it is more truthful about the behavior it actually ships.

## What `ralph-research` Optimizes For

- A real CLI and stdio MCP server
- Manifest-driven execution
- Persisted run, decision, and frontier state
- Recovery semantics that can be inspected and resumed
- A bundled example path that works without hidden assumptions

## What Prompt-Only Loop Systems Usually Optimize For

- Broad command surface
- Aggressive packaging
- A large number of described workflows
- Strong onboarding language
- More ambitious claims than the runtime can always prove

## The Quality Difference That Matters

The main difference is not feature count. It is whether the runtime can tell the truth about its own state.

`ralph-research` is designed so that:

- a run can be resumed only when it is actually resumable
- a blocked manual review is surfaced as a block, not hidden
- accepted changes leave persisted evidence behind
- `status` and `inspect` read from stored runtime state instead of reconstructing the answer from prose

That makes the system smaller, but more reliable.

## Practical Takeaway

If you want a package that sounds broader, a prompt-only system may look stronger on first read.

If you want a local tool that keeps its contract aligned with reality, this repo is the more trustworthy base.

## Related Docs

- [README.md](../README.md)
- [playbook.md](playbook.md)
- [operation-model.md](operation-model.md)
- [examples.md](examples.md)
