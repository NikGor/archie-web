import json
import logging

from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.views.generic import DetailView, ListView, TemplateView

from .light_controller import light_controller
from .models import LightDevice

logger = logging.getLogger(__name__)


class LightDashboardView(TemplateView):
    template_name = "light/dashboard.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        lamp_ips = ["192.168.0.35", "192.168.0.226", "192.168.0.20"]
        devices = []

        for ip in lamp_ips:
            try:
                from yeelight import Bulb

                bulb = Bulb(ip)
                properties = bulb.get_properties()

                from .light_controller import YeelightDevice

                device = YeelightDevice(ip, properties=properties)
                device.name = f"Yeelight {ip.split('.')[-1]}"
                device.id = f"Yeelight_{ip.split('.')[-1]}"
                devices.append(device)

            except Exception as e:
                logger.error(
                    f"light_views_001: \033[31mConnection failed to \033[36m{ip}\033[31m: {str(e)}\033[0m"
                )
                try:
                    from .light_controller import YeelightDevice

                    device = YeelightDevice(
                        ip,
                        properties={"power": "off", "bright": 0, "ct": 4000, "rgb": 0},
                    )
                    device.name = f"Yeelight {ip.split('.')[-1]} (unavailable)"
                    device.id = f"Yeelight_{ip.split('.')[-1]}"
                    device._connected = False
                    devices.append(device)
                except Exception as inner_e:
                    logger.error(
                        f"light_views_002: \033[31mFallback device creation failed for \033[36m{ip}\033[31m: {str(inner_e)}\033[0m"
                    )

        try:
            context.update(
                {
                    "devices": devices,
                    "discovered_count": len(
                        [d for d in devices if getattr(d, "_connected", True)]
                    ),
                    "total_devices": len(devices),
                    "page_title": "Управление освещением",
                }
            )
        except Exception as e:
            logger.error(
                f"light_views_003: \033[31mContext update failed in LightDashboardView: {str(e)}\033[0m"
            )
        return context


class DeviceListView(TemplateView):
    template_name = "light/device_list.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        try:
            light_controller.discover_devices(timeout=3)
            devices = light_controller.get_all_devices()
            context.update(
                {"devices": devices, "page_title": "Найденные устройства Yeelight"}
            )
        except Exception as e:
            logger.error(
                f"light_views_004: \033[31mDeviceListView context error: {str(e)}\033[0m"
            )
            context["devices"] = []
            context["page_title"] = "Ошибка получения устройств"
        return context


class DeviceDetailView(TemplateView):
    template_name = "light/device_detail.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        device_id = kwargs.get("device_id")
        try:
            device = light_controller.get_device(device_id)
            if not device:
                context["error"] = "Устройство не найдено"
                return context
            device.update_properties()
            context.update(
                {"device": device, "page_title": f"Устройство: {device.name}"}
            )
        except Exception as e:
            logger.error(
                f"light_views_005: \033[31mDeviceDetailView context error for \033[36m{device_id}\033[31m: {str(e)}\033[0m"
            )
            context["error"] = "Ошибка получения информации об устройстве"
        return context


class ScanDevicesView(View):
    def get(self, request, *args, **kwargs):
        logger.info("=== STEP 2: Device Scan Request ===")
        try:
            discovered = light_controller.discover_devices(timeout=5)
            logger.info(
                f"light_views_006: Scan completed, found \033[33m{len(discovered)}\033[0m devices"
            )
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
            logger.error(f"light_views_007: \033[31mScan failed: {str(e)}\033[0m")
            return JsonResponse(
                {
                    "success": False,
                    "message": f"Ошибка сканирования устройств: {str(e)}",
                },
                status=500,
            )


# API Views были перенесены в api_views.py


class LightControlMixin:
    def get_device_by_id(self, device_id):
        return light_controller.get_device(device_id)

    def extract_ip_from_device_id(self, device_id):
        ip_suffix = device_id.split("_")[-1]
        return f"192.168.0.{ip_suffix}"

    def create_bulb_instance(self, ip):
        from yeelight import Bulb

        return Bulb(ip)


class DeviceToggleAPIViewWithMixin(LightControlMixin, View):
    @method_decorator(csrf_exempt)
    def dispatch(self, *args, **kwargs):
        return super().dispatch(*args, **kwargs)

    def post(self, request, device_id, *args, **kwargs):
        try:
            ip = self.extract_ip_from_device_id(device_id)
            bulb = self.create_bulb_instance(ip)

            properties = bulb.get_properties()
            current_state = properties.get("power") == "on"

            if current_state:
                bulb.turn_off()
                new_state = False
                message = f"Лампа {ip} выключена"
            else:
                bulb.turn_on()
                new_state = True
                message = f"Лампа {ip} включена"

            return JsonResponse(
                {"success": True, "is_on": new_state, "message": message}
            )

        except Exception as e:
            logger.error(
                f"light_views_008: \033[31mDevice toggle failed for \033[36m{device_id}\033[31m: {str(e)}\033[0m"
            )
            return JsonResponse(
                {
                    "success": False,
                    "message": f"Ошибка управления устройством {device_id}: {str(e)}",
                },
                status=500,
            )
