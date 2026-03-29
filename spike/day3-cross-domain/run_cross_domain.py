#!/usr/bin/env python3
import json
import os
import random
import re
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
import difflib


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


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def load_manifest(path):
    return json.loads(path.read_text())


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


def run_command(cmd, cwd, timeout=120):
    env = os.environ.copy()
    env["PYTHONPATH"] = str(cwd) if not env.get("PYTHONPATH") else f"{cwd}{os.pathsep}{env['PYTHONPATH']}"
    completed = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)
    return {
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


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


def render_rewrite_prompt(artifact_type, baseline_text, operator, instruction, max_output_lines):
    domain_hint = "technical documentation" if artifact_type == "writing" else "a Python source file"
    return f"""You are editing {domain_hint}.

Apply exactly one bounded operator:
- operator: {operator}
- instruction: {instruction}

Constraints:
- Preserve the original intent.
- Keep the patch small and controlled.
- Do not change unrelated content.
- Output plain file contents only in the candidate_text field.
- Keep the result to at most {max_output_lines} lines.

Return structured output:
- candidate_text: the full revised file contents
- summary: one short sentence describing the change

Baseline:
{baseline_text}
"""


def render_judge_prompt(template, option_1, option_2):
    return template.replace("{{option_1}}", option_1).replace("{{option_2}}", option_2)


def propose_candidate(manifest, baseline_text, root, fixture_dir, generation_schema_path, run_dir):
    proposal = manifest["proposal"]
    prompt = render_rewrite_prompt(
        manifest["artifact_type"],
        baseline_text,
        proposal["operator"],
        proposal["instruction"],
        proposal["max_output_lines"],
    )
    output_path = run_dir / "proposal.json"
    payload = call_codex_json(prompt, proposal["model"], generation_schema_path, output_path, root)
    candidate_text = payload["candidate_text"].strip() + "\n"
    diff_lines = changed_line_count(baseline_text, candidate_text)
    candidate_rel_path = Path(manifest["baseline_path"])
    candidate_out_path = run_dir / candidate_rel_path.name
    candidate_out_path.write_text(candidate_text)
    return {
        "operator": proposal["operator"],
        "summary": payload["summary"].strip(),
        "candidate_text": candidate_text,
        "candidate_artifact_path": str(candidate_out_path),
        "diff_lines": diff_lines,
        "within_budget": diff_lines <= proposal["line_budget"],
    }


def evaluate_pairwise_judge(manifest, baseline_text, candidate_text, root, judge_schema_path, run_dir):
    evaluate = manifest["evaluate"]
    prompt_template = (root / evaluate["prompt_path"]).resolve().read_text()
    judgments = []
    for repeat in range(1, evaluate["repeats"] + 1):
        rng = random.Random(700 + repeat)
        flipped = rng.choice([False, True])
        option_1 = candidate_text if flipped else baseline_text
        option_2 = baseline_text if flipped else candidate_text
        prompt = render_judge_prompt(prompt_template, option_1, option_2)
        output_path = run_dir / f"judge-r{repeat}.json"
        payload = call_codex_json(prompt, evaluate["model"], judge_schema_path, output_path, root)
        winner_map = {"1": ("candidate" if flipped else "baseline"), "2": ("baseline" if flipped else "candidate")}
        judgments.append(
            {
                "repeat": repeat,
                "winner": winner_map[payload["winner"]],
                "confidence": float(payload["confidence"]),
                "reason": payload["reason"].strip(),
            }
        )
    candidate_wins = sum(1 for row in judgments if row["winner"] == "candidate")
    baseline_wins = sum(1 for row in judgments if row["winner"] == "baseline")
    stability = max(candidate_wins, baseline_wins) / len(judgments)
    return {
        "metric_id": "pairwise_quality",
        "baseline_value": 0,
        "candidate_value": candidate_wins,
        "candidate_wins": candidate_wins,
        "baseline_wins": baseline_wins,
        "stability": stability,
        "avg_confidence": sum(row["confidence"] for row in judgments) / len(judgments),
        "sample_reason": judgments[0]["reason"],
        "judgments": judgments,
    }


def parse_pytest_passed(stdout, stderr):
    text = f"{stdout}\n{stderr}"
    match = re.search(r"(\d+)\s+passed", text)
    return int(match.group(1)) if match else 0


def evaluate_pytest_metric(manifest, fixture_dir, candidate_text, run_dir):
    evaluate = manifest["evaluate"]
    baseline_cmd = evaluate["command"]
    baseline_cwd = (fixture_dir / Path(evaluate["cwd"]).relative_to("fixtures/code")).resolve() if evaluate["cwd"] != "fixtures/code" else fixture_dir.resolve()
    baseline_result = run_command(baseline_cmd, baseline_cwd)
    baseline_value = parse_pytest_passed(baseline_result["stdout"], baseline_result["stderr"])

    workspace_dir = run_dir / "workspace"
    shutil.copytree(fixture_dir, workspace_dir, dirs_exist_ok=True)
    target_file = workspace_dir / Path(manifest["baseline_path"]).name
    target_file.write_text(candidate_text)

    candidate_result = run_command(evaluate["command"], workspace_dir)
    candidate_value = parse_pytest_passed(candidate_result["stdout"], candidate_result["stderr"])
    return {
        "metric_id": "tests_passed",
        "baseline_value": baseline_value,
        "candidate_value": candidate_value,
        "candidate_wins": candidate_value > baseline_value,
        "baseline_stdout": baseline_result["stdout"],
        "candidate_stdout": candidate_result["stdout"],
        "sample_reason": f"Candidate passed {candidate_value} tests versus baseline {baseline_value}.",
        "workspace_path": str(workspace_dir),
    }


def decide(manifest, proposal_result, evaluation_result):
    decide_cfg = manifest["decide"]
    if decide_cfg["type"] == "pairwise_majority":
        accepted = (
            evaluation_result["candidate_wins"] > evaluation_result["baseline_wins"]
            and evaluation_result["stability"] >= manifest["evaluate"]["stability_threshold"]
            and proposal_result["within_budget"]
        )
        reason = (
            f"candidate_wins={evaluation_result['candidate_wins']}, "
            f"baseline_wins={evaluation_result['baseline_wins']}, "
            f"stability={evaluation_result['stability']:.2f}, "
            f"within_budget={proposal_result['within_budget']}"
        )
    else:
        accepted = evaluation_result["candidate_value"] > evaluation_result["baseline_value"] and proposal_result["within_budget"]
        reason = (
            f"candidate_value={evaluation_result['candidate_value']}, "
            f"baseline_value={evaluation_result['baseline_value']}, "
            f"within_budget={proposal_result['within_budget']}"
        )
    return {
        "outcome": "accepted" if accepted else "rejected",
        "reason": reason,
        "frontier_changed": accepted,
    }


def run_fixture(manifest_path, generation_schema_path, judge_schema_path):
    root = Path(__file__).resolve().parent
    manifest = load_manifest(manifest_path)
    fixture_id = manifest["fixture_id"]
    fixture_dir = (root / "fixtures" / fixture_id).resolve()
    baseline_path = (root / manifest["baseline_path"]).resolve()
    run_dir = (root / "runs" / fixture_id)
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)

    run_id = f"run-{fixture_id}"
    started_at = utc_now()
    fixture_start = time.perf_counter()
    baseline_text = baseline_path.read_text().strip() + "\n"

    proposal_result = propose_candidate(manifest, baseline_text, root, fixture_dir, generation_schema_path, run_dir)
    if manifest["run"]["type"] == "noop":
        run_step = {"status": "completed", "details": "no-op materialization"}
        evaluation_result = evaluate_pairwise_judge(
            manifest, baseline_text, proposal_result["candidate_text"], root, judge_schema_path, run_dir
        )
    else:
        run_step = {"status": "completed", "details": "pytest command executed during evaluation"}
        evaluation_result = evaluate_pytest_metric(manifest, fixture_dir, proposal_result["candidate_text"], run_dir)

    decision = decide(manifest, proposal_result, evaluation_result)
    elapsed_sec = time.perf_counter() - fixture_start

    run_record = {
        "runId": run_id,
        "fixtureId": fixture_id,
        "status": decision["outcome"],
        "startedAt": started_at,
        "endedAt": utc_now(),
        "proposal": {
            "proposerType": manifest["proposal"]["type"],
            "operator": proposal_result["operator"],
            "summary": proposal_result["summary"],
            "diffLines": proposal_result["diff_lines"],
            "withinBudget": proposal_result["within_budget"],
        },
        "run": run_step,
        "metrics": {
            "primary": evaluation_result["metric_id"],
            "baselineValue": evaluation_result["baseline_value"],
            "candidateValue": evaluation_result["candidate_value"],
        },
        "artifacts": {
            "baselinePath": str(baseline_path),
            "candidatePath": proposal_result["candidate_artifact_path"],
        },
        "elapsedSec": elapsed_sec,
    }

    decision_record = {
        "decisionId": f"decision-{fixture_id}",
        "runId": run_id,
        "outcome": decision["outcome"],
        "reason": decision["reason"],
        "frontierChanged": decision["frontier_changed"],
        "createdAt": utc_now(),
    }

    (run_dir / "run_record.json").write_text(json.dumps(run_record, indent=2) + "\n")
    (run_dir / "decision_record.json").write_text(json.dumps(decision_record, indent=2) + "\n")
    (run_dir / "evaluation.json").write_text(json.dumps(evaluation_result, indent=2) + "\n")

    return {
        "fixture_id": fixture_id,
        "manifest_path": str(manifest_path),
        "run_record_path": str(run_dir / "run_record.json"),
        "decision_record_path": str(run_dir / "decision_record.json"),
        "run_record": run_record,
        "decision_record": decision_record,
        "evaluation": evaluation_result,
    }


def write_results(path, fixture_results, total_elapsed_sec):
    all_same_shapes = all(
        set(result["run_record"].keys()) == set(fixture_results[0]["run_record"].keys())
        and set(result["decision_record"].keys()) == set(fixture_results[0]["decision_record"].keys())
        for result in fixture_results
    )
    all_ran = all(result["decision_record"]["outcome"] in {"accepted", "rejected"} for result in fixture_results)
    within_time = total_elapsed_sec <= 300
    overall = "PASS" if all_same_shapes and all_ran and within_time else "FAIL"

    lines = [
        "# Day 3 Cross-Domain Results",
        "",
        f"- Total elapsed seconds: `{total_elapsed_sec:.2f}`",
        f"- Same RunRecord/DecisionRecord structure across fixtures: `{'PASS' if all_same_shapes else 'FAIL'}`",
        f"- Both fixtures executed through the same runner: `{'PASS' if all_ran else 'FAIL'}`",
        f"- First success path within 5 minutes: `{'PASS' if within_time else 'FAIL'}`",
        f"- Overall status: `{overall}`",
        "",
        "## Fixture Summary",
        "",
        "| Fixture | Outcome | Metric | Baseline | Candidate | Diff lines | Within budget | Elapsed |",
        "|---|---|---|---:|---:|---:|---:|---:|",
    ]

    for result in fixture_results:
        rr = result["run_record"]
        lines.append(
            f"| `{result['fixture_id']}` | `{result['decision_record']['outcome']}` | `{rr['metrics']['primary']}` | {rr['metrics']['baselineValue']} | {rr['metrics']['candidateValue']} | {rr['proposal']['diffLines']} | `{'yes' if rr['proposal']['withinBudget'] else 'no'}` | `{rr['elapsedSec']:.2f}s` |"
        )

    lines.extend(["", "## Records", ""])
    for result in fixture_results:
        lines.append(f"- `{result['fixture_id']}` RunRecord: `{result['run_record_path']}`")
        lines.append(f"- `{result['fixture_id']}` DecisionRecord: `{result['decision_record_path']}`")

    lines.extend(["", "## Evaluation Notes", ""])
    for result in fixture_results:
        lines.append(f"- `{result['fixture_id']}`: {result['evaluation']['sample_reason']}")

    path.write_text("\n".join(lines) + "\n")


def main():
    root = Path(__file__).resolve().parent
    start = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="cross-domain-") as tmp_dir:
        tmp_root = Path(tmp_dir)
        generation_schema_path = tmp_root / "generation_schema.json"
        generation_schema_path.write_text(json.dumps(GENERATION_SCHEMA))
        judge_schema_path = tmp_root / "judge_schema.json"
        judge_schema_path.write_text(json.dumps(JUDGE_SCHEMA))

        fixture_results = [
            run_fixture(root / "writing.fixture.json", generation_schema_path, judge_schema_path),
            run_fixture(root / "code.fixture.json", generation_schema_path, judge_schema_path),
        ]

    total_elapsed_sec = time.perf_counter() - start
    results_path = root / "results.md"
    write_results(results_path, fixture_results, total_elapsed_sec)
    print(json.dumps({"total_elapsed_sec": total_elapsed_sec, "fixtures": fixture_results}, indent=2))


if __name__ == "__main__":
    main()
