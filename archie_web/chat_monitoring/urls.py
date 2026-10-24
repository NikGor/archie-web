from django.urls import path

from archie_web.chat_monitoring import views

urlpatterns = [
    path("api/pending/", views.get_pending, name="chat_monitoring_pending"),
    path("api/ingest/runs/", views.ingest_run, name="chat_monitoring_ingest_run"),
    path(
        "api/ingest/evaluations/",
        views.ingest_evaluation,
        name="chat_monitoring_ingest_evaluation",
    ),
    path("api/summary/", views.get_summary, name="chat_monitoring_summary"),
    path("api/rules/", views.get_rule_stats, name="chat_monitoring_rules"),
    path(
        "api/rules/handling/",
        views.set_rule_handling,
        name="chat_monitoring_rule_handling",
    ),
    path(
        "api/conversations/",
        views.list_conversations,
        name="chat_monitoring_conversations",
    ),
    path(
        "api/conversations/<str:conversation_id>/",
        views.get_conversation,
        name="chat_monitoring_conversation",
    ),
    path(
        "api/conversations/<str:conversation_id>/handling/",
        views.set_conversation_handling,
        name="chat_monitoring_handling",
    ),
    path("api/runs/start/", views.start_run, name="chat_monitoring_start"),
    path("api/runs/active/", views.get_active_run, name="chat_monitoring_active"),
    path("api/runs/<str:run_id>/", views.get_run, name="chat_monitoring_run"),
]
