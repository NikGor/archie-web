import json
import logging
import os
from collections.abc import Callable
from functools import wraps

from archie_shared.evals.models import EvalCaseResult as EvalCaseResultModel
from archie_shared.evals.models import (EvalRunInfo, EvalRunRequest,
                                        EvalSnapshotEvent)
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.middleware.csrf import CsrfViewMiddleware
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import (require_GET, require_http_methods,
                                          require_POST)
from pydantic import TypeAdapter, ValidationError

from archie_web.prompt_evals import case_services, services
from archie_web.prompt_evals.models import EvalCase, EvalCaseResult, EvalRun

logger = logging.getLogger(__name__)

EVAL_API_TOKEN = os.getenv("EVAL_API_TOKEN", "")
RUN_LIST_LIMIT = 100
DEFAULT_UI_REASON = "Запуск из UI без описания"
SERVICE_ACTOR = "service"

_run_update_adapter: TypeAdapter[EvalSnapshotEvent | EvalRunInfo] = TypeAdapter(
    EvalSnapshotEvent | EvalRunInfo
)


def is_service_request(request: HttpRequest) -> bool:
    """The agent, Claude Code or a script, authenticated with EVAL_API_TOKEN."""
    expected = f"Bearer {EVAL_API_TOKEN}"
    return bool(EVAL_API_TOKEN) and request.headers.get("Authorization") == expected


def _csrf_failure(request: HttpRequest) -> HttpResponse | None:
    check = CsrfViewMiddleware(lambda _request: HttpResponse())
    check.process_request(request)
    return check.process_view(request, None, (), {})


def api_view(view: Callable[..., JsonResponse]) -> Callable[..., HttpResponse]:
    """Logged-in user (with CSRF check) or service token; sets request.eval_actor."""

    @csrf_exempt
    @wraps(view)
    def wrapper(request: HttpRequest, *args: object, **kwargs: object) -> HttpResponse:
        if is_service_request(request):
            request.eval_actor = SERVICE_ACTOR
        elif request.user.is_authenticated:
            failure = _csrf_failure(request)
            if failure is not None:
                return failure
            request.eval_actor = request.user.get_username()
        else:
            return JsonResponse({"error": "Authentication required"}, status=401)
        return view(request, *args, **kwargs)

    return wrapper


def service_only(view: Callable[..., JsonResponse]) -> Callable[..., HttpResponse]:
    @csrf_exempt
    @wraps(view)
    def wrapper(request: HttpRequest, *args: object, **kwargs: object) -> HttpResponse:
        if not is_service_request(request):
            return JsonResponse({"error": "Forbidden"}, status=403)
        return view(request, *args, **kwargs)

    return wrapper


def agent_error_response(error: services.AgentError) -> JsonResponse:
    logger.error(f"prompt_evals_error_001: \033[31m{error}\033[0m")
    return JsonResponse({"error": str(error)}, status=error.status_code)


def parse_json(request: HttpRequest) -> dict:
    return json.loads(request.body or b"{}")


@service_only
@require_POST
def ingest_run(request: HttpRequest) -> JsonResponse:
    """Agent -> Django: run snapshot at start, EvalRunInfo at the end."""
    try:
        update = _run_update_adapter.validate_json(request.body)
    except ValidationError as error:
        logger.error(f"prompt_evals_error_002: Bad run update: \033[31m{error}\033[0m")
        return JsonResponse({"error": str(error)}, status=422)
    run = services.store_run(update)
    return JsonResponse({"run_id": run.run_id})


@service_only
@require_POST
def ingest_result(request: HttpRequest, run_id: str) -> JsonResponse:
    """Agent -> Django: one finished attempt."""
    run = get_object_or_404(EvalRun, run_id=run_id)
    try:
        result = EvalCaseResultModel.model_validate_json(request.body)
    except ValidationError as error:
        logger.error(f"prompt_evals_error_003: Bad result: \033[31m{error}\033[0m")
        return JsonResponse({"error": str(error)}, status=422)
    stored = services.store_result(run, result)
    return JsonResponse({"id": stored.id})


@api_view
@require_GET
def get_catalog(request: HttpRequest) -> JsonResponse:
    return JsonResponse(services.get_catalog().model_dump(mode="json"))


@api_view
@require_GET
def get_schema(request: HttpRequest) -> JsonResponse:
    try:
        return JsonResponse(services.get_case_schema())
    except services.AgentError as error:
        return agent_error_response(error)


@api_view
@require_GET
def get_overview(request: HttpRequest) -> JsonResponse:
    return JsonResponse({"prompts": services.build_overview(services.get_catalog())})


@api_view
@require_http_methods(["GET", "POST"])
def cases(request: HttpRequest) -> JsonResponse:
    """GET: cases (?include_disabled=1; ?format=draft gives enabled drafts for the agent).
    POST: create a case."""
    if request.method == "POST":
        try:
            case = case_services.create_case(parse_json(request), request.eval_actor)
        except case_services.CaseError as error:
            return JsonResponse({"error": str(error)}, status=error.status_code)
        return JsonResponse(case_services.case_to_dict(case), status=201)
    if request.GET.get("format") == "draft":
        drafts = [case.to_draft() for case in EvalCase.objects.filter(enabled=True)]
        return JsonResponse({"cases": drafts})
    queryset = EvalCase.objects.all()
    if request.GET.get("include_disabled") != "1":
        queryset = queryset.filter(enabled=True)
    return JsonResponse(
        {"cases": [case_services.case_to_dict(case) for case in queryset]}
    )


@api_view
@require_http_methods(["GET", "PUT"])
def case_detail(request: HttpRequest, case_id: str) -> JsonResponse:
    case = get_object_or_404(EvalCase, case_id=case_id)
    if request.method == "PUT":
        try:
            case = case_services.update_case(
                case, parse_json(request), request.eval_actor
            )
        except case_services.CaseError as error:
            return JsonResponse({"error": str(error)}, status=error.status_code)
    return JsonResponse(case_services.case_to_dict(case))


@api_view
@require_POST
def case_enabled(request: HttpRequest, case_id: str) -> JsonResponse:
    case = get_object_or_404(EvalCase, case_id=case_id)
    enabled = bool(parse_json(request).get("enabled"))
    case = case_services.set_case_enabled(case, enabled, request.eval_actor)
    return JsonResponse(case_services.case_to_dict(case))


@api_view
@require_GET
def case_revisions(request: HttpRequest, case_id: str) -> JsonResponse:
    case = get_object_or_404(EvalCase, case_id=case_id)
    revisions = [case_services.revision_to_dict(rev) for rev in case.revisions.all()]
    return JsonResponse({"revisions": revisions})


@api_view
@require_GET
def list_runs(request: HttpRequest) -> JsonResponse:
    runs = services.list_runs(
        model=request.GET.get("model"),
        prompt=request.GET.get("prompt"),
        case_id=request.GET.get("case_id"),
        limit=int(request.GET.get("limit", RUN_LIST_LIMIT)),
    )
    return JsonResponse({"runs": runs})


@api_view
@require_GET
def get_run(request: HttpRequest, run_id: str) -> JsonResponse:
    run = get_object_or_404(EvalRun, run_id=run_id)
    return JsonResponse(services.get_run_detail(run))


@api_view
@require_GET
def get_result_output(request: HttpRequest, result_id: int) -> JsonResponse:
    result = get_object_or_404(EvalCaseResult, id=result_id)
    output = json.loads(result.output_json) if result.output_json else None
    return JsonResponse({"output": output})


@api_view
@require_POST
def start_run(request: HttpRequest) -> JsonResponse:
    """Start a run on the agent; the agent then reports progress to this app."""
    try:
        payload = parse_json(request)
        reason = str(payload.get("reason") or "").strip() or DEFAULT_UI_REASON
        triggered_by = (
            payload.get("triggered_by", "claude")
            if request.eval_actor == SERVICE_ACTOR
            else "ui"
        )
        run_request = EvalRunRequest.model_validate(
            {**payload, "reason": reason, "triggered_by": triggered_by}
        )
    except (ValidationError, json.JSONDecodeError) as error:
        return JsonResponse({"error": str(error)}, status=422)
    try:
        run = services.start_agent_run(run_request)
    except services.AgentError as error:
        return agent_error_response(error)
    logger.info(
        f"prompt_evals_002: Run \033[34m{run['run_id']}\033[0m started by {request.eval_actor}"
    )
    return JsonResponse(run, status=202)


@api_view
@require_POST
def cancel_run(request: HttpRequest, run_id: str) -> JsonResponse:
    try:
        return JsonResponse(services.cancel_agent_run(run_id))
    except services.AgentError as error:
        return agent_error_response(error)


@api_view
@require_GET
def get_active_run(request: HttpRequest) -> JsonResponse:
    """The run in progress, if any, so the UI can reattach after a reload."""
    try:
        runs = services.call_agent("GET", "/evals/runs")
    except services.AgentError as error:
        return agent_error_response(error)
    active = next(
        (run for run in runs if run["status"] in ("queued", "running")),
        None,
    )
    return JsonResponse({"run": active})
