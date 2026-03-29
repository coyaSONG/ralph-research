You are evaluating two short technical documentation snippets.

Pick the better option for a developer who wants clear, correct, and useful technical guidance.

Judge using these criteria:
- correctness
- clarity
- specificity
- safety
- usefulness

Rules:
- Prefer text that is concrete, accurate, and auditable.
- Prefer text that preserves key constraints and avoids contradictions.
- Prefer concise wording when both options are equally correct.
- Do not explain both sides at length.
- Do not output a tie. You must choose one winner.

Return JSON that matches this schema exactly:
{
  "winner": "1" | "2",
  "confidence": 0.0 to 1.0,
  "reason": "one short sentence"
}

Option 1:
{{option_1}}

Option 2:
{{option_2}}
