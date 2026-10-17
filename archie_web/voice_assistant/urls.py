from django.urls import path

from . import views

urlpatterns = [
    path("process/", views.process_voice_message, name="process_voice_message"),
    path("status/", views.voice_status, name="voice_status"),
]
