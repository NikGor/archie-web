import base64
import json
from types import SimpleNamespace
from unittest import mock

from django.test import TestCase
from django.urls import reverse

from . import live_session, views
from .models import Conversation, Message, MessageImage

PNG_B64 = base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode()


class MessageImageApiTests(TestCase):
    def setUp(self):
        self.conversation = Conversation.objects.create(
            conversation_id="conv-1", title="t"
        )
        self.message = Message.objects.create(
            message_id="msg-1",
            conversation=self.conversation,
            role="user",
            content={"content_format": "plain", "text": "hi"},
        )

    def _post(self, images, message_id="msg-1"):
        return self.client.post(
            reverse("message_images", args=[message_id]),
            data=json.dumps({"images": images}),
            content_type="application/json",
        )

    def test_store_and_serve_images_in_order(self):
        resp = self._post(
            [
                {"media_type": "image/png", "data": PNG_B64},
                {"media_type": "image/jpeg", "data": PNG_B64},
            ]
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["count"], 2)
        first = self.client.get(reverse("message_image", args=["msg-1", 0]))
        second = self.client.get(reverse("message_image", args=["msg-1", 1]))
        self.assertEqual(first["Content-Type"], "image/png")
        self.assertEqual(second["Content-Type"], "image/jpeg")
        self.assertEqual(first.content, base64.b64decode(PNG_B64))

    def test_resave_replaces_previous_images(self):
        self._post([{"media_type": "image/png", "data": PNG_B64}] * 3)
        self._post([{"media_type": "image/png", "data": PNG_B64}])
        self.assertEqual(MessageImage.objects.filter(message=self.message).count(), 1)

    def test_rejects_bad_input(self):
        ok = {"media_type": "image/png", "data": PNG_B64}
        self.assertEqual(self._post([]).status_code, 400)
        self.assertEqual(self._post([ok] * 5).status_code, 413)
        self.assertEqual(
            self._post([{"media_type": "image/svg+xml", "data": PNG_B64}]).status_code,
            400,
        )
        self.assertEqual(
            self._post([{"media_type": "image/png", "data": "!!notbase64"}]).status_code,
            400,
        )
        self.assertEqual(self._post([ok], message_id="nope").status_code, 404)

    def test_missing_image_is_404(self):
        resp = self.client.get(reverse("message_image", args=["msg-1", 0]))
        self.assertEqual(resp.status_code, 404)

    def test_conversation_messages_report_image_count(self):
        self._post([{"media_type": "image/png", "data": PNG_B64}] * 2)
        resp = self.client.get(
            reverse("proxy_conversation_messages", args=["conv-1"])
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        messages = body if isinstance(body, list) else body.get("messages", body)
        self.assertEqual(messages[0]["image_count"], 2)


class MessageFileApiTests(TestCase):
    def setUp(self):
        conversation = Conversation.objects.create(conversation_id="conv-f", title="t")
        self.message = Message.objects.create(
            message_id="msg-f",
            conversation=conversation,
            role="user",
            content={"content_format": "plain", "text": "hi"},
        )

    @staticmethod
    def _b64(raw):
        return base64.b64encode(raw).decode()

    def _post(self, files, message_id="msg-f"):
        return self.client.post(
            reverse("message_files", args=[message_id]),
            data=json.dumps({"files": files}),
            content_type="application/json",
        )

    def test_pdf_served_inline_with_name(self):
        pdf = b"%PDF-1.4 fake"
        self.assertEqual(
            self._post(
                [{"name": "Отчёт.pdf", "media_type": "application/pdf", "data": self._b64(pdf)}]
            ).status_code,
            200,
        )
        resp = self.client.get(reverse("message_file", args=["msg-f", 0]))
        self.assertEqual(resp["Content-Type"], "application/pdf")
        self.assertTrue(resp["Content-Disposition"].startswith("inline;"))
        self.assertIn("%D0%9E%D1%82%D1%87", resp["Content-Disposition"])
        self.assertEqual(resp.content, pdf)

    def test_html_is_never_served_inline(self):
        self._post(
            [{"name": "x.html", "media_type": "text/html", "data": self._b64(b"<script>1</script>")}]
        )
        resp = self.client.get(reverse("message_file", args=["msg-f", 0]))
        self.assertEqual(resp["Content-Type"], "application/octet-stream")
        self.assertTrue(resp["Content-Disposition"].startswith("attachment;"))
        self.assertEqual(resp["X-Content-Type-Options"], "nosniff")

    def test_fake_pdf_extension_is_not_trusted(self):
        self._post([{"name": "evil.pdf", "media_type": "application/pdf", "data": self._b64(b"<html>")}])
        resp = self.client.get(reverse("message_file", args=["msg-f", 0]))
        self.assertEqual(resp["Content-Type"], "application/octet-stream")

    def test_rejects_bad_input(self):
        ok = {"name": "a.txt", "media_type": "text/plain", "data": self._b64(b"x")}
        self.assertEqual(self._post([]).status_code, 400)
        self.assertEqual(self._post([ok] * 6).status_code, 413)
        self.assertEqual(self._post([{**ok, "name": ""}]).status_code, 400)
        self.assertEqual(self._post([{**ok, "data": "!!"}]).status_code, 400)
        self.assertEqual(self._post([ok], message_id="nope").status_code, 404)

    def test_listing_includes_file_metadata(self):
        self._post([{"name": "a.txt", "media_type": "text/plain", "data": self._b64(b"hello")}])
        resp = self.client.get(reverse("proxy_conversation_messages", args=["conv-f"]))
        body = resp.json()
        messages = body if isinstance(body, list) else body.get("messages", body)
        self.assertEqual(
            [(f["name"], f["size"]) for f in messages[0]["files"]], [("a.txt", 5)]
        )


class LiveTokenApiTests(TestCase):
    url = "/ai-assistant/api/live-token/"

    def _post(self, body):
        return self.client.post(
            self.url, data=json.dumps(body), content_type="application/json"
        )

    @mock.patch.object(live_session, "GEMINI_API_KEY", "")
    def test_503_without_api_key(self):
        self.assertEqual(self._post({}).status_code, 503)

    @mock.patch.object(live_session, "GEMINI_API_KEY", "test-key")
    @mock.patch.object(views, "redis_client")
    @mock.patch.object(live_session.genai, "Client")
    def test_token_locks_persona_voice_and_tool(self, client_cls, redis, *_):
        redis.get_user_state_by_name.return_value = SimpleNamespace(
            persona="bro", language="en"
        )
        create = client_cls.return_value.auth_tokens.create
        create.return_value = SimpleNamespace(name="auth_tokens/abc")

        resp = self._post({"user_name": "Niko"})

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["token"], "auth_tokens/abc")
        self.assertEqual(body["voice"], "Puck")
        self.assertIn("BidiGenerateContentConstrained", body["ws_url"])
        cfg = create.call_args.kwargs["config"]
        self.assertEqual(cfg["uses"], 1)
        constraints = cfg["live_connect_constraints"]
        self.assertEqual(constraints["model"], live_session.LIVE_MODEL)
        speech = constraints["config"]["speech_config"]
        self.assertEqual(speech["language_code"], "en-US")
        tool = constraints["config"]["tools"][0]["function_declarations"][0]
        self.assertEqual(tool["name"], live_session.ASK_ARCHIE_TOOL)

    @mock.patch.object(live_session, "GEMINI_API_KEY", "test-key")
    @mock.patch.object(live_session.genai, "Client")
    def test_502_on_upstream_error(self, client_cls):
        client_cls.return_value.auth_tokens.create.side_effect = RuntimeError("boom")
        self.assertEqual(self._post({}).status_code, 502)

    def test_language_code_mapping(self):
        self.assertEqual(live_session.language_code_for(None), "ru-RU")
        self.assertEqual(live_session.language_code_for("English"), "en-US")
        self.assertEqual(live_session.language_code_for("xx"), "ru-RU")
