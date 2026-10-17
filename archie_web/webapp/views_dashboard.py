import json
import logging

from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

logger = logging.getLogger(__name__)


DEFAULT_QUICK_ACTIONS = [
    {
        "type": "assistant_button",
        "text": "Create a jazz bar vibe",
        "style": "primary",
        "icon": "music",
        "assistant_request": "Создать атмосферу джазового бара",
    },
    {
        "type": "assistant_button",
        "text": "Plan tomorrow",
        "style": "secondary",
        "icon": "calendar-days",
        "assistant_request": "Помоги спланировать завтрашний день",
    },
    {
        "type": "assistant_button",
        "text": "Football scores today",
        "style": "secondary",
        "icon": "trophy",
        "assistant_request": "Покажи результаты футбольных матчей сегодня",
    },
]


def _tile_label(room, name):
    """'Room: Name' for a device tooltip, skipping the room prefix when the
    name already contains it (so 'Коридор Лампа 1' / 'Sensor Bedroom' don't
    get a redundant double room)."""
    room = (room or "").strip()
    name = (name or "").strip()
    if room and name and room.lower() not in name.lower():
        return f"{room}: {name}"
    return name or room or "Device"


def _static_tile(tile_type, title, subtitle, icon):
    """A non-device dashboard tile with neutral styling."""
    return {
        "type": tile_type,
        "title": title,
        "subtitle": subtitle,
        "icon": icon,
        "status_color": "gray",
        "quick_actions": None,
        "devices": None,
    }


def _live_light_tile():
    """Build the Light dashboard tile live from Home Assistant via MCP."""
    from archie_web.ha_mcp.services import HomeAssistantMCPClient
    from archie_web.light.api_views import _build_light_devices

    try:
        entities = HomeAssistantMCPClient().get_domain_entities("light")
        devices = _build_light_devices(entities)
    except Exception as e:
        logger.error(f"dashboard_light_error: Failed to read lights via MCP: {e}")
        devices = []

    on_count = sum(1 for d in devices if d.is_on)
    total = len(devices)
    tiles = [
        {
            "name": d.name,
            "icon": d.icon,
            "color": "yellow" if d.is_on else "gray",
            "variant": "solid" if d.is_on else "outline",
            "tooltip": (
                f"{_tile_label(d.room, d.name)} — On, {d.brightness}%"
                if d.is_on
                else f"{_tile_label(d.room, d.name)} — Off"
            ),
        }
        for d in devices
    ]
    return {
        "type": "light",
        "title": "Light",
        "subtitle": f"{on_count} of {total} on" if total else "No devices",
        "icon": "lightbulb",
        "status_color": "orange" if on_count > 0 else "gray",
        "quick_actions": None,
        "devices": tiles or None,
    }


def _live_climate_tile():
    """Build the Climate dashboard tile live from Home Assistant via MCP."""
    from archie_web.climate.api_views import (_build_radiators,
                                                 _build_sensors)
    from archie_web.ha_mcp.services import HomeAssistantMCPClient

    try:
        client = HomeAssistantMCPClient()
        radiators = _build_radiators(client.get_domain_entities("climate"))
        sensors = _build_sensors(client.get_domain_entities("sensor"))
    except Exception as e:
        logger.error(f"dashboard_climate_error: Failed to read climate via MCP: {e}")
        radiators, sensors = [], []

    temps = [s.temperature for s in sensors] or [
        r.current_temp for r in radiators if r.current_temp is not None
    ]
    humidities = [s.humidity for s in sensors]
    avg_temp = round(sum(temps) / len(temps), 1) if temps else 0.0
    avg_hum = round(sum(humidities) / len(humidities)) if humidities else 0
    has_data = bool(temps)

    tiles = [
        {
            "name": s.name,
            "icon": s.icon,
            "color": s.color,
            "variant": "solid",
            "tooltip": f"{_tile_label(s.room, s.name)} — {s.temperature}°C, {s.humidity}%",
        }
        for s in sensors
    ]
    return {
        "type": "climate",
        "title": "Climate",
        "subtitle": (
            f"average {avg_temp:.1f}°C, humidity {avg_hum}%" if has_data else "No data"
        ),
        "icon": "thermometer",
        "status_color": "green" if has_data else "gray",
        "quick_actions": None,
        "devices": tiles or None,
    }


def _default_dashboard():
    """Full default dashboard: live light/climate tiles + neutral placeholders."""
    return {
        "type": "dashboard",
        "light": _live_light_tile(),
        "climate": _live_climate_tile(),
        "music": _static_tile("music", "Music", "No playback", "music"),
        "documents": _static_tile(
            "documents", "Documents", "No new documents", "file-search"
        ),
        "apps": _static_tile("apps", "Apps", "AI-generated utilities", "grid-3x3"),
        "settings": _static_tile("settings", "Settings", "Configuration", "settings"),
        "quick_actions": DEFAULT_QUICK_ACTIONS,
    }


def add_cors_headers(response):
    """Add CORS headers to response"""
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def dashboard_action(request):
    """
    Handle dashboard button clicks:
    1. Send request to AI agent
    2. Save full Dashboard response to Redis under smarthome_dashboard
    3. Return updated Dashboard to frontend (light/climate refreshed live)
    """
    logger.info("dashboard_001: Processing dashboard action request")

    if request.method == "OPTIONS":
        response = HttpResponse()
        return add_cors_headers(response)

    try:
        data = json.loads(request.body)
        user_name = data.get("user_name", "Niko")
        assistant_request = data.get("assistant_request")

        if not assistant_request:
            raise ValueError("assistant_request is required")

        logger.info(
            f"dashboard_002: User \033[36m{user_name}\033[0m requested: \033[33m{assistant_request}\033[0m"
        )

        from archie_web.ai_assistant.views import proxy_chat

        # Build ChatRequest for AI agent
        chat_request = {
            "user_name": user_name,
            "response_format": "dashboard",
            "input": assistant_request,
            "model": "gpt-4.1",
            "conversation_id": None,
            "previous_message_id": None,
        }

        from django.test import RequestFactory

        factory = RequestFactory()
        chat_request_obj = factory.post(
            "/ai-assistant/api/chat/",
            data=json.dumps(chat_request),
            content_type="application/json",
        )

        logger.info("dashboard_003: Proxying to ai_assistant.proxy_chat")
        response = proxy_chat(chat_request_obj)

        response_data = json.loads(response.content)
        content = response_data.get("content", {})
        dashboard = content.get("dashboard")

        if not dashboard:
            logger.error("dashboard_error_001: No dashboard in AI response")
            raise ValueError("AI agent did not return dashboard")

        # Save full Dashboard to Redis
        from archie_web.redis_client import redis_client

        redis_client.update_user_state(
            user_name, {"smarthome_dashboard": dashboard}, ttl=None
        )
        logger.info(
            f"dashboard_004: Saved AI dashboard to Redis for user \033[36m{user_name}\033[0m"
        )

        # Device tiles are always shown live, regardless of what the AI returned
        dashboard["light"] = _live_light_tile()
        dashboard["climate"] = _live_climate_tile()

        json_response = JsonResponse(dashboard)
        return add_cors_headers(json_response)

    except Exception as e:
        logger.error(f"dashboard_error_002: Failed to process dashboard action: {e}")
        error_response = JsonResponse({"error": str(e)}, status=500)
        return add_cors_headers(error_response)


@csrf_exempt
@require_http_methods(["GET", "OPTIONS"])
def dashboard_initial(request):
    """
    Get dashboard state:
    - Non-device tiles come from the AI-saved dashboard in Redis if present,
      otherwise from neutral defaults.
    - Light and Climate tiles are always read live from Home Assistant via MCP,
      so they never depend on a cache and never go stale.
    """
    logger.info("dashboard_005: Building dashboard (live light/climate)")

    if request.method == "OPTIONS":
        response = HttpResponse()
        return add_cors_headers(response)

    try:
        user_name = request.GET.get("user_name", "Niko")

        from archie_web.redis_client import redis_client

        user_state_obj = redis_client.get_user_state_by_name(user_name)
        saved_dashboard = None
        if user_state_obj:
            saved_dashboard = user_state_obj.model_dump().get("smarthome_dashboard")

        dashboard = saved_dashboard if saved_dashboard else _default_dashboard()

        # Always refresh device tiles from live MCP state
        dashboard["light"] = _live_light_tile()
        dashboard["climate"] = _live_climate_tile()

        logger.info(
            f"dashboard_007: Returning dashboard for user \033[36m{user_name}\033[0m"
        )
        json_response = JsonResponse(dashboard)
        return add_cors_headers(json_response)

    except Exception as e:
        logger.error(f"dashboard_error_004: Failed to build dashboard: {e}")
        json_response = JsonResponse(_default_dashboard())
        return add_cors_headers(json_response)
