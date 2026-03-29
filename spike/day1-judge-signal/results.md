# Day 1 Judge Signal Results

- Backend: `codex`
- Model: `gpt-5.4-mini`
- Repeats per pair: `5`
- Workers: `8`
- Total judgments: `50`
- Elapsed seconds: `77.06`
- Human label agreement: `100.00%`
- Pair majority agreement: `100.00%`
- Winner stability: `100.00%`
- Average confidence: `0.96`
- Overall status: `PASS`

## Pass Criteria

- Human label agreement >= 80%: `PASS`
- Winner stability >= 90%: `PASS`
- Elapsed <= 180s: `PASS`

## Per-Pair Summary

| Pair | Kind | Human | Votes A | Votes B | Majority | Majority Matches | Stability |
|---|---|---:|---:|---:|---:|---:|---:|
| `pair-01` | `improvement` | `B` | 0 | 5 | `B` | `yes` | `100.00%` |
| `pair-02` | `improvement` | `B` | 0 | 5 | `B` | `yes` | `100.00%` |
| `pair-03` | `improvement` | `B` | 0 | 5 | `B` | `yes` | `100.00%` |
| `pair-04` | `improvement` | `B` | 0 | 5 | `B` | `yes` | `100.00%` |
| `pair-05` | `improvement` | `B` | 0 | 5 | `B` | `yes` | `100.00%` |
| `pair-06` | `regression` | `A` | 5 | 0 | `A` | `yes` | `100.00%` |
| `pair-07` | `regression` | `A` | 5 | 0 | `A` | `yes` | `100.00%` |
| `pair-08` | `regression` | `A` | 5 | 0 | `A` | `yes` | `100.00%` |
| `pair-09` | `regression` | `A` | 5 | 0 | `A` | `yes` | `100.00%` |
| `pair-10` | `regression` | `A` | 5 | 0 | `A` | `yes` | `100.00%` |

## Example Judge Reasons

Note: `Option 1` and `Option 2` in the sampled reasons refer to the randomized presentation order used during each trial.

- `pair-01`: Option 2 is clearer and more specific about the loop, comparison, and audit trail.
- `pair-02`: Option 1 is more specific and auditable, because it states the comparison target and the acceptance rule for updating the frontier.
- `pair-03`: Option 2 is clearer, grammatical, and more specific about using metrics and a judge model.
- `pair-04`: Option 2 is concrete and auditable, while Option 1 is too vague to guide implementation.
- `pair-05`: Option 1 is more specific and auditable, while Option 2 is too vague to guide implementation.
- `pair-06`: It preserves the key acceptance constraint and avoids the incorrect claim that worse candidates update the frontier.
- `pair-07`: Option 2 is accurate and safe, while option 1 is incorrect and encourages skipping review.
- `pair-08`: Option 1 is clear, specific, and auditable, while Option 2 is vague and non-technical.
- `pair-09`: Option 2 is concrete and auditable, while Option 1 is vague and less useful.
- `pair-10`: It is clearer and avoids the contradictory implication that a rejected candidate can still become the best result.
