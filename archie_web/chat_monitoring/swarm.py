"""Swarm side of prompt monitoring (ARCHIE-297): swarm agent messages to judge,
their evaluations, and their place in the rule statistics and rule marks."""

import logging
from datetime import datetime, timedelta

from archie_shared.monitoring.models import (
    SwarmMonitorPendingBatch,
    SwarmMonitorRecord,
    SwarmTurnEvaluation,
)
from archie_shared.swarm.models import SwarmMessage
from django.db.models import QuerySet
from django.utils import timezone

from archie_web.chat_monitoring.models import (
    HANDLING_STATUSES,
    MonitorRun,
    SwarmRuleHandling,
)
from archie_web.chat_monitoring.models import SwarmTurnEvaluation as StoredEvaluation
from archie_web.swarm_journal.models import SwarmEvent
from archie_web.swarm_journal.services import event_to_dict

logger = logging.getLogger(__name__)

# Messages an agent writes by its prompt specs; user, system and HA messages
# are not judged
JUDGED_KINDS = ("report", "action", "proposal", "alert", "check", "opinion", "decision")
NOT_AGENTS = ("user", "system", "ha")
HISTORY_MESSAGES = 8
# Older messages ran on prompt versions nobody fixes any more
PENDING_DAYS = 3
BAD_GRADES = ("red", "orange")
# Swarm rule keys start with a swarm spec name
SWARM_SPEC_PREFIX = "swarm_"


def is_swarm_rule(rule_key: str) -> bool:
    return rule_key.startswith(SWARM_SPEC_PREFIX)


def pending_events() -> QuerySet[SwarmEvent]:
    since = timezone.now() - timedelta(days=PENDING_DAYS)
    return (
        SwarmEvent.objects.filter(
            kind__in=JUDGED_KINDS, evaluation__isnull=True, created_at__gte=since
        )
        .exclude(sender__in=NOT_AGENTS)
        .order_by("created_at")
    )


def to_message(event: SwarmEvent) -> SwarmMessage:
    return SwarmMessage.model_validate(event_to_dict(event))


def to_record(event: SwarmEvent) -> SwarmMonitorRecord:
    trigger = (
        SwarmEvent.objects.filter(message_id=event.reply_to).first()
        if event.reply_to
        else None
    )
    history = reversed(
        SwarmEvent.objects.filter(created_at__lt=event.created_at).order_by(
            "-created_at"
        )[:HISTORY_MESSAGES]
    )
    return SwarmMonitorRecord(
        message=to_message(event),
        trigger=to_message(trigger) if trigger else None,
        history=[to_message(item) for item in history],
    )


def get_pending_batch(limit: int) -> SwarmMonitorPendingBatch:
    """Swarm agent messages without an evaluation, oldest first."""
    return SwarmMonitorPendingBatch(
        records=[to_record(event) for event in pending_events()[:limit]]
    )


def reasons_field(evaluation: SwarmTurnEvaluation) -> str:
    keys = [
        f"{rule.spec}:{rule.rule_id}"
        for rule in evaluation.rules
        if rule.grade in BAD_GRADES
    ]
    return f",{','.join(keys)}," if keys else ""


def store_evaluation(evaluation: SwarmTurnEvaluation) -> StoredEvaluation:
    """Insert or replace the evaluation of one swarm message (safe to resend)."""
    event = SwarmEvent.objects.get(message_id=evaluation.message_id)
    stored, _ = StoredEvaluation.objects.update_or_create(
        event=event,
        defaults={
            "agent_id": evaluation.agent_id,
            "run": MonitorRun.objects.filter(run_id=evaluation.run_id).first(),
            "grade": evaluation.grade,
            "rules": [rule.model_dump(mode="json") for rule in evaluation.rules],
            "spec_versions": evaluation.spec_versions,
            "reasons": reasons_field(evaluation),
            "judge_model": evaluation.judge_model,
            "judge_cost": evaluation.judge_cost,
            "evaluated_at": datetime.fromisoformat(evaluation.evaluated_at),
        },
    )
    return stored


def evaluations_since(since: datetime) -> QuerySet[StoredEvaluation]:
    return (
        StoredEvaluation.objects.filter(event__created_at__gte=since)
        .exclude(rules=[])
        .select_related("event")
        .order_by("-event__created_at")
    )


def marks_since(since: datetime) -> dict[tuple[str, str], SwarmRuleHandling]:
    return {
        (mark.event_id, mark.rule_key): mark
        for mark in SwarmRuleHandling.objects.filter(event__created_at__gte=since)
    }


def example(evaluation: StoredEvaluation, grade: str, reason: str | None) -> dict:
    """A broken swarm message in the shape of a chat example of rule_stats."""
    event = evaluation.event
    return {
        "message_id": event.message_id,
        "conversation_id": None,
        "swarm_run_id": event.run_id or None,
        "agent_id": evaluation.agent_id,
        "grade": grade,
        "reason": reason,
        "model": (event.usage or {}).get("model", ""),
        "trace_id": None,
        "created_at": event.created_at.isoformat(),
    }


def set_rule_handling(
    rule_key: str, status: str, jira_key: str, actor: str, before: datetime
) -> dict:
    """Mark every broken swarm message of `rule_key` before `before`; the same
    rules as for chat turns: other tickets' fixed marks stay, 'none' removes
    only the marks of `jira_key`."""
    if status != "none" and status not in HANDLING_STATUSES:
        raise ValueError(f"unknown handling status {status!r}")
    evaluations = StoredEvaluation.objects.filter(
        event__created_at__lt=before, reasons__contains=f",{rule_key},"
    ).only("event_id")
    marks = {
        mark.event_id: mark
        for mark in SwarmRuleHandling.objects.filter(
            rule_key=rule_key, event__created_at__lt=before
        )
    }
    marked = 0
    for evaluation in evaluations:
        mark = marks.get(evaluation.event_id)
        if status == "none":
            if mark and mark.jira_key == jira_key:
                mark.delete()
                marked += 1
            continue
        if mark and mark.status == "fixed" and mark.jira_key != jira_key:
            continue
        SwarmRuleHandling.objects.update_or_create(
            event_id=evaluation.event_id,
            rule_key=rule_key,
            defaults={
                "status": status,
                "jira_key": jira_key or (mark.jira_key if mark else ""),
                "updated_by": actor,
            },
        )
        marked += 1
    logger.info(
        f"chat_monitoring_swarm_001: \033[36m{rule_key}\033[0m -> {status} on {marked} swarm messages"
    )
    return {"rule": rule_key, "marked": marked, "conversations": 0}
