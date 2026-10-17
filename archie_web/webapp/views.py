import json
import logging
import os

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.http import require_http_methods

from archie_web.weather.services import WeatherService

from .models import UserProfile

logger = logging.getLogger(__name__)

AI_AGENT_URL = os.getenv("AI_AGENT_URL", "http://localhost:8005")
AI_AGENT_URL_BROWSER = os.getenv("AI_AGENT_URL_BROWSER", "ws://localhost:8005")


class LoginPageView(View):
    def get(self, request):
        if request.user.is_authenticated:
            return redirect("/")
        return render(request, "webapp/login.html")

    def post(self, request):
        username = request.POST.get("username", "")
        password = request.POST.get("password", "")
        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            logger.info(f"login_view_001: User \033[34m{username}\033[0m logged in")
            return redirect("/")
        logger.info(
            f"login_view_002: Failed login attempt for \033[33m{username}\033[0m"
        )
        return render(
            request, "webapp/login.html", {"error": "Неверный логин или пароль"}
        )


@require_http_methods(["POST"])
@login_required
def logout_view(request):
    username = request.user.username
    logout(request)
    logger.info(f"logout_view_001: User \033[34m{username}\033[0m logged out")
    return redirect("/login/")


@method_decorator(login_required, name="dispatch")
class IndexView(View):
    def get(self, request, conversation_id=None):
        weather_service = WeatherService()
        weather_data = weather_service.get_bad_mergentheim_weather()
        forecast_data = weather_service.get_bad_mergentheim_forecast()
        user_name = request.user.profile.user_name
        context = {
            "weather": weather_data,
            "forecast": forecast_data,
            "user_name": user_name,
            "ai_agent_ws_url": AI_AGENT_URL_BROWSER,
        }
        return render(request, "webapp/index.html", context)


@require_http_methods(["GET"])
@login_required
def get_user_profile(request):
    """Get current user's profile"""
    try:
        profile = request.user.profile
        data = {
            "user_name": profile.user_name,
            "persona": profile.persona,
            "default_city": profile.default_city,
            "default_country": profile.default_country,
            "user_timezone": profile.user_timezone,
            "measurement_units": profile.measurement_units,
            "currency": profile.currency,
            "date_format": profile.date_format,
            "time_format": profile.time_format,
            "commercial_holidays": profile.commercial_holidays,
            "commercial_check_open_now": profile.commercial_check_open_now,
            "transport_preferences": profile.transport_preferences or [],
            "cuisine_preferences": profile.cuisine_preferences or [],
        }
        return JsonResponse(data)
    except UserProfile.DoesNotExist:
        return JsonResponse({"error": "Profile not found"}, status=404)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@require_http_methods(["POST"])
@login_required
def update_user_profile(request):
    """Update current user's profile"""
    try:
        profile = request.user.profile
        data = json.loads(request.body)

        # Update fields if provided
        if "user_name" in data:
            profile.user_name = data["user_name"]
        if "persona" in data:
            profile.persona = data["persona"]
        if "default_city" in data:
            profile.default_city = data["default_city"]
        if "default_country" in data:
            profile.default_country = data["default_country"]
        if "user_timezone" in data:
            profile.user_timezone = data["user_timezone"]
        if "measurement_units" in data:
            profile.measurement_units = data["measurement_units"]
        if "currency" in data:
            profile.currency = data["currency"]
        if "date_format" in data:
            profile.date_format = data["date_format"]
        if "time_format" in data:
            profile.time_format = data["time_format"]
        if "commercial_holidays" in data:
            profile.commercial_holidays = data["commercial_holidays"]
        if "commercial_check_open_now" in data:
            profile.commercial_check_open_now = data["commercial_check_open_now"]
        if "transport_preferences" in data:
            profile.transport_preferences = data["transport_preferences"]
        if "cuisine_preferences" in data:
            profile.cuisine_preferences = data["cuisine_preferences"]

        profile.save()

        return JsonResponse({"message": "Profile updated successfully"})
    except UserProfile.DoesNotExist:
        return JsonResponse({"error": "Profile not found"}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@require_http_methods(["GET"])
def get_profile_choices(request):
    """Get available choices for profile fields"""
    choices = {
        "persona": [
            {"value": choice[0], "label": choice[1]}
            for choice in UserProfile.PERSONA_CHOICES
        ],
        "currency": [
            {"value": choice[0], "label": choice[1]}
            for choice in UserProfile.CURRENCY_CHOICES
        ],
        "time_format": [
            {"value": choice[0], "label": choice[1]}
            for choice in UserProfile.TIME_FORMAT_CHOICES
        ],
    }
    return JsonResponse(choices)
