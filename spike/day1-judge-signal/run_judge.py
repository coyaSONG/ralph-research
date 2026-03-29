#!/usr/bin/env python3
import argparse
import concurrent.futures
import json
import random
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path


SCHEMA = {
    "type": "object",
    "properties": {
        "winner": {"type": "string", "enum": ["1", "2"]},
        "confidence": {"type": "number"},
        "reason": {"type": "string"},
    },
    "required": ["winner", "confidence", "reason"],
    "additionalProperties": False,
}


def parse_args():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Run a pairwise LLM judge over anchor pairs.")
    parser.add_argument("--anchors", type=Path, default=here / "anchors.jsonl")
    parser.add_argument("--prompt", type=Path, default=here / "judge_prompt.md")
    parser.add_argument("--results", type=Path, default=here / "results.md")
    parser.add_argument("--backend", choices=["codex", "claude"], default="codex")
    parser.add_argument("--model", default="gpt-5.4-mini")
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def load_anchors(path):
    anchors = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                anchors.append(json.loads(line))
    return anchors


def render_prompt(template, option_1, option_2):
    return template.replace("{{option_1}}", option_1).replace("{{option_2}}", option_2)


def call_codex(prompt, model, schema_path, output_path, cwd, timeout):
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


def call_claude(prompt, model, schema_json, timeout):
    cmd = [
        "claude",
        "-p",
        "--model",
        model,
        "--output-format",
        "json",
        "--json-schema",
        schema_json,
        prompt,
    ]
    completed = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if completed.returncode != 0:
        raise RuntimeError(f"claude failed: {completed.stderr or completed.stdout}")
    payload = json.loads(completed.stdout)
    if "structured_output" not in payload:
        raise RuntimeError(f"claude output missing structured_output: {completed.stdout}")
    return payload["structured_output"]


def judge_once(task, prompt_template, args, schema_path, cwd):
    rng = random.Random(args.seed + task["task_index"])
    flipped = rng.choice([False, True])
    option_1 = task["anchor"]["option_b"] if flipped else task["anchor"]["option_a"]
    option_2 = task["anchor"]["option_a"] if flipped else task["anchor"]["option_b"]
    prompt = render_prompt(prompt_template, option_1, option_2)

    if args.backend == "codex":
        output_path = schema_path.parent / f"{task['anchor']['id']}-r{task['repeat']}.json"
        response = call_codex(prompt, args.model, schema_path, output_path, cwd, args.timeout)
    else:
        response = call_claude(prompt, args.model, json.dumps(SCHEMA), args.timeout)

    winner_map = {"1": ("B" if flipped else "A"), "2": ("A" if flipped else "B")}
    canonical_winner = winner_map[response["winner"]]
    return {
        "anchor_id": task["anchor"]["id"],
        "repeat": task["repeat"],
        "human_winner": task["anchor"]["human_winner"],
        "predicted_winner": canonical_winner,
        "correct": canonical_winner == task["anchor"]["human_winner"],
        "confidence": float(response["confidence"]),
        "reason": response["reason"].strip(),
        "flipped": flipped,
        "kind": task["anchor"]["kind"],
    }


def build_tasks(anchors, repeats):
    tasks = []
    task_index = 0
    for anchor in anchors:
        for repeat in range(1, repeats + 1):
            task_index += 1
            tasks.append({"anchor": anchor, "repeat": repeat, "task_index": task_index})
    return tasks


def summarize(anchors, judgments, elapsed_sec):
    by_anchor = {anchor["id"]: [] for anchor in anchors}
    for judgment in judgments:
        by_anchor[judgment["anchor_id"]].append(judgment)

    pair_rows = []
    stability_scores = []
    pair_majority_matches = 0
    for anchor in anchors:
        rows = by_anchor[anchor["id"]]
        counts = {"A": 0, "B": 0}
        for row in rows:
            counts[row["predicted_winner"]] += 1
        majority_winner = "A" if counts["A"] >= counts["B"] else "B"
        stability = max(counts.values()) / len(rows)
        stability_scores.append(stability)
        majority_matches = majority_winner == anchor["human_winner"]
        if majority_matches:
            pair_majority_matches += 1
        pair_rows.append(
            {
                "anchor_id": anchor["id"],
                "kind": anchor["kind"],
                "human_winner": anchor["human_winner"],
                "counts_a": counts["A"],
                "counts_b": counts["B"],
                "majority_winner": majority_winner,
                "majority_matches_human": majority_matches,
                "stability": stability,
                "sample_reason": rows[0]["reason"],
            }
        )

    total = len(judgments)
    correct = sum(1 for row in judgments if row["correct"])
    avg_confidence = statistics.mean(row["confidence"] for row in judgments)
    human_label_agreement = correct / total if total else 0.0
    winner_stability = statistics.mean(stability_scores) if stability_scores else 0.0
    pair_majority_agreement = pair_majority_matches / len(anchors) if anchors else 0.0

    return {
        "elapsed_sec": elapsed_sec,
        "total_judgments": total,
        "human_label_agreement": human_label_agreement,
        "winner_stability": winner_stability,
        "pair_majority_agreement": pair_majority_agreement,
        "avg_confidence": avg_confidence,
        "pair_rows": pair_rows,
        "pass_human_label_agreement": human_label_agreement >= 0.80,
        "pass_winner_stability": winner_stability >= 0.90,
        "pass_elapsed": elapsed_sec <= 180,
    }


def write_results(results_path, args, summary):
    status = "PASS" if (
        summary["pass_human_label_agreement"]
        and summary["pass_winner_stability"]
        and summary["pass_elapsed"]
    ) else "FAIL"

    lines = [
        "# Day 1 Judge Signal Results",
        "",
        f"- Backend: `{args.backend}`",
        f"- Model: `{args.model}`",
        f"- Repeats per pair: `{args.repeats}`",
        f"- Workers: `{args.workers}`",
        f"- Total judgments: `{summary['total_judgments']}`",
        f"- Elapsed seconds: `{summary['elapsed_sec']:.2f}`",
        f"- Human label agreement: `{summary['human_label_agreement']:.2%}`",
        f"- Pair majority agreement: `{summary['pair_majority_agreement']:.2%}`",
        f"- Winner stability: `{summary['winner_stability']:.2%}`",
        f"- Average confidence: `{summary['avg_confidence']:.2f}`",
        f"- Overall status: `{status}`",
        "",
        "## Pass Criteria",
        "",
        f"- Human label agreement >= 80%: `{'PASS' if summary['pass_human_label_agreement'] else 'FAIL'}`",
        f"- Winner stability >= 90%: `{'PASS' if summary['pass_winner_stability'] else 'FAIL'}`",
        f"- Elapsed <= 180s: `{'PASS' if summary['pass_elapsed'] else 'FAIL'}`",
        "",
        "## Per-Pair Summary",
        "",
        "| Pair | Kind | Human | Votes A | Votes B | Majority | Majority Matches | Stability |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]

    for row in summary["pair_rows"]:
        lines.append(
            f"| `{row['anchor_id']}` | `{row['kind']}` | `{row['human_winner']}` | {row['counts_a']} | {row['counts_b']} | `{row['majority_winner']}` | `{'yes' if row['majority_matches_human'] else 'no'}` | `{row['stability']:.2%}` |"
        )

    lines.extend(["", "## Example Judge Reasons", ""])
    lines.append("")
    lines.append("Note: `Option 1` and `Option 2` in the sampled reasons refer to the randomized presentation order used during each trial.")
    lines.append("")
    for row in summary["pair_rows"]:
        lines.append(f"- `{row['anchor_id']}`: {row['sample_reason']}")

    results_path.write_text("\n".join(lines) + "\n")


def main():
    args = parse_args()
    prompt_template = args.prompt.read_text()
    anchors = load_anchors(args.anchors)
    tasks = build_tasks(anchors, args.repeats)
    cwd = args.results.parent

    start = time.perf_counter()
    judgments = []
    with tempfile.TemporaryDirectory(prefix="judge-signal-") as tmp_dir:
        schema_path = Path(tmp_dir) / "schema.json"
        schema_path.write_text(json.dumps(SCHEMA))
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = [
                executor.submit(judge_once, task, prompt_template, args, schema_path, cwd)
                for task in tasks
            ]
            for future in concurrent.futures.as_completed(futures):
                judgments.append(future.result())
    elapsed_sec = time.perf_counter() - start

    judgments.sort(key=lambda row: (row["anchor_id"], row["repeat"]))
    summary = summarize(anchors, judgments, elapsed_sec)
    write_results(args.results, args, summary)

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
