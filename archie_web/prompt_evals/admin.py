from django.contrib import admin

from archie_web.prompt_evals.models import EvalCaseResult, EvalRun


@admin.register(EvalRun)
class EvalRunAdmin(admin.ModelAdmin):
    list_display = [
        "run_id",
        "status",
        "reason",
        "jira_key",
        "passed",
        "failed",
        "errors",
        "created_at",
    ]
    list_filter = ["status", "triggered_by"]
    search_fields = ["run_id", "reason", "jira_key"]


@admin.register(EvalCaseResult)
class EvalCaseResultAdmin(admin.ModelAdmin):
    list_display = ["case_id", "model", "attempt", "status", "total_ms", "total_tokens"]
    list_filter = ["status", "model"]
    search_fields = ["case_id"]
