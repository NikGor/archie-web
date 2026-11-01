from django.contrib import admin

from archie_web.agent_constructor.models import AgentSystem


@admin.register(AgentSystem)
class AgentSystemAdmin(admin.ModelAdmin):
    list_display = ("title", "revision", "demo_mode", "schedule_job_id", "updated_at")
    search_fields = ("title",)
