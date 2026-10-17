from django.urls import path

from . import api_views, views

app_name = "light"

urlpatterns = [
    path("", views.LightDashboardView.as_view(), name="dashboard"),
    path("devices/", views.DeviceListView.as_view(), name="device_list"),
    path(
        "devices/<str:device_id>/",
        views.DeviceDetailView.as_view(),
        name="device_detail",
    ),
    path("scan/", views.ScanDevicesView.as_view(), name="scan_devices"),
    path(
        "api/device/<str:device_id>/toggle/",
        api_views.DeviceToggleAPIView.as_view(),
        name="api_device_toggle",
    ),
    path(
        "api/device/<str:device_id>/brightness/",
        api_views.DeviceBrightnessAPIView.as_view(),
        name="api_device_brightness",
    ),
    path(
        "api/device/<str:device_id>/temperature/",
        api_views.DeviceColorTempAPIView.as_view(),
        name="api_set_color_temp",
    ),
    path(
        "api/device/<str:device_id>/rgb/",
        api_views.DeviceRGBColorAPIView.as_view(),
        name="api_set_rgb_color",
    ),
    path(
        "api/device/<str:device_id>/status/",
        api_views.DeviceStatusAPIView.as_view(),
        name="api_device_status",
    ),
    path(
        "api/devices/status/",
        api_views.AllDevicesStatusAPIView.as_view(),
        name="api_all_devices_status",
    ),
    path(
        "api/widget/status/",
        api_views.LightWidgetStatusAPIView.as_view(),
        name="api_widget_status",
    ),
    path(
        "api/devices/scan/",
        api_views.ScanDevicesView.as_view(),
        name="api_scan_devices",
    ),
]
