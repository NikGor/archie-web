import logging

from archie_shared.ui.models import (AssistantButton, ClimateWidget,
                                     RadiatorState, TemperatureSensorState)
from django.http import JsonResponse
from django.views import View

from archie_web.ha_mcp.services import HomeAssistantMCPClient, to_float

logger = logging.getLogger(__name__)

INACTIVE_STATES = (None, "off", "unknown", "unavailable")

CLIMATE_MODE_MAP = {"heat": "heat", "auto": "auto", "eco": "eco"}

QUICK_ACTIONS = [
    AssistantButton(
        text="Eco mode",
        style="primary",
        icon="leaf",
        assistant_request="Включи эко режим отопления",
    ),
    AssistantButton(
        text="Warm up home",
        style="secondary",
        icon="flame",
        assistant_request="Прогрей весь дом до 23 градусов",
    ),
]


def _clamp(value, low, high):
    """Keep a raw HA reading inside the widget model's allowed range.

    Home Assistant can report values outside the tidy bounds the widget
    models declare (a mis-configured TRV setpoint, a humidity spike above
    100%). Without clamping those trip Pydantic validation and 500 the whole
    endpoint, so pin them to the range instead of failing the panel.
    """
    return max(low, min(high, value))


def _radiator_mode(state):
    if state in INACTIVE_STATES:
        return "off"
    return CLIMATE_MODE_MAP.get(state, "auto")


def _sensor_color(temperature):
    if temperature is None:
        return "gray"
    if temperature < 18:
        return "blue"
    if temperature > 26:
        return "red"
    return "green"


def _build_radiators(entities):
    radiators = []
    for i, entity in enumerate(entities):
        state = entity.get("state")
        is_on = state not in INACTIVE_STATES
        attrs = entity.get("attributes", {})
        target_temp = to_float(attrs.get("temperature"))
        radiators.append(
            RadiatorState(
                device_id=entity.get("entity_id") or f"radiator_{i}",
                name=entity.get("name") or "Radiator",
                room=entity.get("area") or "",
                is_on=is_on,
                target_temp=(
                    _clamp(target_temp, 5.0, 35.0) if target_temp is not None else 20.0
                ),
                current_temp=to_float(attrs.get("current_temperature")),
                mode=_radiator_mode(state),
                icon="heater",
                color="red" if is_on else "gray",
            )
        )
    return radiators


def _build_sensors(entities):
    """Pair up temperature/humidity readings per room.

    A room can have several distinct physical sensors, each exposing a
    temperature entity and a humidity entity — collapsing everything to a
    single area-wide dict would silently drop all but the last reading of
    each class, so temps/humidities are kept as parallel per-area lists and
    zipped in encounter order instead.
    """
    readings_by_area = {}
    for entity in entities:
        area = entity.get("area")
        device_class = entity.get("attributes", {}).get("device_class")
        if not area or device_class not in ("temperature", "humidity"):
            continue
        value = to_float(entity.get("state"))
        if value is None:
            continue
        name = entity.get("name") or ""
        readings_by_area.setdefault(area, {"temperature": [], "humidity": []})[
            device_class
        ].append((name, value))

    sensors = []
    for area, readings in readings_by_area.items():
        temps = readings["temperature"]
        humidities = readings["humidity"]
        pair_count = min(len(temps), len(humidities))
        for i in range(pair_count):
            name, temperature = temps[i]
            _, humidity = humidities[i]
            label = f"Sensor {area}" if pair_count == 1 else f"{name or area} ({area})"
            sensors.append(
                TemperatureSensorState(
                    device_id=f"sensor_{area}_{i}",
                    name=label,
                    room=area,
                    temperature=temperature,
                    humidity=_clamp(humidity, 0.0, 100.0),
                    icon="thermometer",
                    color=_sensor_color(temperature),
                )
            )
    return sensors


class ClimateStatusAPIView(View):
    """Live climate device status, read directly from Home Assistant via MCP.

    Display-only: no device control, no caching layer — every request
    re-fetches current state so the panel never shows stale data.
    """

    def get(self, request, *args, **kwargs):
        logger.info("climate_api_views_001: Fetching climate widget data via MCP")

        client = HomeAssistantMCPClient()
        climate_entities = client.get_domain_entities("climate")
        sensor_entities = client.get_domain_entities("sensor")

        radiators = _build_radiators(climate_entities)
        sensors = _build_sensors(sensor_entities)

        logger.info(
            f"climate_api_views_002: Built {len(radiators)} radiators, "
            f"{len(sensors)} sensors from MCP live context"
        )

        temps = [s.temperature for s in sensors] or [
            r.current_temp for r in radiators if r.current_temp is not None
        ]
        humidities = [s.humidity for s in sensors]
        average_temp = round(sum(temps) / len(temps), 1) if temps else 0.0
        average_humidity = (
            round(sum(humidities) / len(humidities), 1) if humidities else 0.0
        )

        widget = ClimateWidget(
            title="Climate",
            subtitle=f"average {average_temp:.1f}°C, humidity {average_humidity:.0f}%",
            average_temp=average_temp,
            average_humidity=average_humidity,
            radiators=radiators,
            sensors=sensors,
            quick_actions=QUICK_ACTIONS,
        )

        return JsonResponse({"success": True, **widget.model_dump()})
