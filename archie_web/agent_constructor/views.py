"""Agent constructor API (ARCHIE-342).

The library of saved systems lives here; validation, composition, runs and
schedules are on the agent (/agent-systems), this app proxies them. Django
never decides whether a system is valid: the agent validator does.
"""

import json
import logging

from django.http import HttpRequest, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from archie_web.agent_constructor.models import AgentSystem
from archie_web.prompt_evals.services import AgentError, call_agent
from archie_web.prompt_evals.views import api_view, parse_json

logger = logging.getLogger(__name__)

AGENT_PREFIX = "/agent-systems"
# The composer makes one or two LLM calls of up to 120 s
COMPOSE_TIMEOUT_SECONDS = 260


def _agent(method: str, path: str, payload: dict | None = None, **kwargs) -> JsonResponse:
    try:
        result = call_agent(method, path, payload, **kwargs)
    except AgentError as error:
        logger.error(f"agent_constructor_error_001: \033[31m{method} {path}: {error}\033[0m")
        return JsonResponse({"error": str(error)}, status=error.status_code)
    return JsonResponse(result, safe=False)


def _body(request: HttpRequest) -> dict | JsonResponse:
    try:
        payload = parse_json(request)
    except json.JSONDecodeError as error:
        return JsonResponse({"error": f"Invalid JSON: {error}"}, status=422)
    if not isinstance(payload, dict):
        return JsonResponse({"error": "A JSON object is required"}, status=422)
    return payload


@api_view
@require_GET
def catalog(request: HttpRequest) -> JsonResponse:
    return _agent("GET", f"{AGENT_PREFIX}/catalog")


@api_view
@require_POST
def validate(request: HttpRequest) -> JsonResponse:
    payload = _body(request)
    if isinstance(payload, JsonResponse):
        return payload
    return _agent("POST", f"{AGENT_PREFIX}/validate", {"spec": payload.get("spec") or {}})


@api_view
@require_POST
def compose(request: HttpRequest) -> JsonResponse:
    payload = _body(request)
    if isinstance(payload, JsonResponse):
        return payload
    return _agent(
        "POST",
        f"{AGENT_PREFIX}/compose",
        {"task": payload.get("task", ""), "topology": payload.get("topology") or None},
        timeout=COMPOSE_TIMEOUT_SECONDS,
    )


@api_view
@require_http_methods(["GET", "POST"])
def systems(request: HttpRequest) -> JsonResponse:
    if request.method == "GET":
        return JsonResponse({"systems": [s.to_dict() for s in AgentSystem.objects.all()]})
    payload = _body(request)
    if isinstance(payload, JsonResponse):
        return payload
    error = _invalid_system(payload)
    if error:
        return error
    system = AgentSystem.objects.create(
        title=payload["title"].strip(),
        spec=payload["spec"],
        task=payload.get("task", ""),
        demo_mode=bool(payload.get("demo_mode", True)),
        updated_by=request.eval_actor,
    )
    logger.info(f"agent_constructor_001: Saved system {system.id} {system.title}")
    return JsonResponse(system.to_dict(), status=201)


def _invalid_system(payload: dict) -> JsonResponse | None:
    if not str(payload.get("title", "")).strip():
        return JsonResponse({"error": "title is required"}, status=422)
    if not isinstance(payload.get("spec"), dict):
        return JsonResponse({"error": "spec must be an object"}, status=422)
    return None


@api_view
@require_http_methods(["GET", "PUT", "DELETE"])
def system_detail(request: HttpRequest, system_id: int) -> JsonResponse:
    system = get_object_or_404(AgentSystem, id=system_id)
    if request.method == "GET":
        return JsonResponse(system.to_dict())
    if request.method == "DELETE":
        if system.schedule_job_id:
            _unschedule(system)
        system.delete()
        logger.info(f"agent_constructor_002: Deleted system {system_id}")
        return JsonResponse({"deleted": True})
    payload = _body(request)
    if isinstance(payload, JsonResponse):
        return payload
    error = _invalid_system(payload)
    if error:
        return error
    system.title = payload["title"].strip()
    system.spec = payload["spec"]
    system.task = payload.get("task", "")
    system.demo_mode = bool(payload.get("demo_mode", True))
    system.revision += 1
    system.updated_by = request.eval_actor
    system.save()
    return JsonResponse(system.to_dict())


def _unschedule(system: AgentSystem) -> None:
    try:
        call_agent("DELETE", f"{AGENT_PREFIX}/schedules/{system.schedule_job_id}")
    except AgentError as error:
        if error.status_code != 404:
            raise
    system.schedule_job_id = ""
    system.save(update_fields=["schedule_job_id", "updated_at"])


@api_view
@require_http_methods(["GET", "POST", "DELETE"])
def system_schedule(request: HttpRequest, system_id: int) -> JsonResponse:
    """The schedule runs the saved snapshot: saving again needs a new schedule."""
    system = get_object_or_404(AgentSystem, id=system_id)
    try:
        if request.method == "GET":
            if not system.schedule_job_id:
                return JsonResponse({"schedule": None})
            info = call_agent("GET", f"{AGENT_PREFIX}/schedules/{system.schedule_job_id}")
            return JsonResponse({"schedule": info})
        if system.schedule_job_id:
            _unschedule(system)
        if request.method == "DELETE":
            return JsonResponse({"schedule": None})
        info = call_agent(
            "POST",
            f"{AGENT_PREFIX}/schedules",
            {"spec": system.spec, "demo_mode": system.demo_mode},
        )
    except AgentError as error:
        logger.error(f"agent_constructor_error_002: \033[31m{error}\033[0m")
        return JsonResponse({"error": str(error)}, status=error.status_code)
    system.schedule_job_id = info["job_id"]
    system.save(update_fields=["schedule_job_id", "updated_at"])
    logger.info(f"agent_constructor_003: System {system.id} scheduled as {info['job_id']}")
    return JsonResponse({"schedule": info})


@api_view
@require_http_methods(["GET", "POST"])
def runs(request: HttpRequest) -> JsonResponse:
    if request.method == "GET":
        limit = request.GET.get("limit", "30")
        return _agent("GET", f"{AGENT_PREFIX}/runs?limit={int(limit) if limit.isdigit() else 30}")
    payload = _body(request)
    if isinstance(payload, JsonResponse):
        return payload
    return _agent(
        "POST",
        f"{AGENT_PREFIX}/runs",
        {
            "spec": payload.get("spec") or {},
            "task": payload.get("task", ""),
            "demo_mode": bool(payload.get("demo_mode", True)),
        },
    )


@api_view
@require_GET
def run_detail(request: HttpRequest, run_id: str) -> JsonResponse:
    return _agent("GET", f"{AGENT_PREFIX}/runs/{run_id}")


@api_view
@require_POST
def run_cancel(request: HttpRequest, run_id: str) -> JsonResponse:
    return _agent("POST", f"{AGENT_PREFIX}/runs/{run_id}/cancel")


@api_view
@require_GET
def agent_run(request: HttpRequest, run_id: str) -> JsonResponse:
    """One step of a system run: the full agent run record with its events."""
    return _agent("GET", f"/runtime/runs/{run_id}")
