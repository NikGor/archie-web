from django.contrib import admin

from archie_web.chat_monitoring.models import MonitorRun, TurnEvaluation


@admin.register(MonitorRun)
class MonitorRunAdmin(admin.ModelAdmin):
    list_display = (
        "run_id",
        "status",
        "triggered_by",
        "judge_model",
        "done_turns",
        "red",
        "orange",
        "green",
        "errors",
        "total_cost",
        "created_at",
    )
    list_filter = ("status", "triggered_by")


@admin.register(TurnEvaluation)
class TurnEvaluationAdmin(admin.ModelAdmin):
    list_display = (
        "message_id",
        "conversation_id",
        "grade",
        "trace_found",
        "judge_model",
        "evaluated_at",
        "reviewed_at",
    )
    list_filter = ("grade", "trace_found", "judge_model")
    search_fields = ("message__message_id", "conversation__conversation_id", "summary")
    raw_id_fields = ("message", "conversation", "run")
