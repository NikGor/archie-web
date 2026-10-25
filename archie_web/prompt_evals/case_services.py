import logging

from archie_shared.evals.models import EvalCaseInfo
from django.db import transaction

from archie_web.prompt_evals import services
from archie_web.prompt_evals.models import EvalCase, EvalCaseRevision

logger = logging.getLogger(__name__)


class CaseError(ValueError):
    """The case cannot be saved."""

    def __init__(self, message: str, status_code: int = 422) -> None:
        super().__init__(message)
        self.status_code = status_code


def validate_case(draft: dict) -> EvalCaseInfo:
    """Ask the agent to check the case; returns it with the inferred prompts."""
    try:
        return EvalCaseInfo.model_validate(
            services.call_agent("POST", "/evals/cases/validate", draft)
        )
    except services.AgentError as error:
        raise CaseError(str(error), error.status_code) from error


def _apply(case: EvalCase, draft: dict, info: EvalCaseInfo) -> None:
    case.name = draft["name"]
    case.description = draft["description"]
    case.suite = draft["suite"]
    case.tags = draft.get("tags", [])
    case.rules = draft.get("rules", [])
    case.extra_prompts = draft.get("extra_prompts", [])
    case.prompts = info.prompts
    case.input = draft["input"]
    case.response_format = draft["response_format"]
    case.stage = draft["stage"]
    case.agent_kind = info.agent_kind
    case.swarm = info.swarm.model_dump(mode="json") if info.swarm else None
    case.judge = draft.get("judge", False)
    case.expect = info.expect.model_dump(exclude_none=True)


def _add_revision(case: EvalCase, author: str) -> None:
    EvalCaseRevision.objects.create(
        case=case,
        revision=case.revision,
        data=case.to_draft(),
        enabled=case.enabled,
        author=author,
    )


def create_case(draft: dict, author: str) -> EvalCase:
    info = validate_case(draft)
    if EvalCase.objects.filter(case_id=info.id).exists():
        raise CaseError(f"Case {info.id} already exists", 409)
    with transaction.atomic():
        case = EvalCase(case_id=info.id, updated_by=author)
        _apply(case, draft, info)
        case.save()
        _add_revision(case, author)
    logger.info(
        f"prompt_evals_case_001: Case \033[34m{case.case_id}\033[0m created by {author}"
    )
    return case


def update_case(case: EvalCase, draft: dict, author: str) -> EvalCase:
    """Save a new revision; an unchanged draft keeps the current revision."""
    # Editors that do not know rules yet must not erase them
    draft = {"rules": case.rules, **draft}
    if draft.get("id") != case.case_id:
        raise CaseError("Case id cannot be changed; duplicate the case instead")
    info = validate_case(draft)
    with transaction.atomic():
        before = case.to_draft()
        _apply(case, draft, info)
        if case.to_draft() == before:
            return case
        case.revision += 1
        case.updated_by = author
        case.save()
        _add_revision(case, author)
    logger.info(
        f"prompt_evals_case_002: Case \033[34m{case.case_id}\033[0m saved as r{case.revision} by {author}"
    )
    return case


def set_case_enabled(case: EvalCase, enabled: bool, author: str) -> EvalCase:
    if case.enabled == enabled:
        return case
    with transaction.atomic():
        case.enabled = enabled
        case.revision += 1
        case.updated_by = author
        case.save()
        _add_revision(case, author)
    logger.info(
        f"prompt_evals_case_003: Case \033[34m{case.case_id}\033[0m enabled={enabled} by {author}"
    )
    return case


def case_to_dict(case: EvalCase) -> dict:
    return {
        **case.to_info(),
        "extra_prompts": case.extra_prompts,
        "enabled": case.enabled,
        "revision": case.revision,
        "updated_at": case.updated_at.isoformat(),
        "updated_by": case.updated_by,
    }


def revision_to_dict(revision: EvalCaseRevision) -> dict:
    return {
        "revision": revision.revision,
        "data": revision.data,
        "enabled": revision.enabled,
        "author": revision.author,
        "created_at": revision.created_at.isoformat(),
    }
