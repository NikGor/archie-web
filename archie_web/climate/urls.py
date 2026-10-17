from django.urls import path

from . import api_views

app_name = "climate"

urlpatterns = [
    path(
        "api/devices/status/",
        api_views.ClimateStatusAPIView.as_view(),
        name="api_devices_status",
    ),
]
