"""Chat monitoring API (ARCHIE-213).

Agent (service token): fetch pending turns, report runs and turn evaluations.
UI (session): summary, graded conversations, run start and progress.
"""

import json
import logging
from datetime import datetime, timedelta

from archie_shared.monitoring.models import (MONITOR_MAX_CONVERSATIONS,
                                             MonitorRunInfo, MonitorRunRequest,
                                             MonitorTurnEvaluation)
from django.http import HttpRequest, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST
from pydantic import ValidationError

from archie_web.ai_assistant.models import Conversation, Message
from archie_web.chat_monitoring import services
from archie_web.chat_monitoring.models import MonitorRun
from archie_web.prompt_evals.services import AgentError
from archie_web.prompt_evals.views import (SERVICE_ACTOR, api_view,
                                              parse_json, service_only)

logger = logging.getLogger(__name__)


@service_only
@require_GET
def get_pending(request: HttpRequest) -> JsonResponse:
    """Agent <- Django: conversations with unjudged assistant turns."""
    limit = min(
        int(request.GET.get("limit", MONITOR_MAX_CONVERSATIONS)),
        MONITOR_MAX_CONVERSATIONS,
    )
    conversation_ids = [cid for cid in request.GET.getlist("conversation_id") if cid]
    batch = services.get_pending_batch(limit, conversation_ids)
    return JsonResponse(batch.model_dump(mode="json"))


@service_only
@require_POST
def ingest_run(request: HttpRequest) -> JsonResponse:
    """Agent -> Django: run state, sent at start, after each turn and at the end."""
    try:
        info = MonitorRunInfo.model_validate_json(request.body)
    except ValidationError as error:
        logger.error(f"chat_monitoring_error_001: Bad run: \033[31m{error}\033[0m")
        return JsonResponse({"error": str(error)}, status=422)
    run = services.store_run(info)
    return JsonResponse({"run_id": run.run_id})


@service_only
@require_POST
def ingest_evaluation(request: HttpRequest) -> JsonResponse:
    """Agent -> Django: judge result for one assistant turn."""
    try:
        evaluation = MonitorTurnEvaluation.model_validate_json(request.body)
    except ValidationError as error:
        logger.error(
            f"chat_monitoring_error_002: Bad evaluation: \033[31m{error}\033[0m"
        )
        return JsonResponse({"error": str(error)}, status=422)
    try:
        stored = services.store_evaluation(evaluation)
    except Message.DoesNotExist:
        logger.warning(
            f"chat_monitoring_warning_001: Message {evaluation.message_id} is gone"
        )
        return JsonResponse({"error": "Message not found"}, status=404)
    return JsonResponse({"id": stored.id})


@api_view
@require_GET
def get_summary(request: HttpRequest) -> JsonResponse:
    return JsonResponse(services.get_summary())


@api_view
@require_GET
def get_rule_stats(request: HttpRequest) -> JsonResponse:
    """?since=<ISO datetime> or ?days=N (default 7): grades per spec rule."""
    since = request.GET.get("since")
    try:
        start = (
            datetime.fromisoformat(since)
            if since
            else timezone.now() - timedelta(days=int(request.GET.get("days", 7)))
        )
    except ValueError as error:
        return JsonResponse({"error": str(error)}, status=422)
    if timezone.is_naive(start):
        start = timezone.make_aware(start)
    return JsonResponse(services.rule_stats(start))


@api_view
@require_GET
def list_conversations(request: HttpRequest) -> JsonResponse:
    return JsonResponse(
        services.list_conversations(
            grade=request.GET.get("grade") or None,
            page=max(int(request.GET.get("page", 1)), 1),
            reason=request.GET.get("reason") or None,
            handling=request.GET.get("handling") or None,
        )
    )


@api_view
@require_GET
def get_conversation(request: HttpRequest, conversation_id: str) -> JsonResponse:
    conversation = get_object_or_404(Conversation, conversation_id=conversation_id)
    return JsonResponse(services.get_conversation_detail(conversation))


@api_view
@require_POST
def set_conversation_handling(
    request: HttpRequest, conversation_id: str
) -> JsonResponse:
    """{"status": "in_progress" | "fixed" | "none", "jira_key": "ARCHIE-…",
    "rule": "spec:rule_id"?, "message_id": "…"?} marks the conversation's broken
    rules (all, or only that rule / turn) — from the UI or the prompt-fix agents."""
    conversation = get_object_or_404(Conversation, conversation_id=conversation_id)
    try:
        payload = parse_json(request)
        marked = services.set_handling(
            conversation,
            str(payload.get("status", "")),
            str(payload.get("jira_key") or "").strip().upper(),
            request.eval_actor,
            rule_key=str(payload.get("rule") or ""),
            message_id=str(payload.get("message_id") or ""),
        )
    except (ValueError, json.JSONDecodeError) as error:
        return JsonResponse({"error": str(error)}, status=422)
    return JsonResponse(
        {"handling": services.handling_to_dict(conversation), "marked": marked}
    )


@api_view
@require_POST
def set_rule_handling(request: HttpRequest) -> JsonResponse:
    """{"rule": "spec:rule_id", "status": "in_progress" | "fixed" | "none",
    "jira_key": "ARCHIE-…", "before": ISO datetime (default now)} marks every
    broken turn of the rule created before `before` (prompt-autofix)."""
    try:
        payload = parse_json(request)
        rule_key = str(payload.get("rule") or "")
        if ":" not in rule_key:
            raise ValueError("rule must be 'spec:rule_id'")
        before = (
            datetime.fromisoformat(payload["before"])
            if payload.get("before")
            else timezone.now()
        )
        if timezone.is_naive(before):
            before = timezone.make_aware(before)
        result = services.set_rule_handling(
            rule_key,
            str(payload.get("status", "")),
            str(payload.get("jira_key") or "").strip().upper(),
            request.eval_actor,
            before,
        )
    except (ValueError, json.JSONDecodeError) as error:
        return JsonResponse({"error": str(error)}, status=422)
    logger.info(
        f"chat_monitoring_002: Rule \033[34m{rule_key}\033[0m {payload['status']}: "
        f"\033[33m{result['marked']}\033[0m turns by {request.eval_actor}"
    )
    return JsonResponse(result)


@api_view
@require_POST
def start_run(request: HttpRequest) -> JsonResponse:
    """Start a run on the agent; the agent then reports progress to this app."""
    try:
        payload = parse_json(request)
        triggered_by = (
            payload.get("triggered_by", "claude")
            if request.eval_actor == SERVICE_ACTOR
            else "ui"
        )
        run_request = MonitorRunRequest.model_validate(
            {**payload, "triggered_by": triggered_by}
        )
    except (ValidationError, json.JSONDecodeError) as error:
        return JsonResponse({"error": str(error)}, status=422)
    try:
        run = services.start_agent_run(run_request)
    except AgentError as error:
        logger.error(f"chat_monitoring_error_003: \033[31m{error}\033[0m")
        return JsonResponse({"error": str(error)}, status=error.status_code)
    logger.info(
        f"chat_monitoring_001: Run \033[34m{run['run_id']}\033[0m started by {request.eval_actor}"
    )
    return JsonResponse(run, status=202)


@api_view
@require_GET
def get_active_run(request: HttpRequest) -> JsonResponse:
    run = services.get_active_run()
    return JsonResponse({"run": services.run_to_dict(run) if run else None})


@api_view
@require_GET
def get_run(request: HttpRequest, run_id: str) -> JsonResponse:
    run = get_object_or_404(MonitorRun, run_id=run_id)
    return JsonResponse(services.run_to_dict(run))
