"""Swarm journal storage and queries (ARCHIE-281)."""

from collections import Counter
from datetime import datetime

from archie_shared.swarm.models import SwarmMessage
from django.db.models import QuerySet

from archie_web.swarm_journal.models import SwarmEvent

EVENTS_LIMIT = 5000
_UPDATE_FIELDS = [
    "run_id",
    "created_at",
    "sender",
    "kind",
    "text",
    "mentions",
    "reply_to",
    "depth",
    "importance",
    "round",
    "actions",
    "usage",
]


def _to_event(message: SwarmMessage) -> SwarmEvent:
    return SwarmEvent(
        message_id=message.message_id,
        run_id=message.run_id or "",
        created_at=datetime.fromisoformat(message.created_at),
        sender=message.sender,
        kind=message.kind,
        text=message.text,
        mentions=message.mentions,
        reply_to=message.reply_to or "",
        depth=message.depth,
        importance=message.importance or "",
        round=message.round,
        actions=[a.model_dump(mode="json") for a in message.actions],
        usage=message.usage.model_dump(mode="json") if message.usage else None,
    )


def store_messages(messages: list[SwarmMessage]) -> int:
    """Insert or update by message_id: the agent may send a message again on retry."""
    SwarmEvent.objects.bulk_create(
        [_to_event(m) for m in messages],
        update_conflicts=True,
        unique_fields=["message_id"],
        update_fields=_UPDATE_FIELDS,
    )
    return len(messages)


def find_events(
    since: datetime, until: datetime, run_id: str | None = None
) -> QuerySet[SwarmEvent]:
    events = SwarmEvent.objects.filter(created_at__gte=since, created_at__lt=until)
    if run_id:
        events = events.filter(run_id=run_id)
    return events[:EVENTS_LIMIT]


def event_to_dict(event: SwarmEvent) -> dict:
    return {
        "message_id": event.message_id,
        "run_id": event.run_id or None,
        "created_at": event.created_at.isoformat(),
        "sender": event.sender,
        "kind": event.kind,
        "text": event.text,
        "mentions": event.mentions,
        "reply_to": event.reply_to or None,
        "depth": event.depth,
        "importance": event.importance or None,
        "round": event.round,
        "actions": event.actions,
        "usage": event.usage,
    }


def summarize_runs(events: list[SwarmEvent]) -> list[dict]:
    """One line per run: its trigger (first message), span, kinds and cost."""
    runs: dict[str, list[SwarmEvent]] = {}
    for event in events:
        runs.setdefault(event.run_id or event.message_id, []).append(event)
    summary = []
    for run_id, run_events in runs.items():
        first, last = run_events[0], run_events[-1]
        summary.append(
            {
                "run_id": run_id,
                "trigger_sender": first.sender,
                "trigger_kind": first.kind,
                "trigger_text": first.text,
                "started_at": first.created_at.isoformat(),
                "finished_at": last.created_at.isoformat(),
                "messages": len(run_events),
                "kinds": dict(Counter(e.kind for e in run_events)),
                "failed_actions": sum(
                    1
                    for e in run_events
                    for a in e.actions
                    if a.get("status") != "success"
                ),
                "total_cost": round(
                    sum((e.usage or {}).get("total_cost", 0.0) for e in run_events), 6
                ),
            }
        )
    return summary
