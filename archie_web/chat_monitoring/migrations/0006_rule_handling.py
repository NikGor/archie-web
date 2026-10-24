import django.db.models.deletion
from django.db import migrations, models

BAD_GRADES = ("red", "orange")


def broken_rule_keys(evaluation) -> list[str]:
    """Same keys as services.broken_rule_keys at the time of this migration."""
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


def move_marks_to_rules(apps, schema_editor) -> None:
    """A conversation mark becomes a mark on every broken rule of the conversation."""
    ConversationHandling = apps.get_model("chat_monitoring", "ConversationHandling")
    RuleHandling = apps.get_model("chat_monitoring", "RuleHandling")
    TurnEvaluation = apps.get_model("chat_monitoring", "TurnEvaluation")
    for handling in ConversationHandling.objects.all():
        marked = 0
        for evaluation in TurnEvaluation.objects.filter(
            conversation_id=handling.conversation_id
        ):
            for key in broken_rule_keys(evaluation):
                RuleHandling.objects.update_or_create(
                    message_id=evaluation.message_id,
                    rule_key=key,
                    defaults={
                        "conversation_id": handling.conversation_id,
                        "status": handling.status,
                        "jira_key": handling.jira_key,
                        "updated_by": handling.updated_by,
                    },
                )
                marked += 1
        if not marked:
            handling.delete()
            continue
        handling.in_progress_rules = marked if handling.status == "in_progress" else 0
        handling.fixed_rules = marked if handling.status == "fixed" else 0
        handling.jira_keys = [handling.jira_key] if handling.jira_key else []
        handling.save()


def move_marks_to_conversations(apps, schema_editor) -> None:
    ConversationHandling = apps.get_model("chat_monitoring", "ConversationHandling")
    for handling in ConversationHandling.objects.all():
        if handling.status == "none":
            handling.status = "in_progress"
        handling.jira_key = handling.jira_keys[0] if handling.jira_keys else ""
        handling.save()


class Migration(migrations.Migration):

    dependencies = [
        ("ai_assistant", "0014_message_response_format"),
        ("chat_monitoring", "0005_conversation_handling"),
    ]

    operations = [
        migrations.CreateModel(
            name="RuleHandling",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("rule_key", models.CharField(db_index=True, max_length=200)),
                ("status", models.CharField(choices=[("in_progress", "in_progress"), ("fixed", "fixed")], db_index=True, max_length=16)),
                ("jira_key", models.CharField(blank=True, default="", max_length=32)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("updated_by", models.CharField(blank=True, default="", max_length=150)),
                ("conversation", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="rule_handlings", to="ai_assistant.conversation", to_field="conversation_id")),
                ("message", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="rule_handlings", to="ai_assistant.message", to_field="message_id")),
            ],
            options={
                "constraints": [models.UniqueConstraint(fields=("message", "rule_key"), name="unique_rule_handling")],
            },
        ),
        migrations.AddField(
            model_name="conversationhandling",
            name="open_rules",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="conversationhandling",
            name="in_progress_rules",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="conversationhandling",
            name="fixed_rules",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="conversationhandling",
            name="jira_keys",
            field=models.JSONField(default=list),
        ),
        migrations.AlterField(
            model_name="conversationhandling",
            name="status",
            field=models.CharField(choices=[("none", "none"), ("in_progress", "in_progress"), ("fixed", "fixed")], db_index=True, max_length=16),
        ),
        migrations.RunPython(move_marks_to_rules, move_marks_to_conversations),
        migrations.RemoveField(
            model_name="conversationhandling",
            name="jira_key",
        ),
    ]
