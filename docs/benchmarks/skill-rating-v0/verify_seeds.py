#!/usr/bin/env python3
"""Validate the public market-scale calibration packet with the standard library."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "market-research-seeds.json"
STRATA = ("basic", "composite", "constraints", "adversarial")
REQUIRED_TASK_FIELDS = {
    "id",
    "stratum",
    "task",
    "input",
    "evidence",
    "requiredAssertions",
    "criticalFailures",
    "numericChecks",
}


def fail(message: str) -> None:
    raise AssertionError(message)


def near(actual: float, expected: float, *, tolerance: float = 1e-9) -> bool:
    return math.isclose(actual, expected, rel_tol=tolerance, abs_tol=tolerance)


def calculate(check: dict[str, Any]) -> float:
    operation = check.get("operation")
    if operation == "sum":
        return sum(check["values"])
    if operation == "difference":
        return check["minuend"] - check["subtrahend"]
    if operation == "product":
        result = 1
        for value in check["values"]:
            result *= value
        return result
    if operation == "divide":
        return check["numerator"] / check["denominator"]
    if operation == "ratio":
        return check["numerator"] / check["denominator"]
    if operation == "average":
        values = check["values"]
        return sum(values) / len(values)
    if operation == "currency_convert":
        return check["amount"] * check["rate"]
    if operation == "annualize_monthly":
        return check["monthly"] * check["months"]
    if operation == "budget_remaining":
        return check["budget"] - check["committed"]
    if operation == "set_union_count":
        return len(set().union(*(set(values) for values in check["sets"])))
    if operation == "set_intersection_count":
        sets = [set(values) for values in check["sets"]]
        return len(set.intersection(*sets))
    if operation == "set_union_three_disjoint_overlaps":
        counts = check["counts"]
        overlaps = check["overlaps"]
        return sum(counts) - sum(overlaps)
    fail(f"unsupported numeric operation: {operation!r}")


def validate_numeric_checks(tasks: list[dict[str, Any]]) -> int:
    checks_seen = 0
    for task in tasks:
        check_ids: set[str] = set()
        for check in task["numericChecks"]:
            if not isinstance(check, dict):
                fail(f"{task['id']}: numeric check must be an object")
            check_id = check.get("id")
            if not isinstance(check_id, str) or not check_id:
                fail(f"{task['id']}: numeric check has invalid id")
            if check_id in check_ids:
                fail(f"{task['id']}: duplicate numeric check id {check_id}")
            check_ids.add(check_id)
            if "expected" not in check:
                fail(f"{task['id']}/{check_id}: missing expected value")
            actual = calculate(check)
            expected = check["expected"]
            if not isinstance(expected, (int, float)) or not near(actual, expected):
                fail(
                    f"{task['id']}/{check_id}: expected {expected!r}, "
                    f"computed {actual!r}"
                )
            checks_seen += 1
    return checks_seen


def validate() -> tuple[int, int]:
    try:
        payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"missing data file: {DATA_PATH}")
    except json.JSONDecodeError as exc:
        fail(f"invalid JSON: {exc}")

    if payload.get("schemaVersion") != "skill-rating-v0":
        fail("unexpected schemaVersion")
    if payload.get("status") != "public-development-set-visible-answers":
        fail("dataset must declare visible public development status")
    notice = payload.get("syntheticEvidenceNotice", "")
    if "fictional" not in notice.lower() and "synthetic" not in notice.lower():
        fail("dataset must explicitly mark evidence as synthetic/fictional")

    tasks = payload.get("tasks")
    if not isinstance(tasks, list):
        fail("tasks must be a list")
    if len(tasks) != 12:
        fail(f"expected 12 tasks, found {len(tasks)}")

    ids: set[str] = set()
    counts = {stratum: 0 for stratum in STRATA}
    for task in tasks:
        if not isinstance(task, dict):
            fail("each task must be an object")
        missing = REQUIRED_TASK_FIELDS - set(task)
        if missing:
            fail(f"{task.get('id', '<unknown>')}: missing fields {sorted(missing)}")
        task_id = task["id"]
        if not isinstance(task_id, str) or not task_id:
            fail("task id must be a non-empty string")
        if task_id in ids:
            fail(f"duplicate task id: {task_id}")
        ids.add(task_id)
        stratum = task["stratum"]
        if stratum not in STRATA:
            fail(f"{task_id}: unsupported stratum {stratum!r}")
        counts[stratum] += 1

        if not isinstance(task["task"], str) or not task["task"].strip():
            fail(f"{task_id}: task prompt is empty")
        if not isinstance(task["input"], dict) or not task["input"]:
            fail(f"{task_id}: input must be a non-empty object")
        evidence = task["evidence"]
        if not isinstance(evidence, list) or not evidence:
            fail(f"{task_id}: evidence must be a non-empty list")
        evidence_ids: set[str] = set()
        for item in evidence:
            if not isinstance(item, dict):
                fail(f"{task_id}: evidence item must be an object")
            for field in ("id", "title", "asOf", "provenance", "content"):
                if not isinstance(item.get(field), str) or not item[field].strip():
                    fail(f"{task_id}: evidence item missing non-empty {field}")
            if "synthetic" not in item["provenance"].lower() and "fictional" not in item["provenance"].lower():
                fail(f"{task_id}/{item['id']}: evidence provenance is not marked synthetic")
            if item["id"] in evidence_ids:
                fail(f"{task_id}: duplicate evidence id {item['id']}")
            evidence_ids.add(item["id"])

        assertions = task["requiredAssertions"]
        if not isinstance(assertions, list) or not assertions:
            fail(f"{task_id}: requiredAssertions must be non-empty")
        assertion_ids: set[str] = set()
        for assertion in assertions:
            if not isinstance(assertion, dict):
                fail(f"{task_id}: assertion must be an object")
            for field in ("id", "requirement", "expected", "evidenceRefs"):
                if field not in assertion:
                    fail(f"{task_id}: assertion missing {field}")
            if assertion["id"] in assertion_ids:
                fail(f"{task_id}: duplicate assertion id {assertion['id']}")
            assertion_ids.add(assertion["id"])
            if not isinstance(assertion["evidenceRefs"], list) or not assertion["evidenceRefs"]:
                fail(f"{task_id}/{assertion['id']}: evidenceRefs must be non-empty")
            unknown_refs = set(assertion["evidenceRefs"]) - evidence_ids
            if unknown_refs:
                fail(f"{task_id}/{assertion['id']}: unknown evidence refs {sorted(unknown_refs)}")

        failures = task["criticalFailures"]
        if not isinstance(failures, list) or not failures or not all(isinstance(item, str) and item.strip() for item in failures):
            fail(f"{task_id}: criticalFailures must contain non-empty strings")
        if not isinstance(task["numericChecks"], list):
            fail(f"{task_id}: numericChecks must be a list")

    for stratum, count in counts.items():
        if count != 3:
            fail(f"stratum {stratum} must contain exactly 3 tasks, found {count}")

    checks = validate_numeric_checks(tasks)
    return len(tasks), checks


def main() -> int:
    try:
        task_count, check_count = validate()
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print(f"PASS: {task_count} unique tasks; strata=basic:3, composite:3, constraints:3, adversarial:3; numeric checks verified={check_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
