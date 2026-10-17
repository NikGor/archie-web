from django.urls import path

from . import api_views, views

app_name = "spotify"

urlpatterns = [
    path("authorize/", views.SpotifyAuthorizeView.as_view(), name="authorize"),
    path("callback/", views.SpotifyCallbackView.as_view(), name="callback"),
    path("api/token/", api_views.SpotifyTokenAPIView.as_view(), name="api_token"),
    path("api/device/", api_views.SpotifyDeviceAPIView.as_view(), name="api_device"),
    path(
        "api/devices/",
        api_views.SpotifyDevicesAPIView.as_view(),
        name="api_devices",
    ),
    path("api/control/", api_views.SpotifyControlAPIView.as_view(), name="api_control"),
    path("api/status/", api_views.SpotifyStatusAPIView.as_view(), name="api_status"),
    path(
        "api/now-playing/",
        api_views.SpotifyNowPlayingAPIView.as_view(),
        name="api_now_playing",
    ),
    path("api/queue/", api_views.SpotifyQueueAPIView.as_view(), name="api_queue"),
]
