"""Move ConversationFlag rows (old Claude Code conversation-monitor) into
TurnEvaluation before ai_assistant drops that model (ARCHIE-213)."""

from django.db import migrations

LEGACY_JUDGE = "claude-conversation-monitor"
SEVERITY_TO_GRADE = {"critical": "red", "medium": "orange", "low": "orange"}


def import_flags(apps, schema_editor):
    ConversationFlag = apps.get_model("ai_assistant", "ConversationFlag")
    Message = apps.get_model("ai_assistant", "Message")
    TurnEvaluation = apps.get_model("chat_monitoring", "TurnEvaluation")
    for flag in ConversationFlag.objects.all():
        message = Message.objects.filter(message_id=flag.message_id).first()
        if message is None or TurnEvaluation.objects.filter(message=message).exists():
            continue
        summary = flag.reason
        if flag.jira_key:
            summary = f"{summary} ({flag.jira_key})"
        TurnEvaluation.objects.create(
            message=message,
            conversation_id=message.conversation_id,
            grade=SEVERITY_TO_GRADE[flag.severity],
            summary=summary,
            judge_model=LEGACY_JUDGE,
            evaluated_at=flag.created_at,
            reviewed_at=flag.reviewed_at,
            reviewed_by=flag.reviewed_by or "",
        )


class Migration(migrations.Migration):

    dependencies = [
        ("chat_monitoring", "0001_initial"),
        ("ai_assistant", "0012_messagefile"),
    ]

    operations = [migrations.RunPython(import_flags, migrations.RunPython.noop)]
