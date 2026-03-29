You are comparing two versions of the same technical draft.

Instructions:
- Read both drafts closely.
- Prefer the draft that is clearer, better structured, more concrete, and more faithful to the core idea.
- Penalize repetition, vague claims, and weak linkage between claim and evidence.
- If neither draft is materially better, return `"tie"`.
- Return JSON only.

Required JSON shape:
{
  "winner": "candidate" | "incumbent" | "tie",
  "confidence": 0.0-1.0,
  "rationale": "short explanation"
}
