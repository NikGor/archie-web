import json
from datetime import timedelta
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from archie_web.ai_assistant.models import Conversation, Message
from archie_web.chat_monitoring import services
from archie_web.chat_monitoring.models import MonitorRun, TurnEvaluation
from archie_web.prompt_evals import views as eval_views

TOKEN = "test-token"
NOW = "2026-10-16T12:00:00+00:00"


def make_conversation(conversation_id: str, turns: int, start_minutes_ago: int = 60):
    conversation = Conversation.objects.create(
        conversation_id=conversation_id, title=f"Chat {conversation_id}"
    )
    start = timezone.now() - timedelta(minutes=start_minutes_ago)
    for turn in range(turns):
        Message.objects.create(
            message_id=f"{conversation_id}-u{turn}",
            conversation=conversation,
            role="user",
            content={"content_format": "plain", "text": f"question {turn}"},
            created_at=start + timedelta(minutes=2 * turn),
        )
        Message.objects.create(
            message_id=f"{conversation_id}-a{turn}",
            conversation=conversation,
            role="assistant",
            content={"content_format": "plain", "text": f"answer {turn}"},
            created_at=start + timedelta(minutes=2 * turn + 1),
        )
    return conversation


def make_evaluation(message_id: str, grade: str = "green", run_id: str = "run1") -> dict:
    return {
        "run_id": run_id,
        "conversation_id": message_id.rsplit("-", 1)[0],
        "message_id": message_id,
        "grade": grade,
        "summary": "Answer is fine",
        "criteria": [
            {"criterion": "helpfulness", "grade": grade, "comment": "ok"},
            {"criterion": "tool_choice", "grade": None, "comment": "no trace"},
        ],
        "trace_found": False,
        "judge_model": "typesafe/jev-router",
        "judge_cost": 0.0001,
        "evaluated_at": NOW,
    }


def make_run(run_id: str = "run1", status: str = "running") -> dict:
    return {
        "run_id": run_id,
        "status": status,
        "request": {"max_conversations": 20, "triggered_by": "ui"},
        "judge_model": "typesafe/jev-router",
        "conversations": 1,
        "total_turns": 2,
        "done_turns": 1,
        "red": 1,
        "created_at": NOW,
    }


@mock.patch.object(eval_views, "EVAL_API_TOKEN", TOKEN)
class AgentApiTest(TestCase):
    auth = {"HTTP_AUTHORIZATION": f"Bearer {TOKEN}"}

    def post(self, name: str, payload: dict):
        return self.client.post(
            reverse(name), data=json.dumps(payload), content_type="application/json", **self.auth
        )

    def test_pending_lists_only_unjudged_turns_oldest_first(self):
        make_conversation("new", turns=1, start_minutes_ago=10)
        make_conversation("old", turns=2, start_minutes_ago=100)
        self.post("chat_monitoring_ingest_evaluation", make_evaluation("old-a0"))

        response = self.client.get(reverse("chat_monitoring_pending"), **self.auth)

        conversations = response.json()["conversations"]
        self.assertEqual([c["conversation_id"] for c in conversations], ["old", "new"])
        self.assertEqual(conversations[0]["pending_message_ids"], ["old-a1"])
        self.assertEqual(len(conversations[0]["messages"]), 4)
        self.assertEqual(
            json.loads(conversations[0]["messages"][0]["content_json"])["text"], "question 0"
        )

    def test_pending_decodes_content_stored_as_json_string(self):
        conversation = make_conversation("legacy", turns=1)
        Message.objects.filter(conversation=conversation).update(
            content=json.dumps({"content_format": "plain", "text": "old"})
        )
        response = self.client.get(reverse("chat_monitoring_pending"), **self.auth)
        message = response.json()["conversations"][0]["messages"][1]
        self.assertEqual(json.loads(message["content_json"])["text"], "old")

    def test_pending_passes_stored_response_format(self):
        conversation = make_conversation("fmt", turns=1)
        Message.objects.filter(conversation=conversation, role="assistant").update(
            response_format="markdown"
        )
        response = self.client.get(reverse("chat_monitoring_pending"), **self.auth)
        messages = response.json()["conversations"][0]["messages"]
        self.assertEqual([m["response_format"] for m in messages], [None, "markdown"])

    def test_pending_respects_limit_and_filter(self):
        make_conversation("a", turns=1, start_minutes_ago=30)
        make_conversation("b", turns=1, start_minutes_ago=20)
        url = reverse("chat_monitoring_pending")

        limited = self.client.get(url, {"limit": 1}, **self.auth).json()
        filtered = self.client.get(url, {"conversation_id": "b"}, **self.auth).json()

        self.assertEqual([c["conversation_id"] for c in limited["conversations"]], ["a"])
        self.assertEqual([c["conversation_id"] for c in filtered["conversations"]], ["b"])

    def test_evaluation_ingest_is_idempotent(self):
        make_conversation("c", turns=1)
        self.post("chat_monitoring_ingest_run", make_run())
        self.post("chat_monitoring_ingest_evaluation", make_evaluation("c-a0", "red"))
        response = self.post("chat_monitoring_ingest_evaluation", make_evaluation("c-a0", "orange"))

        self.assertEqual(response.status_code, 200)
        evaluation = TurnEvaluation.objects.get()
        self.assertEqual(evaluation.grade, "orange")
        self.assertEqual(evaluation.run.run_id, "run1")
        self.assertEqual(evaluation.criteria[1]["grade"], None)

    def test_evaluation_for_missing_message_is_404(self):
        response = self.post("chat_monitoring_ingest_evaluation", make_evaluation("x-a0"))
        self.assertEqual(response.status_code, 404)

    def test_bad_evaluation_is_422(self):
        make_conversation("c", turns=1)
        payload = {**make_evaluation("c-a0"), "grade": "yellow"}
        response = self.post("chat_monitoring_ingest_evaluation", payload)
        self.assertEqual(response.status_code, 422)

    def test_run_ingest_upserts(self):
        self.post("chat_monitoring_ingest_run", make_run())
        self.post("chat_monitoring_ingest_run", {**make_run(), "status": "completed", "done_turns": 2})
        run = MonitorRun.objects.get()
        self.assertEqual((run.status, run.done_turns), ("completed", 2))

    def test_agent_api_needs_token(self):
        response = self.client.get(reverse("chat_monitoring_pending"))
        self.assertEqual(response.status_code, 403)


class UiApiTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("niko")
        self.client.force_login(self.user)
        make_conversation("red", turns=2)
        make_conversation("green", turns=1)
        make_conversation("pending", turns=1)
        for message_id, grade in [("red-a0", "green"), ("red-a1", "red"), ("green-a0", "green")]:
            services.store_evaluation(
                services.MonitorTurnEvaluation.model_validate(make_evaluation(message_id, grade))
            )

    def test_summary_counts_worst_grade_per_conversation(self):
        summary = self.client.get(reverse("chat_monitoring_summary")).json()
        self.assertEqual(summary["conversations"], {"red": 1, "orange": 0, "green": 1})
        self.assertEqual(summary["turns"], {"green": 2, "red": 1})
        self.assertEqual(summary["pending_turns"], 1)
        self.assertEqual(summary["pending_conversations"], 1)

    def test_reasons_are_counted_and_filter_conversations(self):
        payload = make_evaluation("pending-a0", "red")
        payload["criteria"][0]["reason"] = "helpless_refusal"
        payload["criteria"].append(
            {"criterion": "format_fit", "grade": "orange", "reason": "too_long", "score": 0.5}
        )
        services.store_evaluation(services.MonitorTurnEvaluation.model_validate(payload))

        summary = self.client.get(reverse("chat_monitoring_summary")).json()
        url = reverse("chat_monitoring_conversations")
        filtered = self.client.get(url, {"reason": "too_long"}).json()["conversations"]
        none = self.client.get(url, {"reason": "too"}).json()["conversations"]

        self.assertEqual(summary["reasons"], {"helpless_refusal": 1, "too_long": 1})
        self.assertEqual([c["conversation_id"] for c in filtered], ["pending"])
        self.assertEqual(filtered[0]["red"], 1)
        self.assertEqual(none, [])

    def test_broken_spec_rules_are_stored_counted_and_filterable(self):
        payload = make_evaluation("pending-a0", "red")
        payload["criteria"] = []
        payload["rules"] = [
            {"spec": "format_ui_answer", "rule_id": "ui_map", "text": "Use a map", "grade": "red"},
            {"spec": "outcome", "rule_id": "solves_request", "text": "Solve it", "grade": "orange", "reason": "needless_question"},
            {"spec": "format_ui_answer", "rule_id": "ui_tables", "text": "Tables", "grade": "green"},
            {"spec": "format_ui_answer", "rule_id": "ui_charts", "text": "Charts", "grade": None},
        ]
        payload["spec_versions"] = {"format_ui_answer": "abc"}
        services.store_evaluation(services.MonitorTurnEvaluation.model_validate(payload))

        evaluation = TurnEvaluation.objects.get(message_id="pending-a0")
        summary = self.client.get(reverse("chat_monitoring_summary")).json()
        filtered = self.client.get(
            reverse("chat_monitoring_conversations"), {"reason": "format_ui_answer:ui_map"}
        ).json()["conversations"]
        detail = self.client.get(
            reverse("chat_monitoring_conversation", args=["pending"])
        ).json()

        self.assertEqual(
            evaluation.reasons,
            ",format_ui_answer:ui_map,outcome:solves_request,needless_question,",
        )
        self.assertEqual(
            summary["reasons"],
            {"format_ui_answer:ui_map": 1, "outcome:solves_request": 1, "needless_question": 1},
        )
        self.assertEqual(summary["reason_labels"]["format_ui_answer:ui_map"], "Use a map")
        self.assertEqual([c["conversation_id"] for c in filtered], ["pending"])
        turn = detail["messages"][1]["evaluation"]
        self.assertEqual(len(turn["rules"]), 4)
        self.assertEqual(turn["spec_versions"], {"format_ui_answer": "abc"})

    def test_rule_stats_count_grades_by_version_since_a_time(self):
        def rules_payload(message_id: str, grade: str, version: str) -> dict:
            payload = make_evaluation(message_id, grade)
            payload["rules"] = [
                {"spec": "format_ui_answer", "rule_id": "ui_map", "text": "Map", "grade": grade},
                {"spec": "format_ui_answer", "rule_id": "ui_tables", "text": "Tables"},
            ]
            payload["spec_versions"] = {"format_ui_answer": version}
            return payload

        services.store_evaluation(
            services.MonitorTurnEvaluation.model_validate(rules_payload("pending-a0", "red", "v1"))
        )
        old = make_conversation("old", turns=1, start_minutes_ago=60 * 24 * 10)
        services.store_evaluation(
            services.MonitorTurnEvaluation.model_validate(rules_payload("old-a0", "red", "v0"))
        )
        url = reverse("chat_monitoring_rules")

        week = self.client.get(url).json()
        since_now = self.client.get(url, {"since": timezone.now().isoformat()}).json()

        ui_map = next(r for r in week["rules"] if r["rule_id"] == "ui_map")
        self.assertEqual((ui_map["red"], ui_map["applicable"]), (1, 1))
        self.assertEqual(ui_map["versions"], {"v1": {"red": 1, "orange": 0, "green": 0, "not_applicable": 0}})
        self.assertEqual(ui_map["examples"][0]["message_id"], "pending-a0")
        self.assertIn("model", ui_map["examples"][0])
        tables = next(r for r in week["rules"] if r["rule_id"] == "ui_tables")
        self.assertEqual((tables["not_applicable"], tables["applicable"]), (1, 0))
        self.assertEqual(since_now["rules"], [])
        self.assertIsNotNone(old)

    def test_conversation_list_filters_by_grade(self):
        url = reverse("chat_monitoring_conversations")
        red = self.client.get(url, {"grade": "red"}).json()["conversations"]
        everything = self.client.get(url).json()["conversations"]
        self.assertEqual([c["conversation_id"] for c in red], ["red"])
        self.assertEqual(red[0]["unreviewed"], 1)
        self.assertEqual(
            {c["conversation_id"] for c in everything}, {"red", "green", "pending"}
        )

    def test_conversation_list_shows_pending_conversations(self):
        url = reverse("chat_monitoring_conversations")
        pending = self.client.get(url, {"grade": "pending"}).json()["conversations"]
        red = self.client.get(url, {"grade": "red"}).json()["conversations"]

        self.assertEqual([c["conversation_id"] for c in pending], ["pending"])
        self.assertEqual((pending[0]["grade"], pending[0]["pending"]), ("pending", 1))
        self.assertIsNone(pending[0]["last_evaluated_at"])
        # Two judged turns and two messages each must not inflate the counts
        self.assertEqual((red[0]["red"], red[0]["green"], red[0]["pending"]), (1, 1, 0))

    def test_conversation_list_orders_by_last_message_and_pages(self):
        for index in range(25):
            make_conversation(f"bulk{index:02}", turns=1, start_minutes_ago=200 + index)
        make_conversation("newest", turns=1, start_minutes_ago=1)
        url = reverse("chat_monitoring_conversations")

        first = self.client.get(url).json()
        last = self.client.get(url, {"page": 2}).json()
        beyond = self.client.get(url, {"page": 9}).json()

        self.assertEqual(first["conversations"][0]["conversation_id"], "newest")
        self.assertEqual((first["total"], first["pages"], first["page"]), (29, 2, 1))
        self.assertEqual(len(first["conversations"]), 20)
        self.assertEqual(len(last["conversations"]), 9)
        self.assertEqual(last["conversations"][-1]["conversation_id"], "bulk24")
        self.assertEqual(beyond["page"], 2)

    def test_review_marks_only_problem_turns(self):
        url = reverse("chat_monitoring_review", args=["red"])
        response = self.client.post(url)
        self.assertEqual(response.json(), {"reviewed": 1})
        unreviewed = self.client.get(
            reverse("chat_monitoring_conversations"), {"unreviewed": "1"}
        ).json()["conversations"]
        self.assertEqual(unreviewed, [])

    def test_conversation_detail_has_text_and_evaluations(self):
        detail = self.client.get(reverse("chat_monitoring_conversation", args=["red"])).json()
        messages = detail["messages"]
        self.assertEqual([m["role"] for m in messages], ["user", "assistant"] * 2)
        self.assertEqual(messages[3]["text"], "answer 1")
        self.assertEqual(messages[3]["evaluation"]["grade"], "red")
        self.assertIsNone(messages[0]["evaluation"])

    @mock.patch.object(services, "call_agent", return_value={"run_id": "r1", "status": "running"})
    def test_start_run_marks_ui_trigger(self, call_agent):
        response = self.client.post(
            reverse("chat_monitoring_start"),
            data=json.dumps({"max_conversations": 5, "triggered_by": "schedule"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 202)
        method, path, payload = call_agent.call_args.args
        self.assertEqual((method, path), ("POST", "/monitoring/runs"))
        self.assertEqual(payload["triggered_by"], "ui")
        self.assertEqual(payload["max_conversations"], 5)

    def test_stale_running_run_is_not_active(self):
        services.store_run(services.MonitorRunInfo.model_validate(make_run()))
        self.assertIsNotNone(self.client.get(reverse("chat_monitoring_active")).json()["run"])
        MonitorRun.objects.update(updated_at=timezone.now() - timedelta(hours=1))
        self.assertIsNone(self.client.get(reverse("chat_monitoring_active")).json()["run"])
