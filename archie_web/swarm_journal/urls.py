from django.urls import path

from archie_web.swarm_journal import views

urlpatterns = [
    path("api/ingest/", views.ingest_messages, name="swarm_journal_ingest"),
    path("api/events/", views.list_events, name="swarm_journal_events"),
    path("api/runs/", views.list_runs, name="swarm_journal_runs"),
]
