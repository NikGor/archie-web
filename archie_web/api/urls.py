from django.urls import path

from .views import ChatView, UserStateView

urlpatterns = [
    path("chat", ChatView.as_view(), name="chat"),
    path("user/state/", UserStateView.as_view(), name="user-state"),
]
