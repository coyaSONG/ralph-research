#!/usr/bin/env python3
import concurrent.futures
import difflib
import json
import random
import statistics
import subprocess
import tempfile
import time
from pathlib import Path


GENERATION_SCHEMA = {
    "type": "object",
    "properties": {
        "candidate_text": {"type": "string"},
        "summary": {"type": "string"},
    },
    "required": ["candidate_text", "summary"],
    "additionalProperties": False,
}

JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "winner": {"type": "string", "enum": ["1", "2"]},
        "confidence": {"type": "number"},
        "reason": {"type": "string"},
    },
    "required": ["winner", "confidence", "reason"],
    "additionalProperties": False,
}

OPERATORS = [
    ("candidate-01", "restructure_outline", "Front-load the purpose, then the comparison rule, then the audit trail."),
    ("candidate-02", "restructure_outline", "Split the loop into two short lines so the flow is easier to scan."),
    ("candidate-03", "restructure_outline", "Reorder the draft to emphasize baseline comparison before acceptance."),
    ("candidate-04", "restructure_outline", "Make the draft read like a tiny three-step process."),
    ("candidate-05", "compress_redundancy", "Tighten wording and remove repeated concepts without losing meaning."),
    ("candidate-06", "compress_redundancy", "Shorten the prose and keep only the strongest technical terms."),
    ("candidate-07", "compress_redundancy", "Reduce filler and keep the same claims in fewer words."),
    ("candidate-08", "strengthen_claim_evidence", "Make the acceptance rule more explicit and auditable."),
    ("candidate-09", "strengthen_claim_evidence", "Clarify why storing decision reasons matters."),
    ("candidate-10", "strengthen_claim_evidence", "Strengthen the compare-against-current-best claim."),
]


def call_codex_json(prompt, model, schema_path, output_path, cwd, timeout=120):
    cmd = [
        "codex",
        "exec",
        "--skip-git-repo-check",
        "-C",
        str(cwd),
        "-m",
        model,
        "--output-schema",
        str(schema_path),
        "-o",
        str(output_path),
        prompt,
    ]
    completed = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if completed.returncode != 0:
        raise RuntimeError(f"codex failed: {completed.stderr or completed.stdout}")
    return json.loads(output_path.read_text())


def changed_line_count(before_text, after_text):
    diff = difflib.unified_diff(
        before_text.splitlines(),
        after_text.splitlines(),
        fromfile="before",
        tofile="after",
        lineterm="",
    )
    count = 0
    for line in diff:
        if line.startswith(("---", "+++")):
            continue
        if line.startswith(("+", "-")):
            count += 1
    return count


def render_generation_prompt(baseline_text, operator_name, variation):
    return f"""You are editing a short technical documentation draft.

Apply exactly one bounded operator to the baseline:
- operator: {operator_name}
- variation: {variation}

Constraints:
- Preserve the core meaning of the baseline.
- Do not introduce new product claims, features, or APIs.
- Keep the result as plain markdown with at most 4 lines.
- Keep the edit small and controlled.
- The resulting patch should stay within a 10-line diff budget.

Return only structured output with:
- candidate_text: the revised markdown
- summary: one short sentence explaining what changed

Baseline:
{baseline_text}
"""


def render_judge_prompt(template, option_1, option_2):
    return template.replace("{{option_1}}", option_1).replace("{{option_2}}", option_2)


def generate_candidate(task, baseline_text, model, schema_path, cwd, candidates_dir):
    candidate_id, operator_name, variation = task
    prompt = render_generation_prompt(baseline_text, operator_name, variation)
    output_path = candidates_dir / f"{candidate_id}.json"
    payload = call_codex_json(prompt, model, schema_path, output_path, cwd)
    candidate_text = payload["candidate_text"].strip() + "\n"
    summary = payload["summary"].strip()
    candidate_path = candidates_dir / f"{candidate_id}.md"
    candidate_path.write_text(candidate_text)
    diff_lines = changed_line_count(baseline_text, candidate_text)
    return {
        "candidate_id": candidate_id,
        "operator": operator_name,
        "variation": variation,
        "candidate_path": str(candidate_path),
        "candidate_text": candidate_text,
        "summary": summary,
        "diff_lines": diff_lines,
        "within_budget": diff_lines <= 10,
    }


def judge_candidate(task, baseline_text, candidate_text, judge_prompt_template, model, schema_path, cwd):
    rng = random.Random(1000 + task["task_index"])
    flipped = rng.choice([False, True])
    option_1 = candidate_text if flipped else baseline_text
    option_2 = baseline_text if flipped else candidate_text
    prompt = render_judge_prompt(judge_prompt_template, option_1, option_2)
    output_path = cwd / ".judge-tmp" / f"{task['candidate_id']}-r{task['repeat']}.json"
    payload = call_codex_json(prompt, model, schema_path, output_path, cwd)
    winner_map = {"1": ("candidate" if flipped else "baseline"), "2": ("baseline" if flipped else "candidate")}
    return {
        "candidate_id": task["candidate_id"],
        "repeat": task["repeat"],
        "winner": winner_map[payload["winner"]],
        "confidence": float(payload["confidence"]),
        "reason": payload["reason"].strip(),
    }


def summarize(candidates, judgments, elapsed_sec):
    by_candidate = {candidate["candidate_id"]: [] for candidate in candidates}
    for judgment in judgments:
        by_candidate[judgment["candidate_id"]].append(judgment)

    rows = []
    accepted_count = 0
    accepted_within_budget = True
    rationale_explains = True

    for candidate in candidates:
        rows_for_candidate = by_candidate[candidate["candidate_id"]]
        wins_candidate = sum(1 for row in rows_for_candidate if row["winner"] == "candidate")
        wins_baseline = sum(1 for row in rows_for_candidate if row["winner"] == "baseline")
        stability = max(wins_candidate, wins_baseline) / len(rows_for_candidate)
        majority_winner = "candidate" if wins_candidate > wins_baseline else "baseline"
        sample_reason = rows_for_candidate[0]["reason"]
        accepted = majority_winner == "candidate" and stability >= 0.90 and candidate["within_budget"]
        if accepted:
            accepted_count += 1
            accepted_within_budget = accepted_within_budget and candidate["within_budget"]
        rationale_explains = rationale_explains and len(sample_reason.split()) >= 4
        rows.append(
            {
                "candidate_id": candidate["candidate_id"],
                "operator": candidate["operator"],
                "summary": candidate["summary"],
                "diff_lines": candidate["diff_lines"],
                "within_budget": candidate["within_budget"],
                "wins_candidate": wins_candidate,
                "wins_baseline": wins_baseline,
                "stability": stability,
                "majority_winner": majority_winner,
                "accepted": accepted,
                "sample_reason": sample_reason,
            }
        )

    avg_confidence = statistics.mean(row["confidence"] for row in judgments)
    rows.sort(key=lambda row: row["candidate_id"])
    return {
        "elapsed_sec": elapsed_sec,
        "accepted_count": accepted_count,
        "accepted_within_budget": accepted_within_budget,
        "rationale_explains": rationale_explains,
        "avg_confidence": avg_confidence,
        "rows": rows,
        "pass_accepted_count": accepted_count >= 2,
        "pass_scope_budget": accepted_within_budget,
        "pass_rationale": rationale_explains,
    }


def write_results(results_path, baseline_path, summary):
    overall = "PASS" if (
        summary["pass_accepted_count"]
        and summary["pass_scope_budget"]
        and summary["pass_rationale"]
    ) else "FAIL"
    lines = [
        "# Day 2 Bounded Patch Results",
        "",
        f"- Baseline: `{baseline_path}`",
        f"- Elapsed seconds: `{summary['elapsed_sec']:.2f}`",
        f"- Accepted candidates: `{summary['accepted_count']}`",
        f"- Average judge confidence: `{summary['avg_confidence']:.2f}`",
        f"- Overall status: `{overall}`",
        "",
        "## Pass Criteria",
        "",
        f"- At least 2 accepted candidates: `{'PASS' if summary['pass_accepted_count'] else 'FAIL'}`",
        f"- All accepted candidates within scope budget: `{'PASS' if summary['pass_scope_budget'] else 'FAIL'}`",
        f"- Judge rationale explains actual improvement points: `{'PASS' if summary['pass_rationale'] else 'FAIL'}`",
        "",
        "## Candidate Summary",
        "",
        "| Candidate | Operator | Diff lines | Budget OK | Candidate Wins | Baseline Wins | Stability | Majority | Accepted |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ]

    for row in summary["rows"]:
        lines.append(
            f"| `{row['candidate_id']}` | `{row['operator']}` | {row['diff_lines']} | `{'yes' if row['within_budget'] else 'no'}` | {row['wins_candidate']} | {row['wins_baseline']} | `{row['stability']:.2%}` | `{row['majority_winner']}` | `{'yes' if row['accepted'] else 'no'}` |"
        )

    lines.extend(["", "## Candidate Notes", ""])
    for row in summary["rows"]:
        lines.append(f"- `{row['candidate_id']}` ({row['operator']}): {row['summary']}")

    lines.extend(["", "## Example Judge Rationales", ""])
    lines.append("")
    lines.append("Note: `Option 1` and `Option 2` in the sampled rationales refer to the randomized presentation order used during each trial.")
    lines.append("")
    for row in summary["rows"]:
        lines.append(f"- `{row['candidate_id']}`: {row['sample_reason']}")

    results_path.write_text("\n".join(lines) + "\n")


def main():
    root = Path(__file__).resolve().parent
    baseline_path = root.parent / "day1-judge-signal" / "sample_draft.md"
    judge_prompt_path = root.parent / "day1-judge-signal" / "judge_prompt.md"
    results_path = root / "results.md"
    candidates_dir = root / "candidates"
    temp_dir = root / ".judge-tmp"
    candidates_dir.mkdir(parents=True, exist_ok=True)
    temp_dir.mkdir(parents=True, exist_ok=True)

    baseline_text = baseline_path.read_text().strip() + "\n"
    judge_prompt_template = judge_prompt_path.read_text()
    model = "gpt-5.4-mini"

    start = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="bounded-patch-") as tmp_dir:
        generation_schema_path = Path(tmp_dir) / "generation_schema.json"
        generation_schema_path.write_text(json.dumps(GENERATION_SCHEMA))
        judge_schema_path = Path(tmp_dir) / "judge_schema.json"
        judge_schema_path.write_text(json.dumps(JUDGE_SCHEMA))

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            generation_futures = [
                executor.submit(
                    generate_candidate,
                    task,
                    baseline_text,
                    model,
                    generation_schema_path,
                    root,
                    candidates_dir,
                )
                for task in OPERATORS
            ]
            candidates = [future.result() for future in concurrent.futures.as_completed(generation_futures)]

        judge_tasks = []
        task_index = 0
        for candidate in candidates:
            for repeat in range(1, 6):
                task_index += 1
                judge_tasks.append(
                    {
                        "candidate_id": candidate["candidate_id"],
                        "candidate_text": candidate["candidate_text"],
                        "repeat": repeat,
                        "task_index": task_index,
                    }
                )

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            judge_futures = [
                executor.submit(
                    judge_candidate,
                    task,
                    baseline_text,
                    task["candidate_text"],
                    judge_prompt_template,
                    model,
                    judge_schema_path,
                    root,
                )
                for task in judge_tasks
            ]
            judgments = [future.result() for future in concurrent.futures.as_completed(judge_futures)]

    elapsed_sec = time.perf_counter() - start
    summary = summarize(candidates, judgments, elapsed_sec)
    write_results(results_path, baseline_path, summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
