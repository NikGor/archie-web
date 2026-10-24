import json
from unittest import mock

from django.test import TestCase
from django.urls import reverse

from archie_web.prompt_evals import views as eval_views
from archie_web.swarm_journal.models import SwarmEvent

TOKEN = "test-token"
AUTH = {"HTTP_AUTHORIZATION": f"Bearer {TOKEN}"}
WINDOW = {"since": "2026-10-24T00:00:00+02:00", "until": "2026-10-25T00:00:00+02:00"}


def make_message(message_id: str, run_id: str, minute: int, **fields) -> dict:
    return {
        "message_id": message_id,
        "run_id": run_id,
        "created_at": f"2026-10-24T10:{minute:02d}:00+00:00",
        "sender": "calendar",
        "kind": "alert",
        "text": "Meeting at 11:00",
        **fields,
    }


@mock.patch.object(eval_views, "EVAL_API_TOKEN", TOKEN)
class SwarmJournalApiTests(TestCase):
    def ingest(self, messages: list[dict], **headers):
        return self.client.post(
            reverse("swarm_journal_ingest"),
            data=json.dumps({"messages": messages}),
            content_type="application/json",
            **headers,
        )

    def test_ingest_needs_service_token(self):
        response = self.ingest([make_message("1-0", "r1", 0)])
        self.assertEqual(response.status_code, 403)

    def test_ingest_is_idempotent_by_message_id(self):
        self.ingest([make_message("1-0", "r1", 0)], **AUTH)
        response = self.ingest([make_message("1-0", "r1", 0, text="changed")], **AUTH)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(SwarmEvent.objects.count(), 1)
        self.assertEqual(SwarmEvent.objects.get().text, "changed")

    def test_ingest_rejects_bad_message(self):
        response = self.ingest([{"message_id": "1-0"}], **AUTH)
        self.assertEqual(response.status_code, 422)

    def test_events_of_window_and_run(self):
        self.ingest(
            [
                make_message("1-0", "r1", 0),
                make_message("2-0", "r2", 5),
                {
                    **make_message("3-0", "r3", 0),
                    "created_at": "2026-10-23T10:00:00+00:00",
                },
            ],
            **AUTH,
        )
        response = self.client.get(reverse("swarm_journal_events"), WINDOW, **AUTH)
        ids = [e["message_id"] for e in response.json()["events"]]
        self.assertEqual(ids, ["1-0", "2-0"])
        response = self.client.get(
            reverse("swarm_journal_events"), {**WINDOW, "run_id": "r2"}, **AUTH
        )
        self.assertEqual([e["message_id"] for e in response.json()["events"]], ["2-0"])

    def test_events_need_window(self):
        response = self.client.get(reverse("swarm_journal_events"), **AUTH)
        self.assertEqual(response.status_code, 422)

    def test_runs_summary(self):
        voice = {
            "tool_name": "announce_tool",
            "arguments_json": "{}",
            "status": "error",
            "summary": "no voice listener",
        }
        self.ingest(
            [
                make_message("1-0", "r1", 0, usage={"model": "m", "total_cost": 0.01}),
                make_message(
                    "1-1",
                    "r1",
                    1,
                    sender="voice",
                    kind="report",
                    actions=[voice],
                    usage={"model": "m", "total_cost": 0.02},
                ),
            ],
            **AUTH,
        )
        runs = self.client.get(reverse("swarm_journal_runs"), WINDOW, **AUTH).json()[
            "runs"
        ]
        self.assertEqual(len(runs), 1)
        run = runs[0]
        self.assertEqual(run["trigger_sender"], "calendar")
        self.assertEqual(run["messages"], 2)
        self.assertEqual(run["failed_actions"], 1)
        self.assertAlmostEqual(run["total_cost"], 0.03)
        self.assertEqual(run["kinds"], {"alert": 1, "report": 1})
