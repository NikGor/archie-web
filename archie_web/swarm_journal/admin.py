from django.contrib import admin

from archie_web.swarm_journal.models import SwarmEvent


@admin.register(SwarmEvent)
class SwarmEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "run_id", "sender", "kind", "importance", "text")
    list_filter = ("kind", "sender", "importance")
    search_fields = ("message_id", "run_id", "text")
