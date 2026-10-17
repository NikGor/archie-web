import asyncio
import json
import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def to_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def resolve_tool_name(name: str, tool_names: List[str]) -> str:
    """
    Map a bare tool name to the name the server exposes.

    Newer Home Assistant versions prefix tools with their domain
    (`homeassistant__GetLiveContext`, `intent__HassTurnOn`); older ones don't. # ARCHIE-214
    """
    if name in tool_names:
        return name
    return next((tool for tool in tool_names if tool.endswith(f"__{name}")), name)


class HomeAssistantMCPClient:
    """Client for the Home Assistant MCP Server (Streamable HTTP transport)"""

    def __init__(self):
        self.url = os.getenv(
            "HOMEASSISTANT_MCP_URL", "http://homeassistant.local:8123/api/mcp"
        )
        self.token = os.getenv("HOMEASSISTANT_MCP_TOKEN")
        if not self.token:
            logger.warning(
                "ha_mcp_services_001: HOMEASSISTANT_MCP_TOKEN not set. "
                "Home Assistant data will not be available."
            )

    async def _list_tools_async(self):
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        headers = {"Authorization": f"Bearer {self.token}"}
        async with streamablehttp_client(self.url, headers=headers) as (
            read,
            write,
            _,
        ):
            async with ClientSession(read, write) as session:
                await session.initialize()
                return await session.list_tools()

    async def _call_tool_async(self, name: str, arguments: Optional[dict]):
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        headers = {"Authorization": f"Bearer {self.token}"}
        async with streamablehttp_client(self.url, headers=headers) as (
            read,
            write,
            _,
        ):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                name = resolve_tool_name(name, [tool.name for tool in tools.tools])
                return await session.call_tool(name, arguments or {})

    def list_tools(self):
        """Return the raw tools/list response, or None on failure"""
        if not self.token:
            return None
        try:
            return asyncio.run(self._list_tools_async())
        except Exception as e:
            logger.error(f"ha_mcp_services_error_001: Failed to list MCP tools: {e}")
            return None

    def call_tool(self, name: str, arguments: Optional[dict] = None):
        """Call an MCP tool by name, returning the raw result or None on failure"""
        if not self.token:
            return None
        try:
            return asyncio.run(self._call_tool_async(name, arguments))
        except Exception as e:
            logger.error(
                f"ha_mcp_services_error_002: MCP tool call '{name}' failed: {e}"
            )
            return None

    def get_live_context(self) -> str:
        """Fetch the raw text of the GetLiveContext tool (exposed areas/entities/state)"""
        result = self.call_tool("GetLiveContext")
        if not result or not getattr(result, "content", None):
            return ""
        return "\n".join(
            block.text for block in result.content if hasattr(block, "text")
        )

    def _get_live_context_entities(self) -> List[Dict[str, Any]]:
        """
        Parse GetLiveContext into a list of entity dicts.

        The tool returns a JSON envelope (`{"success": true, "result": "..."}`)
        whose "result" is a YAML-like block list, one entry per entity, e.g.:
            - names: Торшер
              domain: light
              state: 'on'
              areas: Гостиная
              attributes:
                brightness: '3'
        """
        text = self.get_live_context()
        if not text:
            return []

        try:
            envelope = json.loads(text)
            if isinstance(envelope, dict) and "result" in envelope:
                text = envelope["result"]
        except (json.JSONDecodeError, TypeError):
            pass

        entities: List[Dict[str, Any]] = []
        current: Optional[Dict[str, Any]] = None
        in_attributes = False

        for raw_line in text.splitlines():
            if raw_line.startswith("- "):
                if current is not None:
                    entities.append(current)
                current = {"attributes": {}}
                in_attributes = False
                raw_line = raw_line[2:]

            if current is None:
                continue

            stripped = raw_line.strip()
            if not stripped:
                continue

            indent = len(raw_line) - len(raw_line.lstrip(" "))
            if stripped == "attributes:":
                in_attributes = True
                continue

            key, sep, value = stripped.partition(":")
            if not sep:
                continue
            key = key.strip()
            value = value.strip().strip("'\"")

            if in_attributes and indent >= 4:
                current["attributes"][key] = value
            else:
                in_attributes = False
                current[key] = value

        if current is not None:
            entities.append(current)

        return entities

    def get_domain_entities(self, domain: str) -> List[Dict[str, Any]]:
        """Return normalized entities of a given domain (e.g. "light", "climate")"""
        entities = []
        for entity in self._get_live_context_entities():
            if entity.get("domain") != domain:
                continue
            attrs = entity.get("attributes", {})
            name = entity.get("names")
            entities.append(
                {
                    "entity_id": name,
                    "name": name,
                    "state": entity.get("state"),
                    "area": entity.get("areas"),
                    "attributes": attrs,
                    "temperature": to_float(
                        attrs.get("current_temperature") or attrs.get("temperature")
                    ),
                    "brightness": to_float(attrs.get("brightness")),
                }
            )
        return entities
