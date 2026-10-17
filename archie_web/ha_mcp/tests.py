from django.test import SimpleTestCase

from archie_web.ha_mcp.services import resolve_tool_name


class ResolveToolNameTests(SimpleTestCase):
    def test_prefixed_name_is_resolved(self):
        tools = ["homeassistant__GetLiveContext", "intent__HassTurnOn"]
        self.assertEqual(
            resolve_tool_name("GetLiveContext", tools), "homeassistant__GetLiveContext"
        )

    def test_exact_name_is_kept(self):
        self.assertEqual(
            resolve_tool_name("GetLiveContext", ["GetLiveContext"]), "GetLiveContext"
        )

    def test_unknown_name_is_returned_as_is(self):
        self.assertEqual(resolve_tool_name("Missing", ["intent__HassTurnOn"]), "Missing")
