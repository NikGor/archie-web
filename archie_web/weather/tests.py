from unittest.mock import Mock, patch

from django.test import TestCase

from .models import WeatherData
from .services import WeatherService


class WeatherServiceTestCase(TestCase):
    def setUp(self):
        self.weather_service = WeatherService()

    def test_weather_data_model_creation(self):
        """Test WeatherData model creation"""
        weather = WeatherData.objects.create(
            city="Bad Mergentheim",
            country="DE",
            temperature=20.5,
            description="Clear sky",
            humidity=65,
            pressure=1013.25,
            wind_speed=3.2,
            icon="01d",
        )

        self.assertEqual(str(weather), "Bad Mergentheim, DE - 20.5°C")
        self.assertEqual(weather.city, "Bad Mergentheim")
        self.assertEqual(weather.country, "DE")

    @patch("archie_web.weather.services.requests.get")
    def test_weather_service_api_call(self, mock_get):
        """Test weather service API call"""
        # Mock API response
        mock_response = Mock()
        mock_response.json.return_value = {
            "name": "Bad Mergentheim",
            "sys": {"country": "DE"},
            "main": {"temp": 18.5, "humidity": 72, "pressure": 1015.3},
            "weather": [{"description": "partly cloudy", "icon": "02d"}],
            "wind": {"speed": 2.1},
        }
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response

        # Test with mocked API key
        with patch.dict("os.environ", {"OPENWEATHER_API_KEY": "test_key"}):
            service = WeatherService()
            result = service._fetch_from_api("Bad Mergentheim", "DE")

        self.assertIsNotNone(result)
        self.assertEqual(result["city"], "Bad Mergentheim")
        self.assertEqual(result["temperature"], 18.5)
