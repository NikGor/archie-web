from django.db import models

from archie_web.ai_assistant.models import Conversation, Message

GRADES = ["red", "orange", "green"]
RUN_STATUSES = ["running", "completed", "failed"]


class MonitorRun(models.Model):
    """One chat monitoring run (archie_shared.monitoring.models.MonitorRunInfo)."""

    run_id = models.CharField(max_length=32, unique=True)
    status = models.CharField(
        max_length=16, choices=[(status, status) for status in RUN_STATUSES]
    )
    triggered_by = models.CharField(max_length=16)
    judge_model = models.CharField(max_length=128)
    request = models.JSONField(default=dict)
    conversations = models.PositiveIntegerField(default=0)
    total_turns = models.PositiveIntegerField(default=0)
    done_turns = models.PositiveIntegerField(default=0)
    red = models.PositiveIntegerField(default=0)
    orange = models.PositiveIntegerField(default=0)
    green = models.PositiveIntegerField(default=0)
    errors = models.PositiveIntegerField(default=0)
    total_cost = models.FloatField(default=0.0)
    error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField()
    finished_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.run_id} ({self.status})"


class TurnEvaluation(models.Model):
    """Judge grade of one assistant message (archie_shared MonitorTurnEvaluation)."""

    message = models.OneToOneField(
        Message,
        on_delete=models.CASCADE,
        to_field="message_id",
        related_name="evaluation",
    )
    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        to_field="conversation_id",
        related_name="evaluations",
    )
    run = models.ForeignKey(
        MonitorRun,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="evaluations",
    )
    grade = models.CharField(
        max_length=8, choices=[(grade, grade) for grade in GRADES], db_index=True
    )
    summary = models.TextField()
    criteria = models.JSONField(
        default=list, help_text="List of MonitorCriterionScore"
    )
    trace_found = models.BooleanField(default=False)
    trace_id = models.CharField(max_length=64, blank=True, default="")
    tool_calls = models.JSONField(default=list, help_text="List of MonitorToolCall")
    skills_loaded = models.JSONField(default=list)
    rules = models.JSONField(default=list, help_text="List of MonitorRuleScore")
    spec_versions = models.JSONField(
        default=dict, help_text="Spec name -> fingerprint of the judged spec version"
    )
    reasons = models.TextField(
        blank=True,
        default="",
        help_text="Broken rule keys / reason codes as ',a,b,' for filtering",
    )
    judge_model = models.CharField(max_length=128)
    judge_cost = models.FloatField(null=True, blank=True)
    evaluated_at = models.DateTimeField(db_index=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.CharField(max_length=150, blank=True, default="")

    class Meta:
        ordering = ["-evaluated_at"]
        indexes = [models.Index(fields=["conversation", "grade"])]

    def __str__(self) -> str:
        return f"{self.message_id}: {self.grade}"
