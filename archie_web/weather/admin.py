from django.contrib import admin

from .models import WeatherData


@admin.register(WeatherData)
class WeatherDataAdmin(admin.ModelAdmin):
    list_display = ("city", "country", "temperature", "description", "updated_at")
    list_filter = ("country", "updated_at")
    search_fields = ("city", "country", "description")
    readonly_fields = ("created_at", "updated_at")

    fieldsets = (
        ("Location", {"fields": ("city", "country")}),
        (
            "Weather Data",
            {
                "fields": (
                    "temperature",
                    "description",
                    "humidity",
                    "pressure",
                    "wind_speed",
                    "icon",
                )
            },
        ),
        (
            "Timestamps",
            {"fields": ("created_at", "updated_at"), "classes": ("collapse",)},
        ),
    )
