import json
from unittest import mock

from archie_shared.evals.models import EvalCaseInfo, EvalExpect
from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from archie_web.prompt_evals import case_services, services, views
from archie_web.prompt_evals.models import EvalCase, EvalCaseResult, EvalRun

TOKEN = "test-token"


def make_case(case_id: str, prompts: list[str]) -> dict:
    return EvalCaseInfo(
        id=case_id,
        name=case_id,
        description=f"Checks {case_id}",
        suite="routing",
        prompts=prompts,
        input="hi",
        response_format="plain",
        stage="stage1",
        expect=EvalExpect(action_type="final_response"),
    ).model_dump(mode="json")


def make_run_info(
    run_id: str = "run1", status: str = "running", hashes: dict | None = None
) -> dict:
    return {
        "run_id": run_id,
        "status": status,
        "request": {
            "models": ["gpt-a", "gpt-b"],
            "repeats": 2,
            "reason": "test reason",
            "jira_key": "ARCHIE-208",
            "triggered_by": "claude",
        },
        "case_ids": ["routing.greeting", "tools.note"],
        "git_sha": "abc",
        "prompt_hashes": hashes or {"cmd_prompt": "h1"},
        "total_attempts": 8,
        "created_at": "2026-10-15T10:00:00+00:00",
        "finished_at": "2026-10-15T10:05:00+00:00" if status != "running" else None,
    }


def make_result(
    case_id: str, model: str, attempt: int, status: str, run_id: str = "run1"
) -> dict:
    return {
        "run_id": run_id,
        "case_id": case_id,
        "model": model,
        "attempt": attempt,
        "status": status,
        "failures": (
            []
            if status == "passed"
            else [{"key": "action_type", "expected": '"a"', "actual": '"b"'}]
        ),
        "total_ms": 1000,
        "total_tokens": 100,
        "output_json": '{"x": 1}',
        "finished_at": "2026-10-15T10:01:00+00:00",
    }


@mock.patch.object(views, "EVAL_API_TOKEN", TOKEN)
class IngestTests(TestCase):
    def post(self, url: str, payload: dict, token: str = TOKEN):
        return self.client.post(
            url,
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    def start_run(self) -> None:
        snapshot = {
            "type": "snapshot",
            "run": make_run_info(),
            "cases": [make_case("routing.greeting", ["cmd_prompt"])],
            "results": [],
            "running": [],
        }
        self.assertEqual(
            self.post(reverse("prompt_evals_ingest_run"), snapshot).status_code, 200
        )

    def test_rejects_wrong_token(self):
        response = self.post(
            reverse("prompt_evals_ingest_run"), make_run_info(), token="wrong"
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(EvalRun.objects.exists())

    def test_snapshot_stores_run_with_cases(self):
        self.start_run()
        run = EvalRun.objects.get(run_id="run1")
        self.assertEqual(run.reason, "test reason")
        self.assertEqual(run.model_names, ["gpt-a", "gpt-b"])
        self.assertEqual(run.cases[0]["description"], "Checks routing.greeting")

    def test_final_info_keeps_cases_and_updates_status(self):
        self.start_run()
        self.post(reverse("prompt_evals_ingest_run"), make_run_info(status="completed"))
        run = EvalRun.objects.get(run_id="run1")
        self.assertEqual(run.status, "completed")
        self.assertEqual(len(run.cases), 1)

    def test_results_are_idempotent_and_recount_totals(self):
        self.start_run()
        url = reverse("prompt_evals_ingest_result", args=["run1"])
        self.post(url, make_result("routing.greeting", "gpt-a", 1, "passed"))
        self.post(url, make_result("routing.greeting", "gpt-a", 1, "passed"))
        self.post(url, make_result("routing.greeting", "gpt-a", 2, "failed"))
        run = EvalRun.objects.get(run_id="run1")
        self.assertEqual(EvalCaseResult.objects.count(), 2)
        self.assertEqual(
            (run.done_attempts, run.passed, run.failed, run.total_tokens),
            (2, 1, 1, 200),
        )

    def test_result_for_unknown_run_is_404(self):
        url = reverse("prompt_evals_ingest_result", args=["missing"])
        self.assertEqual(
            self.post(
                url, make_result("x", "m", 1, "passed", run_id="missing")
            ).status_code,
            404,
        )


class OverviewTests(TestCase):
    def setUp(self):
        run = services.store_run(
            services.EvalRunInfo.model_validate(make_run_info(status="completed"))
        )
        for case_id, model, attempt, status in [
            ("routing.greeting", "gpt-a", 1, "passed"),
            ("routing.greeting", "gpt-a", 2, "passed"),
            ("tools.note", "gpt-a", 1, "passed"),
            ("tools.note", "gpt-a", 2, "failed"),
        ]:
            services.store_result(
                run,
                services.EvalCaseResultModel.model_validate(
                    make_result(case_id, model, attempt, status)
                ),
            )

    def catalog(self, cmd_hash: str = "h1") -> services.Catalog:
        return services.Catalog(
            cases=[
                make_case("routing.greeting", ["cmd_prompt"]),
                make_case("tools.note", ["cmd_prompt"]),
                make_case("ui.new", ["cmd_prompt", "format_ui_answer"]),
            ],
            models=["gpt-a"],
            default_model="gpt-a",
            prompt_hashes={"cmd_prompt": cmd_hash, "format_ui_answer": "h2"},
            prompt_descriptions={"cmd_prompt": "Stage 1: routing"},
        )

    def test_statuses_per_case_and_prompt(self):
        overview = {
            item["prompt"]: item for item in services.build_overview(self.catalog())
        }
        cases = {case["case"]["id"]: case for case in overview["cmd_prompt"]["cases"]}
        self.assertEqual(cases["routing.greeting"]["status"], "passed")
        self.assertEqual(cases["tools.note"]["status"], "flaky")
        self.assertEqual(
            cases["tools.note"]["models"]["gpt-a"], {"passed": 1, "total": 2}
        )
        self.assertEqual(cases["ui.new"]["status"], "never")
        self.assertEqual(overview["cmd_prompt"]["status"], "flaky")
        self.assertEqual(
            services._prompt_status(["passed", "failed", "flaky"]), "failed"
        )
        self.assertEqual(services._prompt_status(["passed", "never"]), "passed")
        self.assertEqual(overview["format_ui_answer"]["status"], "never")
        self.assertFalse(overview["cmd_prompt"]["changed_since_run"])
        self.assertEqual(overview["cmd_prompt"]["description"], "Stage 1: routing")
        self.assertEqual(overview["format_ui_answer"]["description"], "")

    def test_changed_prompt_is_flagged(self):
        overview = {
            item["prompt"]: item
            for item in services.build_overview(self.catalog("h-new"))
        }
        self.assertTrue(overview["cmd_prompt"]["changed_since_run"])
        self.assertFalse(overview["format_ui_answer"]["changed_since_run"])

    def test_list_runs_filters(self):
        self.assertEqual(
            len(services.list_runs(model="gpt-b", prompt=None, case_id=None, limit=10)),
            1,
        )
        self.assertEqual(
            len(services.list_runs(model="gpt-z", prompt=None, case_id=None, limit=10)),
            0,
        )
        self.assertEqual(
            len(
                services.list_runs(
                    model=None, prompt=None, case_id="tools.note", limit=10
                )
            ),
            1,
        )


class UiApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("niko", password="pw")
        self.client.force_login(self.user)

    def test_requires_login(self):
        self.client.logout()
        response = self.client.get(reverse("prompt_evals_runs"))
        self.assertEqual(response.status_code, 401)

    @mock.patch.object(services, "call_agent")
    def test_start_run_forces_ui_trigger(self, call_agent):
        call_agent.return_value = {"run_id": "r9", "total_attempts": 2}
        response = self.client.post(
            reverse("prompt_evals_start"),
            data=json.dumps(
                {
                    "models": ["gpt-a"],
                    "reason": "from ui",
                    "triggered_by": "claude",
                    "case_ids": ["x"],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 202)
        method, path, payload = call_agent.call_args.args
        self.assertEqual((method, path), ("POST", "/evals/runs"))
        self.assertEqual(payload["triggered_by"], "ui")

    @mock.patch.object(
        services,
        "call_agent",
        side_effect=services.AgentError("Run x is in progress", 409),
    )
    def test_agent_error_status_is_passed_through(self, _call_agent):
        response = self.client.post(
            reverse("prompt_evals_start"),
            data=json.dumps({"models": ["gpt-a"], "reason": "from ui"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)

    @mock.patch.object(services, "call_agent")
    def test_start_run_without_reason_uses_default(self, call_agent):
        call_agent.return_value = {"run_id": "r10", "total_attempts": 1}
        response = self.client.post(
            reverse("prompt_evals_start"),
            data=json.dumps({"models": ["gpt-a"], "reason": "  ", "case_ids": ["x"]}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(
            call_agent.call_args.args[2]["reason"], views.DEFAULT_UI_REASON
        )

    def test_start_run_validates_request(self):
        response = self.client.post(
            reverse("prompt_evals_start"),
            data=json.dumps({"models": [], "reason": "x"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 422)


def make_draft(case_id: str = "routing.greeting", **changes) -> dict:
    draft = {
        "id": case_id,
        "name": "Приветствие",
        "description": "На приветствие агент отвечает сразу.",
        "suite": case_id.split(".")[0],
        "extra_prompts": [],
        "tags": ["smalltalk"],
        "input": "Привет!",
        "response_format": "plain",
        "stage": "stage1",
        "judge": False,
        "expect": {"action_type": "final_response"},
    }
    return {**draft, **changes}


def fake_validate(method: str, path: str, payload: dict | None = None) -> dict:
    """Agent stand-in for POST /evals/cases/validate."""
    if "unknown_tool" in json.dumps(payload):
        raise services.AgentError(
            "routing.greeting: unknown tools ['unknown_tool']", 422
        )
    info = {key: value for key, value in payload.items() if key != "extra_prompts"}
    return {**info, "prompts": ["cmd_prompt"] + payload["extra_prompts"]}


@mock.patch.object(services, "call_agent", side_effect=fake_validate)
class CaseApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("niko", password="pw")
        self.client.force_login(self.user)

    def send(self, method: str, url: str, payload: dict):
        return getattr(self.client, method)(
            url, data=json.dumps(payload), content_type="application/json"
        )

    def test_create_stores_case_and_first_revision(self, _agent):
        response = self.send("post", reverse("prompt_evals_cases"), make_draft())
        self.assertEqual(response.status_code, 201)
        case = EvalCase.objects.get(case_id="routing.greeting")
        self.assertEqual(
            (case.prompts, case.revision, case.updated_by), (["cmd_prompt"], 1, "niko")
        )
        self.assertEqual(case.revisions.count(), 1)

    def test_case_rules_are_stored_and_kept_by_editors_without_rules(self, _agent):
        rules = ["cmd_prompt:search_for_live_data"]
        self.send("post", reverse("prompt_evals_cases"), make_draft(rules=rules))
        url = reverse("prompt_evals_case", args=["routing.greeting"])
        draft = make_draft(name="Renamed")
        draft.pop("rules", None)
        response = self.send("put", url, draft)

        case = EvalCase.objects.get(case_id="routing.greeting")
        self.assertEqual(response.json()["rules"], rules)
        self.assertEqual((case.rules, case.name, case.revision), (rules, "Renamed", 2))
        self.assertEqual(case.to_draft()["rules"], rules)

    def test_invalid_case_is_rejected_with_agent_message(self, _agent):
        draft = make_draft(expect={"tools_called": ["unknown_tool"]})
        response = self.send("post", reverse("prompt_evals_cases"), draft)
        self.assertEqual(response.status_code, 422)
        self.assertIn("unknown_tool", response.json()["error"])
        self.assertFalse(EvalCase.objects.exists())

    def test_duplicate_id_is_409(self, _agent):
        self.send("post", reverse("prompt_evals_cases"), make_draft())
        self.assertEqual(
            self.send("post", reverse("prompt_evals_cases"), make_draft()).status_code,
            409,
        )

    def test_update_adds_revision_only_on_change(self, _agent):
        self.send("post", reverse("prompt_evals_cases"), make_draft())
        url = reverse("prompt_evals_case", args=["routing.greeting"])
        self.send("put", url, make_draft())
        self.assertEqual(EvalCase.objects.get().revision, 1)
        response = self.send(
            "put", url, make_draft(input="Здравствуй!", extra_prompts=["persona_bro"])
        )
        case = EvalCase.objects.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            (case.revision, case.input, case.prompts),
            (2, "Здравствуй!", ["cmd_prompt", "persona_bro"]),
        )
        revisions = self.client.get(
            reverse("prompt_evals_case_revisions", args=["routing.greeting"])
        ).json()["revisions"]
        self.assertEqual([r["revision"] for r in revisions], [2, 1])
        self.assertEqual(revisions[1]["data"]["input"], "Привет!")

    def test_id_cannot_change(self, _agent):
        self.send("post", reverse("prompt_evals_cases"), make_draft())
        url = reverse("prompt_evals_case", args=["routing.greeting"])
        self.assertEqual(
            self.send("put", url, make_draft("routing.hello")).status_code, 422
        )

    def test_disable_hides_case_from_agent_catalog(self, _agent):
        self.send("post", reverse("prompt_evals_cases"), make_draft())
        self.send(
            "post",
            reverse("prompt_evals_cases"),
            make_draft("routing.time", input="Который час?"),
        )
        self.send(
            "post",
            reverse("prompt_evals_case_enabled", args=["routing.time"]),
            {"enabled": False},
        )
        drafts = self.client.get(
            reverse("prompt_evals_cases"), {"format": "draft"}
        ).json()["cases"]
        self.assertEqual([d["id"] for d in drafts], ["routing.greeting"])
        self.assertNotIn("prompts", drafts[0])
        all_cases = self.client.get(
            reverse("prompt_evals_cases"), {"include_disabled": "1"}
        ).json()["cases"]
        self.assertEqual(len(all_cases), 2)
        self.assertEqual(EvalCase.objects.get(case_id="routing.time").revision, 2)

    @mock.patch.object(views, "EVAL_API_TOKEN", TOKEN)
    def test_service_token_can_edit_and_start_as_claude(self, agent):
        self.client.logout()
        auth = {"HTTP_AUTHORIZATION": f"Bearer {TOKEN}"}
        response = self.client.post(
            reverse("prompt_evals_cases"),
            data=json.dumps(make_draft()),
            content_type="application/json",
            **auth,
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(EvalCase.objects.get().updated_by, "service")
        agent.side_effect = None
        agent.return_value = {"run_id": "r1", "total_attempts": 1}
        response = self.client.post(
            reverse("prompt_evals_start"),
            data=json.dumps({"models": ["m"], "reason": "check"}),
            content_type="application/json",
            **auth,
        )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(agent.call_args.args[2]["triggered_by"], "claude")

    def test_session_post_without_csrf_token_is_rejected(self, _agent):
        client = self.client_class(enforce_csrf_checks=True)
        client.force_login(self.user)
        response = client.post(
            reverse("prompt_evals_cases"),
            data=json.dumps(make_draft()),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)


class FormatAgentDetailTests(TestCase):
    def test_validation_list_becomes_one_line(self):
        detail = [
            {"loc": ["body", "id"], "msg": "String should match pattern"},
            {"loc": ["body", "expect", "min_ui_items"], "msg": "bad int"},
        ]
        self.assertEqual(
            services.format_agent_detail(detail),
            "id: String should match pattern; expect.min_ui_items: bad int",
        )


class CatalogTests(TestCase):
    def test_missing_optional_endpoint_keeps_models(self):
        def agent(method: str, path: str, payload: dict | None = None):
            if path == "/evals/prompt-descriptions":
                raise services.AgentError("Not Found", 404)
            return (
                {"models": ["gpt-a", "gpt-b"], "default": "gpt-a"}
                if path == "/evals/models"
                else {"cmd_prompt": "h"}
            )

        with mock.patch.object(services, "call_agent", side_effect=agent):
            catalog = services.get_catalog()
        self.assertEqual(
            (catalog.models, catalog.default_model), (["gpt-a", "gpt-b"], "gpt-a")
        )
        self.assertEqual(catalog.prompt_hashes, {"cmd_prompt": "h"})
        self.assertIn("/evals/prompt-descriptions", catalog.agent_error)


class StatusTests(TestCase):
    def results(self, *pairs: tuple[str, str]) -> list:
        return [EvalCaseResult(model=model, status=status) for model, status in pairs]

    def test_models_disagree_is_mixed_not_flaky(self):
        self.assertEqual(
            services._case_status(self.results(("a", "passed"), ("b", "failed"))),
            "mixed",
        )

    def test_same_model_both_outcomes_is_flaky(self):
        results = self.results(("a", "passed"), ("a", "failed"), ("b", "passed"))
        self.assertEqual(services._case_status(results), "flaky")

    def test_prompt_shows_worst_status(self):
        self.assertEqual(services._prompt_status(["passed", "mixed", "flaky"]), "mixed")
        self.assertEqual(services._prompt_status(["never"]), "never")
