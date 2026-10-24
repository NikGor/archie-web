"""Swarm journal API (ARCHIE-281).

Agent (service token): POST batches of swarm messages.
Audit and UI (service token or session): events and runs of a time window.
"""

import logging
from datetime import datetime

from archie_shared.swarm.models import SwarmJournalBatch
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET, require_POST
from pydantic import ValidationError

from archie_web.prompt_evals.views import api_view, service_only
from archie_web.swarm_journal import services

logger = logging.getLogger(__name__)


def _parse_window(request: HttpRequest) -> tuple[datetime, datetime]:
    """`since` and `until` are ISO 8601 times with an offset."""
    return (
        datetime.fromisoformat(request.GET["since"]),
        datetime.fromisoformat(request.GET["until"]),
    )


@service_only
@require_POST
def ingest_messages(request: HttpRequest) -> JsonResponse:
    """Agent -> Django: posted swarm messages."""
    try:
        batch = SwarmJournalBatch.model_validate_json(request.body)
    except ValidationError as error:
        logger.error(f"swarm_journal_error_001: Bad batch: \033[31m{error}\033[0m")
        return JsonResponse({"error": str(error)}, status=422)
    stored = services.store_messages(batch.messages)
    logger.info(f"swarm_journal_001: Stored {stored} message(s)")
    return JsonResponse({"stored": stored})


@api_view
@require_GET
def list_events(request: HttpRequest) -> JsonResponse:
    try:
        since, until = _parse_window(request)
    except (KeyError, ValueError) as error:
        return JsonResponse(
            {"error": f"since and until are required: {error}"}, status=422
        )
    events = services.find_events(since, until, request.GET.get("run_id"))
    return JsonResponse({"events": [services.event_to_dict(e) for e in events]})


@api_view
@require_GET
def list_runs(request: HttpRequest) -> JsonResponse:
    try:
        since, until = _parse_window(request)
    except (KeyError, ValueError) as error:
        return JsonResponse(
            {"error": f"since and until are required: {error}"}, status=422
        )
    events = list(services.find_events(since, until))
    return JsonResponse({"runs": services.summarize_runs(events)})
