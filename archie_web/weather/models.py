from django.db import models


class WeatherData(models.Model):
    """Model for storing weather data cache"""

    city = models.CharField(max_length=100)
    country = models.CharField(max_length=100)
    temperature = models.FloatField()
    description = models.CharField(max_length=200)
    humidity = models.IntegerField()
    pressure = models.FloatField()
    wind_speed = models.FloatField()
    icon = models.CharField(max_length=10)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("city", "country")

    def __str__(self):
        return f"{self.city}, {self.country} - {self.temperature}°C"
