import logging
import os
from collections import defaultdict
from datetime import datetime
from typing import Any

import requests
from archie_shared.evals.models import EvalCaseInfo
from archie_shared.evals.models import EvalCaseResult as EvalCaseResultModel
from archie_shared.evals.models import (EvalRunInfo, EvalRunRequest,
                                        EvalSnapshotEvent)
from django.db import transaction
from django.db.models import Count, Q, Sum
from pydantic import BaseModel, Field

from archie_web.prompt_evals.models import EvalCase, EvalCaseResult, EvalRun

logger = logging.getLogger(__name__)

AI_AGENT_URL = os.getenv("AI_AGENT_URL", "http://archie-ai-agent:8005")
AGENT_TIMEOUT_SECONDS = 15
OVERVIEW_RUN_LIMIT = 200


class AgentError(RuntimeError):
    """The agent eval API failed or is not reachable."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class Catalog(BaseModel):
    cases: list[EvalCaseInfo] = Field(description="Enabled cases from the database")
    models: list[str] = Field(description="Models a run can use")
    default_model: str = Field(description="Default eval model")
    prompt_hashes: dict[str, str] = Field(description="Current prompt template hashes")
    prompt_descriptions: dict[str, str] = Field(
        default_factory=dict,
        description="Prompt template name -> what it is responsible for",
    )
    agent_error: str | None = Field(
        default=None,
        description="Set if the agent is not reachable; models and hashes are then empty",
    )


def parse_datetime(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def format_agent_detail(detail: Any) -> str:
    """FastAPI error detail (text or a list of validation errors) as one line."""
    if isinstance(detail, list):
        return "; ".join(
            f"{'.'.join(str(part) for part in error['loc'][1:])}: {error['msg']}"
            for error in detail
        )
    return str(detail)


def call_agent(
    method: str,
    path: str,
    payload: dict | None = None,
) -> Any:
    try:
        response = requests.request(
            method,
            f"{AI_AGENT_URL}{path}",
            json=payload,
            timeout=AGENT_TIMEOUT_SECONDS,
        )
    except requests.RequestException as error:
        raise AgentError(f"Agent is not reachable: {error}") from error
    if response.status_code >= 400:
        detail = (
            response.json().get("detail", response.text) if response.content else ""
        )
        raise AgentError(format_agent_detail(detail), response.status_code)
    return response.json()


def get_enabled_cases() -> list[EvalCaseInfo]:
    return [
        EvalCaseInfo.model_validate(case.to_info())
        for case in EvalCase.objects.filter(enabled=True)
    ]


def _agent_part(path: str, default: Any, errors: list[str]) -> Any:
    try:
        return call_agent("GET", path)
    except AgentError as error:
        logger.error(f"prompt_evals_error_004: Agent {path}: \033[31m{error}\033[0m")
        errors.append(f"{path}: {error}")
        return default


def get_catalog() -> Catalog:
    """Cases from the database plus models, prompt hashes and descriptions from the agent.

    Each agent part is fetched on its own: one missing endpoint (an older agent)
    must not hide the model list."""
    errors: list[str] = []
    models = _agent_part("/evals/models", {"models": [], "default": ""}, errors)
    return Catalog(
        cases=get_enabled_cases(),
        models=models["models"],
        default_model=models["default"],
        prompt_hashes=_agent_part("/evals/prompts", {}, errors),
        prompt_descriptions=_agent_part("/evals/prompt-descriptions", {}, errors),
        agent_error="; ".join(errors) or None,
    )


def get_case_schema() -> dict:
    return call_agent("GET", "/evals/schema")


def start_agent_run(request: EvalRunRequest) -> dict:
    return call_agent("POST", "/evals/runs", request.model_dump(mode="json"))


def cancel_agent_run(run_id: str) -> dict:
    return call_agent("DELETE", f"/evals/runs/{run_id}")


def get_live_run(run_id: str) -> dict:
    return call_agent("GET", f"/evals/runs/{run_id}")


def _run_fields(info: EvalRunInfo) -> dict:
    return {
        "status": info.status,
        "reason": info.request.reason,
        "jira_key": info.request.jira_key or "",
        "triggered_by": info.request.triggered_by,
        "model_names": info.request.models,
        "repeats": info.request.repeats,
        "judge_model": info.request.judge_model or "",
        "request": info.request.model_dump(mode="json"),
        "case_ids": info.case_ids,
        "git_sha": info.git_sha or "",
        "prompt_hashes": info.prompt_hashes,
        "total_attempts": info.total_attempts,
        "error": info.error or "",
        "created_at": parse_datetime(info.created_at),
        "finished_at": parse_datetime(info.finished_at),
    }


def store_run(update: EvalSnapshotEvent | EvalRunInfo) -> EvalRun:
    """Create or update a run; a snapshot also stores the case descriptions."""
    info = update.run if isinstance(update, EvalSnapshotEvent) else update
    fields = _run_fields(info)
    if isinstance(update, EvalSnapshotEvent):
        fields["cases"] = [case.model_dump(mode="json") for case in update.cases]
    run, created = EvalRun.objects.update_or_create(
        run_id=info.run_id,
        defaults=fields,
    )
    update_run_totals(run)
    logger.info(
        f"prompt_evals_001: Run \033[34m{run.run_id}\033[0m {'created' if created else 'updated'}: {run.status}"
    )
    return run


def store_result(run: EvalRun, result: EvalCaseResultModel) -> EvalCaseResult:
    """Create or update one attempt; safe to retry."""
    with transaction.atomic():
        stored, _ = EvalCaseResult.objects.update_or_create(
            run=run,
            case_id=result.case_id,
            model=result.model,
            attempt=result.attempt,
            defaults={
                "status": result.status,
                "failures": [failure.model_dump() for failure in result.failures],
                "error": result.error or "",
                "stage1_ms": result.stage1_ms,
                "stage2_ms": result.stage2_ms,
                "stage3_ms": result.stage3_ms,
                "total_ms": result.total_ms,
                "total_tokens": result.total_tokens,
                "ui_items_count": result.ui_items_count,
                "judge": result.judge.model_dump() if result.judge else None,
                "output_json": result.output_json or "",
                "finished_at": parse_datetime(result.finished_at),
            },
        )
        update_run_totals(run)
    return stored


def update_run_totals(run: EvalRun) -> None:
    """Recount totals from stored results, so retries never double count."""
    totals = run.results.aggregate(
        done=Count("id"),
        passed=Count("id", filter=Q(status="passed")),
        failed=Count("id", filter=Q(status="failed")),
        errors=Count("id", filter=Q(status="error")),
        tokens=Sum("total_tokens"),
    )
    run.done_attempts = totals["done"]
    run.passed = totals["passed"]
    run.failed = totals["failed"]
    run.errors = totals["errors"]
    run.total_tokens = totals["tokens"] or 0
    run.save(
        update_fields=[
            "done_attempts",
            "passed",
            "failed",
            "errors",
            "total_tokens",
        ]
    )


def run_to_dict(run: EvalRun) -> dict:
    return {
        "run_id": run.run_id,
        "status": run.status,
        "reason": run.reason,
        "jira_key": run.jira_key,
        "triggered_by": run.triggered_by,
        "models": run.model_names,
        "repeats": run.repeats,
        "judge_model": run.judge_model,
        "case_ids": run.case_ids,
        "git_sha": run.git_sha,
        "prompt_hashes": run.prompt_hashes,
        "total_attempts": run.total_attempts,
        "done_attempts": run.done_attempts,
        "passed": run.passed,
        "failed": run.failed,
        "errors": run.errors,
        "total_tokens": run.total_tokens,
        "error": run.error,
        "created_at": run.created_at.isoformat(),
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
    }


def result_to_dict(result: EvalCaseResult) -> dict:
    return {
        "id": result.id,
        "run_id": result.run.run_id,
        "case_id": result.case_id,
        "model": result.model,
        "attempt": result.attempt,
        "status": result.status,
        "failures": result.failures,
        "error": result.error or None,
        "stage1_ms": result.stage1_ms,
        "stage2_ms": result.stage2_ms,
        "stage3_ms": result.stage3_ms,
        "total_ms": result.total_ms,
        "total_tokens": result.total_tokens,
        "ui_items_count": result.ui_items_count,
        "judge": result.judge,
        "finished_at": result.finished_at.isoformat(),
    }


def get_run_detail(run: EvalRun) -> dict:
    results = run.results.select_related("run")
    return {
        "run": run_to_dict(run),
        "cases": run.cases,
        "results": [result_to_dict(result) for result in results],
    }


def list_runs(
    model: str | None,
    prompt: str | None,
    case_id: str | None,
    limit: int,
) -> list[dict]:
    """Newest runs matching all given filters (JSON fields are filtered in Python)."""
    runs = [
        run
        for run in EvalRun.objects.all()
        if (not model or model in run.model_names)
        and (not case_id or case_id in run.case_ids)
        and (not prompt or any(prompt in case["prompts"] for case in run.cases))
    ]
    return [run_to_dict(run) for run in runs[:limit]]


def _latest_case_results(case_ids: list[str]) -> dict[str, list[EvalCaseResult]]:
    """Case ID -> its results from the newest run that has results for it."""
    recent_runs = EvalRun.objects.order_by("-created_at")[:OVERVIEW_RUN_LIMIT]
    results = (
        EvalCaseResult.objects.filter(
            case_id__in=case_ids,
            run__in=recent_runs,
        )
        .select_related("run")
        .order_by("-run__created_at")
    )
    latest: dict[str, list[EvalCaseResult]] = defaultdict(list)
    latest_run: dict[str, int] = {}
    for result in results:
        run_pk = latest_run.setdefault(result.case_id, result.run_id)
        if result.run_id == run_pk:
            latest[result.case_id].append(result)
    return latest


def _attempts_status(statuses: list[str]) -> str:
    passed = statuses.count("passed")
    if passed == len(statuses):
        return "passed"
    return "failed" if passed == 0 else "flaky"


def _case_status(results: list[EvalCaseResult]) -> str:
    """flaky: one model both passes and fails; mixed: models disagree."""
    if not results:
        return "never"
    by_model: dict[str, list[str]] = defaultdict(list)
    for result in results:
        by_model[result.model].append(result.status)
    model_statuses = {_attempts_status(statuses) for statuses in by_model.values()}
    if "flaky" in model_statuses:
        return "flaky"
    return model_statuses.pop() if len(model_statuses) == 1 else "mixed"


# Worst first: the prompt shows its worst case status
_PROMPT_STATUS_ORDER = ["failed", "mixed", "flaky", "passed"]


def _prompt_status(case_statuses: list[str]) -> str:
    known = set(case_statuses) - {"never"}
    return next((status for status in _PROMPT_STATUS_ORDER if status in known), "never")


def build_overview(catalog: Catalog) -> list[dict]:
    """Per prompt: latest status of each case and whether the prompt changed since."""
    latest = _latest_case_results([case.id for case in catalog.cases])
    cases_by_prompt: dict[str, list[EvalCaseInfo]] = defaultdict(list)
    for case in catalog.cases:
        for prompt in case.prompts:
            cases_by_prompt[prompt].append(case)
    overview = []
    for prompt in sorted(cases_by_prompt):
        cases = []
        last_run: EvalRun | None = None
        for case in cases_by_prompt[prompt]:
            results = latest.get(case.id, [])
            run = results[0].run if results else None
            if run and (last_run is None or run.created_at > last_run.created_at):
                last_run = run
            by_model: dict[str, list[str]] = defaultdict(list)
            for result in results:
                by_model[result.model].append(result.status)
            cases.append(
                {
                    "case": case.model_dump(mode="json"),
                    "status": _case_status(results),
                    "run_id": run.run_id if run else None,
                    "run_at": run.created_at.isoformat() if run else None,
                    "models": {
                        model: {
                            "passed": statuses.count("passed"),
                            "total": len(statuses),
                        }
                        for model, statuses in by_model.items()
                    },
                }
            )
        tested_hash = last_run.prompt_hashes.get(prompt) if last_run else None
        overview.append(
            {
                "prompt": prompt,
                "description": catalog.prompt_descriptions.get(prompt, ""),
                "status": _prompt_status([case["status"] for case in cases]),
                "cases": cases,
                "last_run_id": last_run.run_id if last_run else None,
                "last_run_at": last_run.created_at.isoformat() if last_run else None,
                "changed_since_run": bool(
                    tested_hash and tested_hash != catalog.prompt_hashes.get(prompt)
                ),
            }
        )
    return overview
