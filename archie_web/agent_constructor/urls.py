from django.urls import path

from archie_web.agent_constructor import views

urlpatterns = [
    path("api/catalog/", views.catalog, name="agent_constructor_catalog"),
    path("api/validate/", views.validate, name="agent_constructor_validate"),
    path("api/compose/", views.compose, name="agent_constructor_compose"),
    path("api/systems/", views.systems, name="agent_constructor_systems"),
    path("api/systems/<int:system_id>/", views.system_detail, name="agent_constructor_system"),
    path(
        "api/systems/<int:system_id>/schedule/",
        views.system_schedule,
        name="agent_constructor_schedule",
    ),
    path("api/runs/", views.runs, name="agent_constructor_runs"),
    path("api/runs/<str:run_id>/", views.run_detail, name="agent_constructor_run"),
    path("api/runs/<str:run_id>/cancel/", views.run_cancel, name="agent_constructor_cancel"),
    path("api/agent-runs/<str:run_id>/", views.agent_run, name="agent_constructor_agent_run"),
]
