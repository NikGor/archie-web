from django.urls import path

from . import views

app_name = "camera"

urlpatterns = [
    path("", views.camera_view, name="camera"),
    path("feed/", views.video_feed, name="video_feed"),
    path("api/", views.camera_api, name="camera_api"),
]
