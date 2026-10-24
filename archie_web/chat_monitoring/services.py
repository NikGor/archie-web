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
    RuleHandling,
    TurnEvaluation,
)
from archie_web.prompt_evals.services import call_agent

logger = logging.getLogger(__name__)

GRADE_ORDER = ["red", "orange", "green"]
BAD_GRADES = ("red", "orange")
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
    refresh_conversation_handling(message.conversation_id)
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
            for row in ConversationHandling.objects.exclude(status="none")
            .values("status")
            .annotate(total=Count("pk"))
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
        queryset = queryset.filter(
            Q(handling__isnull=True) | Q(handling__status="none")
        )
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
    marks: dict[str, dict] = {}
    for mark in conversation.rule_handlings.all():
        marks.setdefault(mark.message_id, {})[mark.rule_key] = mark_to_dict(mark)
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
                # Rule key -> mark of the turn's broken rules (ARCHIE-251)
                "rule_handling": marks.get(message.message_id, {}),
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
    marks = {
        (mark.message_id, mark.rule_key): mark
        for mark in RuleHandling.objects.filter(message__created_at__gte=since)
    }
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
                    # Broken turns by mark: none = nobody took them yet (ARCHIE-251)
                    "handling": {"none": 0, "in_progress": 0, "fixed": 0},
                    "jira_keys": [],
                    "versions": {},
                    "examples": [],
                },
            )
            grade = rule.get("grade") or "not_applicable"
            entry[grade] += 1
            version = evaluation.spec_versions.get(rule["spec"], "")
            by_version = entry["versions"].setdefault(
                version,
                {"red": 0, "orange": 0, "green": 0, "not_applicable": 0, "open": 0},
            )
            by_version[grade] += 1
            if grade not in BAD_GRADES:
                continue
            mark = marks.get((evaluation.message_id, key))
            entry["handling"][mark.status if mark else "none"] += 1
            if mark and mark.jira_key and mark.jira_key not in entry["jira_keys"]:
                entry["jira_keys"].append(mark.jira_key)
            # open = broken and not fixed yet
            by_version["open"] += 0 if mark and mark.status == "fixed" else 1
            if len(entry["examples"]) < RULE_EXAMPLES:
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
                        "handling": mark_to_dict(mark) if mark else None,
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
        "open_rules": handling.open_rules,
        "in_progress_rules": handling.in_progress_rules,
        "fixed_rules": handling.fixed_rules,
        "jira_keys": handling.jira_keys,
        "updated_at": handling.updated_at.isoformat(),
        "updated_by": handling.updated_by,
    }


def mark_to_dict(mark: RuleHandling) -> dict:
    return {
        "status": mark.status,
        "jira_key": mark.jira_key,
        "updated_at": mark.updated_at.isoformat(),
        "updated_by": mark.updated_by,
    }


def broken_rule_keys(evaluation: TurnEvaluation) -> list[str]:
    """Keys of the turn's red / orange rules: 'spec:rule_id', and
    'criteria:<criterion>' for older evaluations that graded generic criteria."""
    keys = [
        f"{rule['spec']}:{rule['rule_id']}"
        for rule in evaluation.rules
        if rule.get("grade") in BAD_GRADES
    ] + [
        f"criteria:{item['criterion']}"
        for item in evaluation.criteria
        if item.get("grade") in BAD_GRADES
    ]
    return list(dict.fromkeys(keys))


def conversation_problems(conversation_id: str) -> list[tuple[str, str]]:
    """(message_id, rule key) of every broken rule in the conversation's judged turns."""
    evaluations = TurnEvaluation.objects.filter(
        conversation_id=conversation_id
    ).only("message_id", "rules", "criteria")
    return [
        (evaluation.message_id, key)
        for evaluation in evaluations
        for key in broken_rule_keys(evaluation)
    ]


def refresh_conversation_handling(conversation_id: str) -> None:
    """Recount the conversation summary from its rule marks. Status: none while a
    broken rule has no mark, in_progress while one is in work, else fixed."""
    marks = {
        (mark.message_id, mark.rule_key): mark
        for mark in RuleHandling.objects.filter(conversation_id=conversation_id)
    }
    problems = conversation_problems(conversation_id)
    marked = [marks[problem] for problem in problems if problem in marks]
    if not marked:
        ConversationHandling.objects.filter(conversation_id=conversation_id).delete()
        return
    counts = Counter(mark.status for mark in marked)
    open_rules = len(problems) - len(marked)
    status = "none" if open_rules else "in_progress" if counts["in_progress"] else "fixed"
    ConversationHandling.objects.update_or_create(
        conversation_id=conversation_id,
        defaults={
            "status": status,
            "open_rules": open_rules,
            "in_progress_rules": counts["in_progress"],
            "fixed_rules": counts["fixed"],
            "jira_keys": sorted({mark.jira_key for mark in marked if mark.jira_key}),
            "updated_by": max(marked, key=lambda mark: mark.updated_at).updated_by,
        },
    )


def check_handling_status(status: str) -> None:
    if status != "none" and status not in HANDLING_STATUSES:
        raise ValueError(f"unknown handling status {status!r}")


def mark_rule(
    conversation_id: str,
    problem: tuple[str, str],
    status: str,
    jira_key: str,
    actor: str,
) -> None:
    """status 'none' removes the mark; a missing jira_key keeps the stored one."""
    message_id, rule_key = problem
    current = RuleHandling.objects.filter(message_id=message_id, rule_key=rule_key).first()
    if status == "none":
        if current:
            current.delete()
        return
    RuleHandling.objects.update_or_create(
        message_id=message_id,
        rule_key=rule_key,
        defaults={
            "conversation_id": conversation_id,
            "status": status,
            "jira_key": jira_key or (current.jira_key if current else ""),
            "updated_by": actor,
        },
    )


def set_handling(
    conversation: Conversation,
    status: str,
    jira_key: str,
    actor: str,
    rule_key: str = "",
    message_id: str = "",
) -> int:
    """Mark the conversation's broken rules: all of them, or only `rule_key` and /
    or the turn `message_id` (UI buttons, prompt-fix agents). Returns the number
    of broken rules the call changed."""
    check_handling_status(status)
    problems = [
        (problem_message, problem_rule)
        for problem_message, problem_rule in conversation_problems(
            conversation.conversation_id
        )
        if (not rule_key or problem_rule == rule_key)
        and (not message_id or problem_message == message_id)
    ]
    for problem in problems:
        mark_rule(conversation.conversation_id, problem, status, jira_key, actor)
    refresh_conversation_handling(conversation.conversation_id)
    return len(problems)


def set_rule_handling(
    rule_key: str,
    status: str,
    jira_key: str,
    actor: str,
    before: datetime,
) -> dict:
    """Mark every broken turn of `rule_key` created before `before` (prompt-autofix:
    in_progress when a ticket takes the rule, fixed after its fix is deployed).
    Turns fixed under another ticket keep their mark; 'none' removes only the
    marks of `jira_key`."""
    check_handling_status(status)
    evaluations = TurnEvaluation.objects.filter(message__created_at__lt=before)
    evaluations = (
        evaluations.exclude(criteria=[])
        if rule_key.startswith("criteria:")
        else evaluations.filter(reasons__contains=f",{rule_key},")
    )
    marks = {
        mark.message_id: mark
        for mark in RuleHandling.objects.filter(
            rule_key=rule_key, message__created_at__lt=before
        )
    }
    changed: Counter[str] = Counter()
    for evaluation in evaluations.only("message_id", "conversation_id", "rules", "criteria"):
        if rule_key not in broken_rule_keys(evaluation):
            continue
        mark = marks.get(evaluation.message_id)
        if status == "none" and (not mark or mark.jira_key != jira_key):
            continue
        if mark and mark.status == "fixed" and mark.jira_key != jira_key:
            continue
        mark_rule(
            evaluation.conversation_id,
            (evaluation.message_id, rule_key),
            status,
            jira_key,
            actor,
        )
        changed[evaluation.conversation_id] += 1
    for conversation_id in changed:
        refresh_conversation_handling(conversation_id)
    return {
        "rule": rule_key,
        "marked": sum(changed.values()),
        "conversations": len(changed),
    }
