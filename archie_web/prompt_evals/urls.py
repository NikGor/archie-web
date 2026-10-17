from django.urls import path

from archie_web.prompt_evals import views

urlpatterns = [
    path("api/ingest/runs/", views.ingest_run, name="prompt_evals_ingest_run"),
    path(
        "api/ingest/runs/<str:run_id>/results/",
        views.ingest_result,
        name="prompt_evals_ingest_result",
    ),
    path("api/catalog/", views.get_catalog, name="prompt_evals_catalog"),
    path("api/schema/", views.get_schema, name="prompt_evals_schema"),
    path("api/cases/", views.cases, name="prompt_evals_cases"),
    path("api/cases/<str:case_id>/", views.case_detail, name="prompt_evals_case"),
    path(
        "api/cases/<str:case_id>/enabled/",
        views.case_enabled,
        name="prompt_evals_case_enabled",
    ),
    path(
        "api/cases/<str:case_id>/revisions/",
        views.case_revisions,
        name="prompt_evals_case_revisions",
    ),
    path("api/overview/", views.get_overview, name="prompt_evals_overview"),
    path("api/runs/", views.list_runs, name="prompt_evals_runs"),
    path("api/runs/start/", views.start_run, name="prompt_evals_start"),
    path("api/runs/active/", views.get_active_run, name="prompt_evals_active"),
    path("api/runs/<str:run_id>/", views.get_run, name="prompt_evals_run"),
    path(
        "api/runs/<str:run_id>/cancel/",
        views.cancel_run,
        name="prompt_evals_cancel",
    ),
    path(
        "api/results/<int:result_id>/output/",
        views.get_result_output,
        name="prompt_evals_result_output",
    ),
]
