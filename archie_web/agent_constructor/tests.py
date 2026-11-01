import json
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from archie_web.agent_constructor import views
from archie_web.agent_constructor.models import AgentSystem
from archie_web.prompt_evals import views as eval_views
from archie_web.prompt_evals.services import AgentError

TOKEN = "test-token"
AUTH = {"HTTP_AUTHORIZATION": f"Bearer {TOKEN}"}
SPEC = {"name": "pair", "topology": "centralized", "nodes": [{"id": "main"}]}


@mock.patch.object(eval_views, "EVAL_API_TOKEN", TOKEN)
class AgentConstructorApiTests(TestCase):
    def post(self, name: str, data: dict, *args, method: str = "post"):
        return getattr(self.client, method)(
            reverse(name, args=args),
            data=json.dumps(data),
            content_type="application/json",
            **AUTH,
        )

    def test_api_needs_authentication(self):
        response = self.client.get(reverse("agent_constructor_systems"))
        self.assertEqual(response.status_code, 401)

    def test_logged_in_user_reads_the_library(self):
        self.client.force_login(User.objects.create_user("niko"))
        response = self.client.get(reverse("agent_constructor_systems"))
        self.assertEqual(response.json(), {"systems": []})

    def test_save_update_and_delete_a_system(self):
        created = self.post(
            "agent_constructor_systems", {"title": " Pair ", "spec": SPEC, "task": "t"}
        )
        self.assertEqual(created.status_code, 201)
        system_id = created.json()["id"]
        self.assertEqual(created.json()["title"], "Pair")
        updated = self.post(
            "agent_constructor_system",
            {"title": "Pair 2", "spec": {**SPEC, "topology": "workflow"}, "demo_mode": False},
            system_id,
            method="put",
        )
        self.assertEqual(updated.json()["revision"], 2)
        self.assertFalse(updated.json()["demo_mode"])
        deleted = self.client.delete(reverse("agent_constructor_system", args=[system_id]), **AUTH)
        self.assertEqual(deleted.status_code, 200)
        self.assertFalse(AgentSystem.objects.exists())

    def test_system_needs_title_and_spec(self):
        self.assertEqual(self.post("agent_constructor_systems", {"spec": SPEC}).status_code, 422)
        self.assertEqual(
            self.post("agent_constructor_systems", {"title": "x", "spec": "no"}).status_code, 422
        )

    @mock.patch.object(views, "call_agent")
    def test_validate_and_runs_are_proxied(self, call_agent):
        call_agent.return_value = {"valid": True, "errors": []}
        response = self.post("agent_constructor_validate", {"spec": SPEC})
        self.assertEqual(response.json(), {"valid": True, "errors": []})
        call_agent.assert_called_with("POST", "/agent-systems/validate", {"spec": SPEC})
        call_agent.return_value = {"system_run_id": "r1", "state": "running"}
        self.post("agent_constructor_runs", {"spec": SPEC, "task": "Go", "demo_mode": False})
        call_agent.assert_called_with(
            "POST", "/agent-systems/runs", {"spec": SPEC, "task": "Go", "demo_mode": False}
        )

    @mock.patch.object(views, "call_agent")
    def test_agent_errors_keep_their_status(self, call_agent):
        call_agent.side_effect = AgentError("errors: centralized needs one agent", 422)
        response = self.post("agent_constructor_runs", {"spec": SPEC})
        self.assertEqual(response.status_code, 422)
        self.assertIn("centralized", response.json()["error"])

    @mock.patch.object(views, "call_agent")
    def test_compose_waits_for_the_llm(self, call_agent):
        call_agent.return_value = {"spec": SPEC}
        self.post("agent_constructor_compose", {"task": "Why?", "topology": ""})
        call_agent.assert_called_with(
            "POST",
            "/agent-systems/compose",
            {"task": "Why?", "topology": None},
            timeout=views.COMPOSE_TIMEOUT_SECONDS,
        )

    @mock.patch.object(views, "call_agent")
    def test_schedule_replaces_the_previous_job(self, call_agent):
        system = AgentSystem.objects.create(title="t", spec=SPEC, schedule_job_id="old")
        call_agent.side_effect = [{"deleted": True}, {"job_id": "new", "enabled": True}]
        response = self.post("agent_constructor_schedule", {}, system.id)
        self.assertEqual(response.json()["schedule"]["job_id"], "new")
        self.assertEqual(call_agent.call_args_list[0].args, ("DELETE", "/agent-systems/schedules/old"))
        system.refresh_from_db()
        self.assertEqual(system.schedule_job_id, "new")

    @mock.patch.object(views, "call_agent")
    def test_deleting_a_system_removes_its_schedule(self, call_agent):
        system = AgentSystem.objects.create(title="t", spec=SPEC, schedule_job_id="job")
        call_agent.side_effect = AgentError("not found", 404)
        response = self.client.delete(reverse("agent_constructor_system", args=[system.id]), **AUTH)
        self.assertEqual(response.status_code, 200)
        call_agent.assert_called_once_with("DELETE", "/agent-systems/schedules/job")
