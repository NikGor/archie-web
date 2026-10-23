import json
import logging
from collections import Counter
from datetime import datetime, timedelta

from archie_shared.monitoring.models import (MonitorConversation,
                                             MonitorMessage,
                                             MonitorPendingBatch,
                                             MonitorRunInfo, MonitorRunRequest,
                                             MonitorTurnEvaluation)
from django.db.models import Count, Max, Min, OuterRef, Q, QuerySet, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone

from archie_web.ai_assistant.models import Conversation, Message
from archie_web.chat_monitoring.models import (
    HANDLING_STATUSES,
    ConversationHandling,
    MonitorRun,
    TurnEvaluation,
)
from archie_web.prompt_evals.services import call_agent

logger = logging.getLogger(__name__)

GRADE_ORDER = ["red", "orange", "green"]
# A running run the agent has not updated for this long is treated as lost
# (agent restart or crash); it no longer blocks the UI.
STALE_RUN_AFTER = timedelta(minutes=10)
CONVERSATION_PAGE_SIZE = 20
TOP_REASONS = 12


def reasons_field(evaluation: MonitorTurnEvaluation) -> str:
    """Broken rule keys ('spec:rule_id') and older criterion reason codes, wrapped
    in commas, so ',key,' matches one key exactly."""
    broken = [rule for rule in evaluation.rules if rule.grade in ("red", "orange")]
    keys = (
        [f"{rule.spec}:{rule.rule_id}" for rule in broken]
        # Outcome checks also say why they failed, e.g. helpless_refusal
        + [rule.reason for rule in broken if rule.reason]
        + [score.reason for score in evaluation.criteria if score.reason]
    )
    return f",{','.join(keys)}," if keys else ""


def stored_content(message: Message) -> dict:
    """Message.content as a dict; early messages (Nov 2025) stored it as a JSON string."""
    content = message.content or {}
    return json.loads(content) if isinstance(content, str) else content


def pending_messages() -> QuerySet[Message]:
    return Message.objects.filter(role="assistant", evaluation__isnull=True)


def get_pending_batch(
    max_conversations: int, conversation_ids: list[str]
) -> MonitorPendingBatch:
    """Conversations with unjudged assistant turns, oldest pending turn first."""
    pending = pending_messages()
    if conversation_ids:
        pending = pending.filter(conversation_id__in=conversation_ids)
    selected = (
        pending.values("conversation_id")
        .annotate(first_pending=Min("created_at"))
        .order_by("first_pending")[:max_conversations]
    )
    selected_ids = [row["conversation_id"] for row in selected]
    conversations = Conversation.objects.filter(
        conversation_id__in=selected_ids
    ).prefetch_related("messages__evaluation")
    by_id = {conversation.conversation_id: conversation for conversation in conversations}
    return MonitorPendingBatch(
        conversations=[_to_monitor_conversation(by_id[cid]) for cid in selected_ids]
    )


def _to_monitor_conversation(conversation: Conversation) -> MonitorConversation:
    messages = sorted(conversation.messages.all(), key=lambda m: m.created_at)
    return MonitorConversation(
        conversation_id=conversation.conversation_id,
        title=conversation.title,
        messages=[
            MonitorMessage(
                message_id=message.message_id,
                role=message.role,
                content_json=json.dumps(stored_content(message), ensure_ascii=False),
                response_format=message.response_format,
                created_at=message.created_at.isoformat(),
            )
            for message in messages
        ],
        pending_message_ids=[
            message.message_id
            for message in messages
            if message.role == "assistant" and not hasattr(message, "evaluation")
        ],
    )


def store_run(info: MonitorRunInfo) -> MonitorRun:
    run, _ = MonitorRun.objects.update_or_create(
        run_id=info.run_id,
        defaults={
            "status": info.status,
            "triggered_by": info.request.triggered_by,
            "judge_model": info.judge_model,
            "request": info.request.model_dump(mode="json"),
            "conversations": info.conversations,
            "total_turns": info.total_turns,
            "done_turns": info.done_turns,
            "red": info.red,
            "orange": info.orange,
            "green": info.green,
            "errors": info.errors,
            "total_cost": info.total_cost,
            "error": info.error or "",
            "created_at": datetime.fromisoformat(info.created_at),
            "finished_at": (
                datetime.fromisoformat(info.finished_at) if info.finished_at else None
            ),
        },
    )
    return run


def store_evaluation(evaluation: MonitorTurnEvaluation) -> TurnEvaluation:
    """Insert or replace the evaluation of one message (safe to resend)."""
    message = Message.objects.get(message_id=evaluation.message_id)
    stored, _ = TurnEvaluation.objects.update_or_create(
        message=message,
        defaults={
            "conversation_id": message.conversation_id,
            "run": MonitorRun.objects.filter(run_id=evaluation.run_id).first(),
            "grade": evaluation.grade,
            "summary": evaluation.summary,
            "criteria": [c.model_dump(mode="json") for c in evaluation.criteria],
            "rules": [r.model_dump(mode="json") for r in evaluation.rules],
            "spec_versions": evaluation.spec_versions,
            "trace_found": evaluation.trace_found,
            "trace_id": evaluation.trace_id or "",
            "tool_calls": [c.model_dump(mode="json") for c in evaluation.tool_calls],
            "skills_loaded": evaluation.skills_loaded,
            "reasons": reasons_field(evaluation),
            "judge_model": evaluation.judge_model,
            "judge_cost": evaluation.judge_cost,
            "evaluated_at": datetime.fromisoformat(evaluation.evaluated_at),
        },
    )
    return stored


def start_agent_run(request: MonitorRunRequest) -> dict:
    return call_agent("POST", "/monitoring/runs", request.model_dump(mode="json"))


def run_to_dict(run: MonitorRun) -> dict:
    status = run.status
    if status == "running" and timezone.now() - run.updated_at > STALE_RUN_AFTER:
        status = "stale"
    return {
        "run_id": run.run_id,
        "status": status,
        "triggered_by": run.triggered_by,
        "judge_model": run.judge_model,
        "conversations": run.conversations,
        "total_turns": run.total_turns,
        "done_turns": run.done_turns,
        "red": run.red,
        "orange": run.orange,
        "green": run.green,
        "errors": run.errors,
        "total_cost": run.total_cost,
        "error": run.error,
        "created_at": run.created_at.isoformat(),
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
    }


def get_active_run() -> MonitorRun | None:
    run = MonitorRun.objects.filter(status="running").first()
    if run and timezone.now() - run.updated_at > STALE_RUN_AFTER:
        return None
    return run


def worst_grade(red: int, orange: int) -> str:
    return "red" if red else "orange" if orange else "green"


def _graded_conversations() -> QuerySet[Conversation]:
    return Conversation.objects.annotate(
        red=Count("evaluations", filter=Q(evaluations__grade="red")),
        orange=Count("evaluations", filter=Q(evaluations__grade="orange")),
        green=Count("evaluations", filter=Q(evaluations__grade="green")),
        last_evaluated_at=Max("evaluations__evaluated_at"),
    ).filter(last_evaluated_at__isnull=False)


def get_summary() -> dict:
    """Conversation counts per worst grade, pending work and recent runs."""
    counts = {grade: 0 for grade in GRADE_ORDER}
    for row in _graded_conversations().values("red", "orange"):
        counts[worst_grade(row["red"], row["orange"])] += 1
    pending = pending_messages()
    return {
        "conversations": counts,
        "turns": {
            row["grade"]: row["total"]
            for row in TurnEvaluation.objects.values("grade").annotate(
                total=Count("id")
            )
        },
        "reasons": (reasons := count_reasons()),
        "reason_labels": reason_labels(list(reasons)),
        "pending_turns": pending.count(),
        "pending_conversations": pending.values("conversation_id").distinct().count(),
        "handling": {
            row["status"]: row["total"]
            for row in ConversationHandling.objects.values("status").annotate(
                total=Count("pk")
            )
        },
        "runs": [run_to_dict(run) for run in MonitorRun.objects.all()[:5]],
    }


def count_reasons() -> dict[str, int]:
    """Most frequent reason codes over all judged turns."""
    counter: Counter[str] = Counter()
    for reasons in TurnEvaluation.objects.exclude(reasons="").values_list(
        "reasons", flat=True
    ):
        counter.update(code for code in reasons.split(",") if code)
    return dict(counter.most_common(TOP_REASONS))


def reason_labels(keys: list[str]) -> dict[str, str]:
    """Rule key -> rule text, taken from the newest evaluation that broke it.
    Older criterion reason codes have no text here; the UI labels them."""
    labels = {}
    for key in keys:
        if ":" not in key:
            continue
        spec, rule_id = key.split(":", 1)
        evaluation = (
            TurnEvaluation.objects.filter(reasons__contains=f",{key},")
            .order_by("-evaluated_at")
            .first()
        )
        labels[key] = next(
            (
                rule["text"]
                for rule in evaluation.rules
                if rule["spec"] == spec and rule["rule_id"] == rule_id
            ),
            key,
        )
    return labels


def _count_by_conversation(queryset: QuerySet) -> Coalesce:
    """Per-conversation row count as a subquery; separate subqueries keep the
    message and evaluation counts from multiplying each other in one join."""
    counted = (
        queryset.filter(conversation_id=OuterRef("conversation_id"))
        .order_by()
        .values("conversation_id")
        .annotate(total=Count("pk"))
        .values("total")
    )
    return Coalesce(Subquery(counted[:1]), 0)


def _listed_conversations() -> QuerySet[Conversation]:
    """Every conversation with an assistant turn, with grade and pending counts."""
    evaluations = TurnEvaluation.objects.all()
    return (
        Conversation.objects.filter(messages__role="assistant")
        .distinct()
        .annotate(
            red=_count_by_conversation(evaluations.filter(grade="red")),
            orange=_count_by_conversation(evaluations.filter(grade="orange")),
            green=_count_by_conversation(evaluations.filter(grade="green")),
            pending=_count_by_conversation(pending_messages()),
            last_message_at=Subquery(
                Message.objects.filter(conversation_id=OuterRef("conversation_id"))
                .order_by("-created_at")
                .values("created_at")[:1]
            ),
            last_evaluated_at=Subquery(
                evaluations.filter(conversation_id=OuterRef("conversation_id"))
                .order_by("-evaluated_at")
                .values("evaluated_at")[:1]
            ),
        )
    )


def conversation_grade(red: int, orange: int, green: int) -> str:
    """Worst grade of the judged turns; 'pending' if no turn is judged yet."""
    return worst_grade(red, orange) if red + orange + green else "pending"


def list_conversations(
    grade: str | None,
    page: int,
    reason: str | None = None,
    handling: str | None = None,
) -> dict:
    """All conversations, newest activity first, one page at a time."""
    queryset = _listed_conversations()
    if reason:
        queryset = queryset.filter(
            conversation_id__in=TurnEvaluation.objects.filter(
                reasons__contains=f",{reason},"
            ).values("conversation_id")
        )
    if grade == "red":
        queryset = queryset.filter(red__gt=0)
    elif grade == "orange":
        queryset = queryset.filter(red=0, orange__gt=0)
    elif grade == "green":
        queryset = queryset.filter(red=0, orange=0, green__gt=0)
    elif grade == "pending":
        queryset = queryset.filter(pending__gt=0)
    if handling == "none":
        queryset = queryset.filter(handling__isnull=True)
    elif handling in HANDLING_STATUSES:
        queryset = queryset.filter(handling__status=handling)
    total = queryset.count()
    pages = max(1, -(-total // CONVERSATION_PAGE_SIZE))
    page = min(page, pages)
    start = (page - 1) * CONVERSATION_PAGE_SIZE
    rows = queryset.select_related("handling").order_by("-last_message_at")[
        start : start + CONVERSATION_PAGE_SIZE
    ]
    items = [
        {
            "conversation_id": conversation.conversation_id,
            "title": conversation.title,
            "created_at": conversation.created_at.isoformat(),
            "last_message_at": conversation.last_message_at.isoformat(),
            "grade": conversation_grade(
                conversation.red, conversation.orange, conversation.green
            ),
            "red": conversation.red,
            "orange": conversation.orange,
            "green": conversation.green,
            "pending": conversation.pending,
            "handling": handling_to_dict(conversation),
            "last_evaluated_at": (
                conversation.last_evaluated_at.isoformat()
                if conversation.last_evaluated_at
                else None
            ),
        }
        for conversation in rows
    ]
    return {"conversations": items, "page": page, "pages": pages, "total": total}


def evaluation_to_dict(evaluation: TurnEvaluation) -> dict:
    return {
        "grade": evaluation.grade,
        "summary": evaluation.summary,
        "criteria": evaluation.criteria,
        "rules": evaluation.rules,
        "spec_versions": evaluation.spec_versions,
        "trace_found": evaluation.trace_found,
        "trace_id": evaluation.trace_id,
        "tool_calls": evaluation.tool_calls,
        "skills_loaded": evaluation.skills_loaded,
        "judge_model": evaluation.judge_model,
        "judge_cost": evaluation.judge_cost,
        "evaluated_at": evaluation.evaluated_at.isoformat(),
    }


def get_conversation_detail(conversation: Conversation) -> dict:
    messages = conversation.messages.select_related("evaluation").order_by("created_at")
    return {
        "conversation_id": conversation.conversation_id,
        "title": conversation.title,
        "created_at": conversation.created_at.isoformat(),
        "handling": handling_to_dict(conversation),
        "messages": [
            {
                "message_id": message.message_id,
                "role": message.role,
                "created_at": message.created_at.isoformat(),
                "content_format": stored_content(message).get("content_format", "plain"),
                "text": conversation.extract_text_from_content(stored_content(message)),
                "evaluation": (
                    evaluation_to_dict(message.evaluation)
                    if hasattr(message, "evaluation")
                    else None
                ),
            }
            for message in messages
        ],
    }


RULE_EXAMPLES = 5


def rule_stats(since: datetime) -> dict:
    """Grades per judged rule over turns created since `since` (the autofix loop
    picks rules to fix and checks earlier fixes by the turns after a deploy)."""
    stats: dict[str, dict] = {}
    evaluations = (
        TurnEvaluation.objects.filter(message__created_at__gte=since)
        .exclude(rules=[])
        .select_related("message")
        .order_by("-message__created_at")
    )
    for evaluation in evaluations:
        for rule in evaluation.rules:
            key = f"{rule['spec']}:{rule['rule_id']}"
            entry = stats.setdefault(
                key,
                {
                    "key": key,
                    "spec": rule["spec"],
                    "rule_id": rule["rule_id"],
                    "text": rule["text"],
                    "red": 0,
                    "orange": 0,
                    "green": 0,
                    "not_applicable": 0,
                    "versions": {},
                    "examples": [],
                },
            )
            grade = rule.get("grade") or "not_applicable"
            entry[grade] += 1
            version = evaluation.spec_versions.get(rule["spec"], "")
            by_version = entry["versions"].setdefault(
                version, {"red": 0, "orange": 0, "green": 0, "not_applicable": 0}
            )
            by_version[grade] += 1
            if grade in ("red", "orange") and len(entry["examples"]) < RULE_EXAMPLES:
                entry["examples"].append(
                    {
                        "message_id": evaluation.message_id,
                        "conversation_id": evaluation.conversation_id,
                        "grade": grade,
                        "reason": rule.get("reason"),
                        # "<command model>/<final output model>" the turn ran on
                        "model": evaluation.message.model,
                        "trace_id": evaluation.trace_id or None,
                        "created_at": evaluation.message.created_at.isoformat(),
                    }
                )
    rules = sorted(
        stats.values(), key=lambda entry: (-entry["red"], -entry["orange"], entry["key"])
    )
    for entry in rules:
        entry["applicable"] = entry["red"] + entry["orange"] + entry["green"]
    return {"since": since.isoformat(), "turns": evaluations.count(), "rules": rules}


def handling_to_dict(conversation: Conversation) -> dict | None:
    handling = getattr(conversation, "handling", None)
    if handling is None:
        return None
    return {
        "status": handling.status,
        "jira_key": handling.jira_key,
        "updated_at": handling.updated_at.isoformat(),
        "updated_by": handling.updated_by,
    }


def set_handling(
    conversation: Conversation, status: str, jira_key: str, actor: str
) -> dict | None:
    """status 'none' clears the mark; a missing jira_key keeps the stored one."""
    if status == "none":
        ConversationHandling.objects.filter(conversation=conversation).delete()
        return None
    if status not in HANDLING_STATUSES:
        raise ValueError(f"unknown handling status {status!r}")
    current = ConversationHandling.objects.filter(conversation=conversation).first()
    handling, _ = ConversationHandling.objects.update_or_create(
        conversation=conversation,
        defaults={
            "status": status,
            "jira_key": jira_key or (current.jira_key if current else ""),
            "updated_by": actor,
        },
    )
    conversation.handling = handling
    return handling_to_dict(conversation)
