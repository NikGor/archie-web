from django.core.management.base import BaseCommand

from archie_web.ha_mcp.services import HomeAssistantMCPClient


class Command(BaseCommand):
    help = "Dump the Home Assistant MCP server's tools/list and GetLiveContext output for debugging"

    def handle(self, *args, **options):
        client = HomeAssistantMCPClient()

        self.stdout.write(f"MCP URL: {client.url}")
        self.stdout.write(f"Token set: {bool(client.token)}")

        self.stdout.write("\n--- tools/list ---")
        tools_result = client.list_tools()
        if tools_result is None:
            self.stdout.write(self.style.ERROR("Failed to list tools"))
        else:
            for tool in tools_result.tools:
                self.stdout.write(f"- {tool.name}: {tool.description}")

        self.stdout.write("\n--- GetLiveContext (raw text) ---")
        context = client.get_live_context()
        self.stdout.write(context or self.style.ERROR("(empty)"))

        self.stdout.write("\n--- Parsed light entities ---")
        self.stdout.write(str(client.get_domain_entities("light")))

        self.stdout.write("\n--- Parsed climate entities ---")
        self.stdout.write(str(client.get_domain_entities("climate")))
