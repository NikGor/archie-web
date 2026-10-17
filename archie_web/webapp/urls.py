from django.urls import path

from .views import (IndexView, LoginPageView, get_profile_choices,
                    get_user_profile, logout_view, update_user_profile)
from .views_dashboard import dashboard_action, dashboard_initial

urlpatterns = [
    path("", IndexView.as_view(), name="index"),
    # Deep-link to a specific chat (ChatGPT-style URL). Serves the same SPA;
    # the frontend reads the conversation id from the path and opens it.
    path("c/<str:conversation_id>/", IndexView.as_view(), name="chat"),
    path("login/", LoginPageView.as_view(), name="login"),
    path("logout/", logout_view, name="logout"),
    path("api/profile/", get_user_profile, name="get_user_profile"),
    path("api/profile/update/", update_user_profile, name="update_user_profile"),
    path("api/profile/choices/", get_profile_choices, name="get_profile_choices"),
    path("api/dashboard/", dashboard_initial, name="dashboard_initial"),
    path("api/dashboard/action/", dashboard_action, name="dashboard_action"),
]
