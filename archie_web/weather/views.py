import logging

from django.contrib import messages
from django.http import JsonResponse
from django.shortcuts import render
from django.views import View

from .services import WeatherService

logger = logging.getLogger(__name__)


class WeatherView(View):
    """View for displaying weather information"""

    def get(self, request):
        logger.info("=== STEP 1: Weather Request ===")
        logger.info(
            "weather_views_001: Fetching weather data for \033[36mBad Mergentheim\033[0m"
        )

        weather_service = WeatherService()
        weather_data = weather_service.get_bad_mergentheim_weather()

        context = {
            "weather": weather_data,
            "city_name": "Bad Mergentheim",
            "country_name": "Germany",
        }

        if weather_data:
            logger.info(
                "weather_views_002: Weather data \033[32msuccessfully\033[0m retrieved"
            )
        else:
            logger.error(
                "weather_views_error_001: \033[31mWeather data fetch failed\033[0m"
            )
            messages.warning(
                request,
                "Не удалось получить данные о погоде. Проверьте настройки API ключа.",
            )

        return render(request, "weather/weather.html", context)


class WeatherAPIView(View):
    """API view for weather data (JSON response)"""

    def get(self, request):
        logger.info("=== STEP 1: Weather API Request ===")
        logger.info(
            "weather_api_001: API request for \033[36mBad Mergentheim\033[0m weather"
        )

        weather_service = WeatherService()
        weather_data = weather_service.get_bad_mergentheim_weather()

        if weather_data:
            logger.info("weather_api_002: API response \033[32msuccessful\033[0m")
            return JsonResponse({"success": True, "data": weather_data})
        else:
            logger.error(
                "weather_api_error_001: \033[31mAPI request failed - no weather data\033[0m"
            )
            return JsonResponse(
                {"success": False, "error": "Unable to fetch weather data"}, status=503
            )
