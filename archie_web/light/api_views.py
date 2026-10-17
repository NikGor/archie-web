import json
import logging
import re

from archie_shared.ui.models import (AssistantButton, IlluminanceSensorState,
                                     LightDeviceState, LightWidget)
from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from archie_web.ha_mcp.services import HomeAssistantMCPClient, to_float

from .exceptions import DeviceError
from .light_controller import light_controller
from .services import YeelightDevice

logger = logging.getLogger(__name__)

QUICK_ACTIONS = [
    AssistantButton(
        text="Turn on all",
        style="primary",
        icon="power",
        assistant_request="Включи весь свет",
    ),
    AssistantButton(
        text="Turn off all",
        style="secondary",
        icon="power-off",
        assistant_request="Выключи весь свет",
    ),
]


def _brightness_pct(attrs):
    """HA reports brightness on a 0-255 scale; widget expects 1-100%"""
    raw = attrs.get("brightness")
    if raw in (None, ""):
        return None
    try:
        value = round(float(raw) / 255 * 100)
    except (TypeError, ValueError):
        return None
    return max(1, min(100, value))


# HA color_mode values that mean the bulb is showing an RGB-ish colour rather
# than a white temperature. Everything else (color_temp, white, brightness,
# onoff) maps to the widget's "temperature" mode.
_HA_RGB_MODES = {"hs", "xy", "rgb", "rgbw", "rgbww"}


def _color_mode(attrs):
    return "color" if attrs.get("color_mode") in _HA_RGB_MODES else "temperature"


def _color_temp_kelvin(attrs):
    """Return colour temperature in Kelvin, clamped to the widget's 1700-6500K.

    HA exposes `color_temp_kelvin` on newer installs and legacy `color_temp`
    in mireds on older ones; accept either and convert mireds (1e6 / mireds).
    """
    kelvin = to_float(attrs.get("color_temp_kelvin"))
    if kelvin is None:
        mireds = to_float(attrs.get("color_temp"))
        if mireds and mireds > 0:
            kelvin = 1_000_000 / mireds
    if kelvin is None:
        return None
    return int(max(1700, min(6500, round(kelvin))))


def _rgb_hex(attrs):
    """HA exposes `rgb_color` as an (r, g, b) list; render it as #RRGGBB."""
    raw = attrs.get("rgb_color")
    if not raw:
        return None
    nums = re.findall(r"\d+", str(raw))
    if len(nums) < 3:
        return None
    r, g, b = (max(0, min(255, int(n))) for n in nums[:3])
    return f"#{r:02X}{g:02X}{b:02X}"


def _build_light_devices(entities):
    devices = []
    for i, entity in enumerate(entities):
        is_on = entity.get("state") == "on"
        attrs = entity.get("attributes", {})
        brightness = _brightness_pct(attrs) if is_on else None
        color_mode = _color_mode(attrs) if is_on else "temperature"
        devices.append(
            LightDeviceState(
                device_id=entity.get("entity_id") or f"light_{i}",
                name=entity.get("name") or entity.get("entity_id") or "Light",
                room=entity.get("area") or None,
                is_on=is_on,
                brightness=brightness or 1,
                color_mode=color_mode,
                color_temp=(
                    _color_temp_kelvin(attrs) if color_mode == "temperature" else None
                ),
                rgb_color=_rgb_hex(attrs) if color_mode == "color" else None,
                icon="lightbulb",
                color="yellow" if is_on else "gray",
            )
        )
    return devices


def _illuminance_color(lux):
    """Map an ambient-light reading to the widget's palette."""
    if lux is None:
        return "gray"
    if lux < 50:
        return "blue"
    if lux < 300:
        return "green"
    return "yellow"


def _build_light_sensors(entities):
    """Build ambient-light (illuminance) sensors from HA `sensor` entities.

    HA exposes lux sensors in the `sensor` domain with
    `device_class="illuminance"`; everything else in that domain (temperature,
    humidity, power, ...) is ignored here so the light panel only shows light
    readings.
    """
    sensors = []
    for i, entity in enumerate(entities):
        attrs = entity.get("attributes", {})
        if attrs.get("device_class") != "illuminance":
            continue
        lux = to_float(entity.get("state"))
        if lux is None:
            continue
        sensors.append(
            IlluminanceSensorState(
                device_id=entity.get("entity_id") or f"illuminance_{i}",
                name=entity.get("name") or "Light sensor",
                room=entity.get("area") or None,
                illuminance=max(0.0, lux),
                icon="sun",
                color=_illuminance_color(lux),
            )
        )
    return sensors


class LightWidgetStatusAPIView(View):
    """Live light device status, read directly from Home Assistant via MCP.

    Display-only: no device control, no caching layer — every request
    re-fetches current state so the panel never shows stale data.
    """

    def get(self, request, *args, **kwargs):
        logger.info("light_api_views_widget_001: Fetching light widget data via MCP")

        client = HomeAssistantMCPClient()
        entities = client.get_domain_entities("light")
        devices = _build_light_devices(entities)
        sensors = _build_light_sensors(client.get_domain_entities("sensor"))
        on_count = sum(1 for d in devices if d.is_on)

        logger.info(
            f"light_api_views_widget_002: Built {len(devices)} light devices "
            f"and {len(sensors)} illuminance sensors from MCP live context, "
            f"{on_count} on"
        )

        widget = LightWidget(
            title="Light",
            subtitle=f"{on_count} of {len(devices)} on",
            on_count=on_count,
            total_count=len(devices),
            devices=devices,
            sensors=sensors,
            quick_actions=QUICK_ACTIONS,
        )

        return JsonResponse({"success": True, **widget.model_dump()})


@method_decorator(csrf_exempt, name="dispatch")
class DeviceToggleAPIView(View):
    def post(self, request, device_id, *args, **kwargs):
        ip_suffix = device_id.split("_")[-1]
        ip = f"192.168.0.{ip_suffix}"
        device = YeelightDevice(ip)

        result = device.toggle()

        # Check if result is an error response
        if isinstance(result, dict) and not result.get("success", True):
            return JsonResponse(
                {
                    "success": False,
                    "message": f'Ошибка соединения с лампой {ip}: {result.get("error", "Неизвестная ошибка")}',
                },
                status=200,
            )  # Changed from 500 to 200

        # Result is a boolean (new state)
        new_state = result
        message = f"Лампа {ip} включена" if new_state else f"Лампа {ip} выключена"
        return JsonResponse({"success": True, "is_on": new_state, "message": message})


@method_decorator(csrf_exempt, name="dispatch")
class DeviceBrightnessAPIView(View):
    def post(self, request, device_id, *args, **kwargs):
        data = json.loads(request.body)
        brightness = int(data.get("brightness", 50))

        if not 1 <= brightness <= 100:
            return JsonResponse(
                {"success": False, "message": "Яркость должна быть от 1 до 100"},
                status=400,
            )

        ip_suffix = device_id.split("_")[-1]
        ip = f"192.168.0.{ip_suffix}"
        device = YeelightDevice(ip)

        try:
            device.set_brightness(brightness)
            return JsonResponse(
                {
                    "success": True,
                    "brightness": brightness,
                    "message": f"Яркость лампы {ip} установлена на {brightness}%",
                }
            )
        except DeviceError as e:
            return JsonResponse({"success": False, "message": str(e)}, status=500)


@method_decorator(csrf_exempt, name="dispatch")
class DeviceColorTempAPIView(View):
    def post(self, request, device_id, *args, **kwargs):
        data = json.loads(request.body)
        temp = int(data.get("temperature", 4000))

        if not 1700 <= temp <= 6500:
            return JsonResponse(
                {
                    "success": False,
                    "message": "Температура должна быть от 1700K до 6500K",
                },
                status=400,
            )

        ip_suffix = device_id.split("_")[-1]
        ip = f"192.168.0.{ip_suffix}"
        device = YeelightDevice(ip)

        try:
            device.set_color_temp(temp)
            return JsonResponse(
                {
                    "success": True,
                    "temperature": temp,
                    "message": f"Температура лампы {ip} установлена на {temp}K",
                }
            )
        except DeviceError as e:
            return JsonResponse({"success": False, "message": str(e)}, status=500)


@method_decorator(csrf_exempt, name="dispatch")
class DeviceRGBColorAPIView(View):
    def post(self, request, device_id, *args, **kwargs):
        data = json.loads(request.body)
        red = int(data.get("red", 255))
        green = int(data.get("green", 255))
        blue = int(data.get("blue", 255))

        if not all(0 <= c <= 255 for c in [red, green, blue]):
            return JsonResponse(
                {"success": False, "message": "RGB значения должны быть от 0 до 255"},
                status=400,
            )

        ip_suffix = device_id.split("_")[-1]
        ip = f"192.168.0.{ip_suffix}"
        device = YeelightDevice(ip)

        try:
            device.set_rgb(red, green, blue)
            return JsonResponse(
                {
                    "success": True,
                    "rgb": {"red": red, "green": green, "blue": blue},
                    "message": f"RGB цвет лампы {ip} установлен",
                }
            )
        except DeviceError as e:
            return JsonResponse({"success": False, "message": str(e)}, status=500)


class DeviceStatusAPIView(View):
    def get(self, request, device_id, *args, **kwargs):
        device = light_controller.get_device(device_id)
        if not device:
            return JsonResponse(
                {"success": False, "message": "Устройство не найдено"}, status=404
            )

        device.update_properties()
        return JsonResponse(
            {
                "success": True,
                "device_id": device_id,
                "name": device.name,
                "ip": device.ip,
                "model": device.model,
                "state": {
                    "is_on": device.is_on,
                    "brightness": device.brightness,
                    "color_temp": device.color_temp,
                    "rgb_color": device.rgb_color,
                },
                "properties": device.properties,
            }
        )


class AllDevicesStatusAPIView(View):
    # Known lamp IPs (same as in LightDashboardView)
    LAMP_IPS = ["192.168.0.35", "192.168.0.226", "192.168.0.20"]

    def get(self, request, *args, **kwargs):
        devices = light_controller.get_all_devices()

        # If no devices in controller, initialize from known IPs
        if not devices:
            for ip in self.LAMP_IPS:
                try:
                    from yeelight import Bulb

                    bulb = Bulb(ip)
                    properties = bulb.get_properties()
                    from .light_controller import YeelightDevice

                    device = YeelightDevice(ip, properties=properties)
                    device.name = f"Yeelight {ip.split('.')[-1]}"
                    device.id = f"Yeelight_{ip.split('.')[-1]}"
                    light_controller.devices[device.id] = device
                except Exception as e:
                    logger.error(
                        f"api_views_001: \033[31mConnection failed to \033[36m{ip}\033[31m: {str(e)}\033[0m"
                    )
                    from .light_controller import YeelightDevice

                    device = YeelightDevice(
                        ip,
                        properties={"power": "off", "bright": 0, "ct": 4000, "rgb": 0},
                    )
                    device.name = f"Yeelight {ip.split('.')[-1]}"
                    device.id = f"Yeelight_{ip.split('.')[-1]}"
                    device._connected = False
                    light_controller.devices[device.id] = device
            devices = light_controller.get_all_devices()
        else:
            light_controller.refresh_devices()

        devices_data = [
            {
                "id": device.id,
                "name": device.name,
                "ip": device.ip,
                "model": device.model,
                "is_on": device.is_on,
                "brightness": device.brightness,
                "color_temp": device.color_temp,
                "rgb_color": device.rgb_color,
                "last_seen": device.last_seen,
            }
            for device in devices
        ]

        return JsonResponse(
            {"success": True, "devices": devices_data, "total_count": len(devices)}
        )


class ScanDevicesView(View):
    def get(self, request, *args, **kwargs):
        try:
            discovered = light_controller.discover_devices(timeout=5)
            return JsonResponse(
                {
                    "success": True,
                    "discovered_count": len(discovered),
                    "devices": [
                        {
                            "id": device.id,
                            "name": device.name,
                            "ip": device.ip,
                            "model": device.model,
                            "is_on": device.is_on,
                        }
                        for device in discovered
                    ],
                }
            )
        except Exception as e:
            logger.error(f"Error in ScanDevicesView.get: {e}")
            return JsonResponse(
                {
                    "success": False,
                    "message": f"Ошибка сканирования устройств: {str(e)}",
                },
                status=500,
            )
