import logging
import os
from datetime import datetime, timedelta
from typing import Dict, Optional

import requests
from django.core.cache import cache

from .models import WeatherData

logger = logging.getLogger(__name__)


class WeatherService:
    """Service for fetching weather data from OpenWeatherMap API"""

    BASE_URL = "https://api.openweathermap.org/data/2.5/weather"
    FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast"
    CACHE_TIMEOUT = 600  # 10 minutes

    def __init__(self):
        self.api_key = os.getenv("OPENWEATHER_API_KEY")
        if not self.api_key:
            logger.warning(
                "OpenWeatherMap API key not found. Weather data will not be available."
            )

    def get_weather_data(self, city: str, country: str = "DE") -> Optional[Dict]:
        """
        Fetch weather data for a given city and country.
        First checks cache, then database, then API.
        """
        cache_key = f"weather_{city.replace(' ', '_')}_{country}"

        # Check cache first
        cached_data = cache.get(cache_key)
        if cached_data:
            return cached_data

        # Check database for recent data (within 10 minutes)
        try:
            weather_obj = WeatherData.objects.get(
                city__iexact=city, country__iexact=country
            )
            if weather_obj.updated_at > datetime.now().replace(
                tzinfo=weather_obj.updated_at.tzinfo
            ) - timedelta(minutes=10):
                weather_data = self._model_to_dict(weather_obj)
                cache.set(cache_key, weather_data, self.CACHE_TIMEOUT)
                return weather_data
        except WeatherData.DoesNotExist:
            pass

        # Fetch from API
        if self.api_key:
            api_data = self._fetch_from_api(city, country)
            if api_data:
                # Save to database
                weather_obj, created = WeatherData.objects.update_or_create(
                    city__iexact=city, country__iexact=country, defaults=api_data
                )

                weather_data = self._model_to_dict(weather_obj)
                cache.set(cache_key, weather_data, self.CACHE_TIMEOUT)
                return weather_data

        return None

    def _fetch_from_api(self, city: str, country: str) -> Optional[Dict]:
        """Fetch weather data from OpenWeatherMap API"""
        try:
            params = {
                "q": f"{city},{country}",
                "appid": self.api_key,
                "units": "metric",  # Celsius
                "lang": "en",
            }

            response = requests.get(self.BASE_URL, params=params, timeout=10)
            response.raise_for_status()

            data = response.json()

            return {
                "city": data["name"],
                "country": data["sys"]["country"],
                "temperature": data["main"]["temp"],
                "description": data["weather"][0]["description"].title(),
                "humidity": data["main"]["humidity"],
                "pressure": data["main"]["pressure"],
                "wind_speed": data["wind"].get("speed", 0),
                "icon": data["weather"][0]["icon"],
            }

        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching weather data from API: {e}")
            return None
        except (KeyError, ValueError) as e:
            logger.error(f"Error parsing weather API response: {e}")
            return None

    def _model_to_dict(self, weather_obj: WeatherData) -> Dict:
        """Convert WeatherData model to dictionary"""
        return {
            "city": weather_obj.city,
            "country": weather_obj.country,
            "temperature": weather_obj.temperature,
            "description": weather_obj.description,
            "humidity": weather_obj.humidity,
            "pressure": weather_obj.pressure,
            "wind_speed": weather_obj.wind_speed,
            "icon": weather_obj.icon,
            "last_updated": weather_obj.updated_at,
        }

    def get_weather_forecast(self, city: str, country: str = "DE") -> Optional[Dict]:
        """
        Fetch 5-day weather forecast for a given city and country.
        Returns tomorrow's forecast.
        """
        cache_key = f"forecast_{city.replace(' ', '_')}_{country}"

        # Check cache first
        cached_data = cache.get(cache_key)
        if cached_data:
            return cached_data

        # Fetch from API
        if self.api_key:
            forecast_data = self._fetch_forecast_from_api(city, country)
            if forecast_data:
                cache.set(cache_key, forecast_data, self.CACHE_TIMEOUT)
                return forecast_data

        return None

    def _fetch_forecast_from_api(self, city: str, country: str) -> Optional[Dict]:
        """Fetch weather forecast from OpenWeatherMap API"""
        try:
            params = {
                "q": f"{city},{country}",
                "appid": self.api_key,
                "units": "metric",  # Celsius
                "lang": "en",
            }

            response = requests.get(self.FORECAST_URL, params=params, timeout=10)
            response.raise_for_status()

            data = response.json()

            # Find tomorrow's forecast (around 12:00)
            tomorrow = datetime.now() + timedelta(days=1)
            tomorrow_date = tomorrow.strftime("%Y-%m-%d")

            tomorrow_forecast = None
            for forecast in data["list"]:
                forecast_date = datetime.fromtimestamp(forecast["dt"]).strftime(
                    "%Y-%m-%d"
                )
                forecast_time = datetime.fromtimestamp(forecast["dt"]).hour

                # Look for forecast around midday for tomorrow
                if forecast_date == tomorrow_date and 11 <= forecast_time <= 13:
                    tomorrow_forecast = forecast
                    break

            # If no midday forecast found, take the first forecast for tomorrow
            if not tomorrow_forecast:
                for forecast in data["list"]:
                    forecast_date = datetime.fromtimestamp(forecast["dt"]).strftime(
                        "%Y-%m-%d"
                    )
                    if forecast_date == tomorrow_date:
                        tomorrow_forecast = forecast
                        break

            if tomorrow_forecast:
                return {
                    "city": data["city"]["name"],
                    "country": data["city"]["country"],
                    "temperature": tomorrow_forecast["main"]["temp"],
                    "description": tomorrow_forecast["weather"][0][
                        "description"
                    ].title(),
                    "humidity": tomorrow_forecast["main"]["humidity"],
                    "pressure": tomorrow_forecast["main"]["pressure"],
                    "wind_speed": tomorrow_forecast["wind"].get("speed", 0),
                    "icon": tomorrow_forecast["weather"][0]["icon"],
                    "date": tomorrow_date,
                }

        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching forecast data from API: {e}")
            return None
        except (KeyError, ValueError) as e:
            logger.error(f"Error parsing forecast API response: {e}")
            return None

        return None

    def get_bad_mergentheim_weather(self) -> Optional[Dict]:
        """Get current weather specifically for Bad Mergentheim, Germany"""
        return self.get_weather_data("Bad Mergentheim", "DE")

    def get_bad_mergentheim_forecast(self) -> Optional[Dict]:
        """Get tomorrow's forecast specifically for Bad Mergentheim, Germany"""
        return self.get_weather_forecast("Bad Mergentheim", "DE")
