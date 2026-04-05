# Phase 1: Contract Truth & Run Admission - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase makes the manifest/runtime contract truthful before any destructive run starts. The scope is limited to preflight admission and supported-surface clarity: reject unsupported proposer, workspace, and baseline combinations early; make supported fields behave exactly as documented; and expose a stable validation/admission surface through the existing CLI/runtime entrypoints.

</domain>

<decisions>
## Implementation Decisions

### Contract enforcement model
- **D-01:** Phase 1 should not implement currently unsupported manifest surface just to preserve schema breadth. Unsupported fields and combinations should be rejected explicitly at admission time.
- **D-02:** Contract truth takes priority over apparent feature breadth. If a manifest field cannot be honored truthfully in the current runtime, the runtime should narrow support instead of pretending it exists.

### Compatibility policy
- **D-03:** Admission behavior should be fail-fast with explicit errors, not silent fallback. Unsupported `proposer`, `workspace`, or `baselineRef` cases must stop before repo mutation starts.
- **D-04:** Brownfield compatibility should be preserved through clear diagnostics and stable command behavior, not through implicit fallback paths that hide unsupported behavior.

### Admission gate surface
- **D-05:** `validate`, `doctor`, and `run` should share the same capability/admission checks so the same manifest is judged consistently across preflight and execution.
- **D-06:** Phase 1 should focus on a stable preflight surface rather than adding new transport/UI surface. The existing CLI and MCP shape stays in place.

### the agent's Discretion
- The exact internal shape of the shared admission/capability-check abstraction
- Whether unsupported surface is rejected through schema refinement, compiled capability checks, or a two-stage validation pipeline, as long as the user-facing behavior remains truthful and fail-fast
- The exact wording and structure of diagnostic output, as long as it is explicit enough for the primary user to act on immediately

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/PROJECT.md` — Project intent, constraints, and the principle that misleading contract surface is worse than narrower honest support
- `.planning/REQUIREMENTS.md` — Phase 1 requirements `CONT-01`, `CONT-02`, and `CONT-03`
- `.planning/ROADMAP.md` — Phase 1 goal and success criteria for contract truth and run admission
- `.planning/STATE.md` — Current milestone position and known later-phase blockers that should stay out of Phase 1 scope

### Research inputs
- `.planning/research/SUMMARY.md` — Phase ordering rationale, fail-fast contract guidance, and recommendation to establish truthful runtime foundations before recovery and review work
- `.planning/codebase/CONCERNS.md` — Current evidence for manifest/runtime drift and why unsupported surface is a trust problem
- `.planning/codebase/ARCHITECTURE.md` — Current service and engine boundaries that admission checks must integrate with

### Runtime contract code
- `src/core/manifest/schema.ts` — Current manifest surface, including `baselineRef`, `workspace`, and `operator_llm`
- `src/adapters/fs/manifest-loader.ts` — Manifest loading boundary
- `src/cli/commands/validate.ts` — Current validation entrypoint, currently syntax/schema-focused rather than capability-truthful
- `src/cli/main.ts` — Current `doctor` command surface
- `src/cli/commands/run.ts` — Runtime entrypoint that should share the same admission logic
- `src/app/services/run-cycle-service.ts` — Service-level run admission boundary
- `src/core/engine/workspace-manager.ts` — Current Git worktree behavior that ignores `workspace: copy` and always uses `HEAD`
- `src/core/engine/cycle-runner.ts` — Current runtime assumptions around `baselineRef` and proposer handling

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `RalphManifestSchema` in `src/core/manifest/schema.ts`: existing schema and `superRefine` pattern for cross-field manifest validation
- `loadManifestFromFile()` in `src/adapters/fs/manifest-loader.ts`: current manifest loading boundary where early contract checks can plug in
- `runValidateCommand()` in `src/cli/commands/validate.ts`: existing preflight CLI surface that can be expanded from “shape valid” to “shape + capability truthful”
- `RunCycleService` in `src/app/services/run-cycle-service.ts`: current execution admission boundary before a cycle starts

### Established Patterns
- Boundary validation is already concentrated in Zod schemas plus manifest loader rather than spread across CLI commands
- CLI commands use thin wrappers with `CommandIO` and `Promise<number>` return patterns; new admission behavior should preserve that style
- Runtime orchestration is layered: CLI/MCP -> app services -> engine/adapters. Shared admission logic should live below transport, not be reimplemented per command

### Integration Points
- `validate` should expose the truthful contract before execution
- `doctor` should become a real capability/admission preflight instead of a scaffold-only log surface
- `run` and `RunCycleService` should call the same admission checks before lock/workspace/repo mutation begins
- Manifest/runtime support decisions will likely affect `schema.ts`, `manifest-loader.ts`, `run-cycle-service.ts`, and the workspace/proposer paths referenced by those checks

</code_context>

<specifics>
## Specific Ideas

- The primary user is the repository owner, so diagnostics should optimize for immediate action rather than generic end-user friendliness
- “Truthful contract” means no silent fallback and no accepting manifests that cannot be honored by the runtime as implemented
- Phase 1 should prefer narrowing the promise over widening implementation scope

</specifics>

<deferred>
## Deferred Ideas

- Existing JSON runtime history migration strategy — belongs to later control-plane/recovery work, not this admission-focused phase
- Durable promotion evidence format such as persisted patches vs changed-path manifests — belongs to promotion durability planning
- Broader workspace backend expansion beyond the current Git-first model — out of scope for Phase 1

</deferred>

---

*Phase: 01-contract-truth-run-admission*
*Context gathered: 2026-04-05*
