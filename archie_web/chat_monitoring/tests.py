import json
from datetime import timedelta
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from archie_web.ai_assistant.models import Conversation, Message
from archie_web.chat_monitoring import services
from archie_web.chat_monitoring.models import (
    ConversationHandling,
    MonitorRun,
    RuleHandling,
    TurnEvaluation,
)
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
        self.assertEqual(
            ui_map["versions"],
            {"v1": {"red": 1, "orange": 0, "green": 0, "not_applicable": 0, "open": 1}},
        )
        self.assertEqual(ui_map["handling"], {"none": 1, "in_progress": 0, "fixed": 0})
        self.assertIsNone(ui_map["examples"][0]["handling"])
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
        self.assertIsNone(red[0]["handling"])
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

    def test_handling_marks_conversation_and_filters(self):
        url = reverse("chat_monitoring_handling", args=["red"])
        listing = reverse("chat_monitoring_conversations")

        taken = self.post_json(url, {"status": "in_progress", "jira_key": "archie-217"})
        fixed = self.post_json(url, {"status": "fixed"})
        in_work = self.client.get(listing, {"handling": "in_progress"}).json()
        done = self.client.get(listing, {"handling": "fixed"}).json()["conversations"]
        open_ = self.client.get(listing, {"handling": "none"}).json()["conversations"]
        detail = self.client.get(reverse("chat_monitoring_conversation", args=["red"])).json()
        summary = self.client.get(reverse("chat_monitoring_summary")).json()

        # The conversation has one broken turn: red-a1 with a red helpfulness criterion
        self.assertEqual(taken.json()["marked"], 1)
        self.assertEqual(taken.json()["handling"]["jira_keys"], ["ARCHIE-217"])
        self.assertEqual(taken.json()["handling"]["updated_by"], "niko")
        # A status change without a ticket keeps the stored ticket
        self.assertEqual(fixed.json()["handling"]["status"], "fixed")
        self.assertEqual(fixed.json()["handling"]["jira_keys"], ["ARCHIE-217"])
        self.assertEqual(
            detail["messages"][3]["rule_handling"]["criteria:helpfulness"]["status"], "fixed"
        )
        self.assertEqual(in_work["conversations"], [])
        self.assertEqual([c["conversation_id"] for c in done], ["red"])
        self.assertNotIn("red", [c["conversation_id"] for c in open_])
        self.assertEqual(detail["handling"]["status"], "fixed")
        self.assertEqual(summary["handling"], {"fixed": 1})

    def test_handling_none_clears_and_bad_status_is_422(self):
        url = reverse("chat_monitoring_handling", args=["red"])
        self.post_json(url, {"status": "in_progress"})

        cleared = self.post_json(url, {"status": "none"})
        bad = self.post_json(url, {"status": "reviewed"})

        self.assertIsNone(cleared.json()["handling"])
        self.assertEqual(bad.status_code, 422)
        self.assertFalse(ConversationHandling.objects.exists())
        self.assertFalse(RuleHandling.objects.exists())

    def store_rules(self, message_id: str, grades: dict[str, str]) -> None:
        """Judge a turn by spec rules: {"spec:rule_id": grade}."""
        payload = make_evaluation(message_id, "red")
        payload["criteria"] = []
        payload["rules"] = [
            {"spec": key.split(":")[0], "rule_id": key.split(":")[1], "text": key, "grade": grade}
            for key, grade in grades.items()
        ]
        services.store_evaluation(services.MonitorTurnEvaluation.model_validate(payload))

    def test_handling_of_one_rule_keeps_the_conversation_open(self):
        self.store_rules(
            "pending-a0", {"format_ui_answer:ui_map": "red", "outcome:solves_request": "orange", "format_ui_answer:ui_tables": "green"}
        )
        url = reverse("chat_monitoring_handling", args=["pending"])
        listing = reverse("chat_monitoring_conversations")

        one = self.post_json(url, {"status": "fixed", "rule": "format_ui_answer:ui_map", "jira_key": "ARCHIE-300"})
        open_ = [c["conversation_id"] for c in self.client.get(listing, {"handling": "none"}).json()["conversations"]]
        fixed = self.client.get(listing, {"handling": "fixed"}).json()["conversations"]
        other = self.post_json(url, {"status": "in_progress", "rule": "outcome:solves_request", "jira_key": "ARCHIE-301"})
        in_work = self.client.get(listing, {"handling": "in_progress"}).json()["conversations"]
        detail = self.client.get(reverse("chat_monitoring_conversation", args=["pending"])).json()

        self.assertEqual(one.json()["marked"], 1)
        self.assertEqual(
            {key: one.json()["handling"][key] for key in ("status", "open_rules", "fixed_rules", "jira_keys")},
            {"status": "none", "open_rules": 1, "fixed_rules": 1, "jira_keys": ["ARCHIE-300"]},
        )
        self.assertIn("pending", open_)
        self.assertEqual(fixed, [])
        self.assertEqual(other.json()["handling"]["status"], "in_progress")
        self.assertEqual(other.json()["handling"]["jira_keys"], ["ARCHIE-300", "ARCHIE-301"])
        self.assertEqual([c["conversation_id"] for c in in_work], ["pending"])
        marks = detail["messages"][1]["rule_handling"]
        self.assertEqual(set(marks), {"format_ui_answer:ui_map", "outcome:solves_request"})
        self.assertEqual(marks["format_ui_answer:ui_map"]["jira_key"], "ARCHIE-300")

    def test_new_broken_turn_reopens_a_fixed_conversation(self):
        url = reverse("chat_monitoring_handling", args=["red"])
        self.post_json(url, {"status": "fixed", "jira_key": "ARCHIE-217"})

        self.store_rules("red-a0", {"format_plain:plain_straightforward": "orange"})

        handling = ConversationHandling.objects.get(conversation_id="red")
        self.assertEqual((handling.status, handling.open_rules, handling.fixed_rules), ("none", 1, 1))

    def test_rule_handling_marks_turns_before_a_time_and_keeps_other_tickets(self):
        rule = "format_ui_answer:ui_map"
        make_conversation("older", turns=1, start_minutes_ago=90)
        make_conversation("newer", turns=1, start_minutes_ago=10)
        for message_id in ("older-a0", "pending-a0", "newer-a0"):
            self.store_rules(message_id, {rule: "red", "outcome:solves_request": "green"})
        self.post_json(
            reverse("chat_monitoring_handling", args=["older"]),
            {"status": "fixed", "rule": rule, "jira_key": "ARCHIE-260"},
        )
        url = reverse("chat_monitoring_rule_handling")
        before = (timezone.now() - timedelta(minutes=30)).isoformat()

        taken = self.post_json(url, {"rule": rule, "status": "in_progress", "jira_key": "ARCHIE-300", "before": before})
        shipped = self.post_json(url, {"rule": rule, "status": "fixed", "jira_key": "archie-300", "before": before})
        stats = next(
            r for r in self.client.get(reverse("chat_monitoring_rules")).json()["rules"] if r["key"] == rule
        )
        marks = dict(RuleHandling.objects.values_list("message_id", "jira_key"))
        cleared = self.post_json(url, {"rule": rule, "status": "none", "jira_key": "ARCHIE-300"})
        bad = self.post_json(url, {"rule": "ui_map", "status": "fixed"})

        # older-a0 stays fixed under ARCHIE-260; newer-a0 came after `before`
        self.assertEqual((taken.json()["marked"], taken.json()["conversations"]), (1, 1))
        self.assertEqual(shipped.json()["marked"], 1)
        self.assertEqual(marks, {"older-a0": "ARCHIE-260", "pending-a0": "ARCHIE-300"})
        self.assertEqual(stats["handling"], {"none": 1, "in_progress": 0, "fixed": 2})
        self.assertEqual(sorted(stats["jira_keys"]), ["ARCHIE-260", "ARCHIE-300"])
        self.assertEqual(stats["examples"][0]["handling"], None)
        self.assertEqual(cleared.json()["marked"], 1)
        self.assertEqual(list(RuleHandling.objects.values_list("message_id", flat=True)), ["older-a0"])
        self.assertEqual(ConversationHandling.objects.get(conversation_id="older").status, "fixed")
        self.assertFalse(ConversationHandling.objects.filter(conversation_id="pending").exists())
        self.assertEqual(bad.status_code, 422)

    def post_json(self, url: str, payload: dict):
        return self.client.post(url, data=json.dumps(payload), content_type="application/json")

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


def make_swarm_event(message_id: str, sender: str, kind: str, minutes_ago: int, **extra):
    from archie_web.swarm_journal.models import SwarmEvent

    return SwarmEvent.objects.create(
        message_id=message_id,
        run_id=extra.pop("run_id", "run-s"),
        created_at=timezone.now() - timedelta(minutes=minutes_ago),
        sender=sender,
        kind=kind,
        text=extra.pop("text", f"{sender} {kind}"),
        **extra,
    )


def swarm_evaluation(message_id: str, grades: dict[str, str]) -> dict:
    return {
        "run_id": "run1",
        "message_id": message_id,
        "agent_id": "light",
        "grade": "red" if "red" in grades.values() else "green",
        "rules": [
            {"spec": key.split(":")[0], "rule_id": key.split(":")[1], "text": key, "grade": grade}
            for key, grade in grades.items()
        ],
        "spec_versions": {"swarm_base": "v1"},
        "judge_model": "~typesafe/jev-latest",
        "evaluated_at": NOW,
    }


@mock.patch.object(eval_views, "EVAL_API_TOKEN", TOKEN)
class SwarmMonitoringTest(TestCase):
    """Swarm agent messages judged by the swarm specs (ARCHIE-297)."""

    auth = {"HTTP_AUTHORIZATION": f"Bearer {TOKEN}"}

    def setUp(self):
        make_swarm_event("s-user", "user", "user", 30, text="@light выключи торшер")
        make_swarm_event("s-light", "light", "action", 29, reply_to="s-user", mentions=[])
        make_swarm_event("s-check", "home", "check", 20)
        make_swarm_event("s-system", "system", "system", 10)

    def test_pending_lists_agent_messages_with_trigger_and_history(self):
        batch = self.client.get(reverse("chat_monitoring_swarm_pending"), **self.auth).json()
        records = batch["records"]
        self.assertEqual([r["message"]["message_id"] for r in records], ["s-light", "s-check"])
        self.assertEqual(records[0]["trigger"]["message_id"], "s-user")
        self.assertEqual([m["message_id"] for m in records[1]["history"]], ["s-user", "s-light"])

    def test_ingest_stores_evaluation_and_removes_it_from_pending(self):
        response = self.client.post(
            reverse("chat_monitoring_ingest_swarm_evaluation"),
            data=json.dumps(swarm_evaluation("s-light", {"swarm_base:swarm_reply_short": "red"})),
            content_type="application/json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200)
        batch = self.client.get(reverse("chat_monitoring_swarm_pending"), **self.auth).json()
        self.assertEqual([r["message"]["message_id"] for r in batch["records"]], ["s-check"])

    def test_ingest_of_unknown_message_is_404(self):
        response = self.client.post(
            reverse("chat_monitoring_ingest_swarm_evaluation"),
            data=json.dumps(swarm_evaluation("nope", {})),
            content_type="application/json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 404)

    def test_rule_stats_and_rule_handling_cover_swarm_rules(self):
        from archie_web.chat_monitoring import swarm
        from archie_web.chat_monitoring.models import SwarmRuleHandling

        swarm.store_evaluation(
            swarm.SwarmTurnEvaluation.model_validate(
                swarm_evaluation("s-light", {"swarm_base:swarm_reply_short": "red"})
            )
        )
        swarm.store_evaluation(
            swarm.SwarmTurnEvaluation.model_validate(
                swarm_evaluation("s-check", {"swarm_base:swarm_reply_short": "green"})
            )
        )
        user = User.objects.create_user("niko")
        self.client.force_login(user)
        stats = self.client.get(reverse("chat_monitoring_rules")).json()
        rule = next(r for r in stats["rules"] if r["key"] == "swarm_base:swarm_reply_short")
        self.assertEqual((rule["red"], rule["green"], stats["swarm_turns"]), (1, 1, 2))
        self.assertEqual(rule["examples"][0]["agent_id"], "light")
        self.assertEqual(rule["handling"]["none"], 1)

        marked = self.client.post(
            reverse("chat_monitoring_rule_handling"),
            data=json.dumps({"rule": "swarm_base:swarm_reply_short", "status": "fixed", "jira_key": "ARCHIE-297"}),
            content_type="application/json",
        ).json()
        self.assertEqual(marked["marked"], 1)
        self.assertEqual(
            list(SwarmRuleHandling.objects.values_list("event_id", "status", "jira_key")),
            [("s-light", "fixed", "ARCHIE-297")],
        )
        stats = self.client.get(reverse("chat_monitoring_rules")).json()
        rule = next(r for r in stats["rules"] if r["key"] == "swarm_base:swarm_reply_short")
        self.assertEqual(rule["handling"]["fixed"], 1)
