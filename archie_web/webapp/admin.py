from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import User

from .models import UserProfile


class UserProfileInline(admin.StackedInline):
    """Inline admin for UserProfile."""

    model = UserProfile
    can_delete = False
    verbose_name_plural = "Profile Settings"

    fieldsets = (
        ("Basic Information", {"fields": ("user_name", "persona")}),
        (
            "Location & Time",
            {
                "fields": (
                    "default_city",
                    "default_country",
                    "user_timezone",
                    "measurement_units",
                )
            },
        ),
        (
            "Localization",
            {"fields": ("language", "currency", "date_format", "time_format")},
        ),
        (
            "Commercial Settings",
            {"fields": ("commercial_holidays", "commercial_check_open_now")},
        ),
        ("Preferences", {"fields": ("transport_preferences", "cuisine_preferences")}),
        (
            "Environment Cache",
            {
                "fields": ("weather_cache", "sunrise_cache", "sunset_cache"),
                "classes": ("collapse",),
            },
        ),
    )


class UserAdmin(BaseUserAdmin):
    """Extended User admin with profile inline."""

    inlines = (UserProfileInline,)


admin.site.unregister(User)
admin.site.register(User, UserAdmin)


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    """Standalone UserProfile admin."""

    list_display = (
        "user",
        "user_name",
        "persona",
        "default_city",
        "language",
        "updated_at",
    )
    list_filter = ("persona", "language", "currency")
    search_fields = ("user__username", "user_name", "default_city")
    readonly_fields = ("created_at", "updated_at")

    fieldsets = (
        ("User", {"fields": ("user",)}),
        ("Basic Information", {"fields": ("user_name", "persona")}),
        (
            "Location & Time",
            {
                "fields": (
                    "default_city",
                    "default_country",
                    "user_timezone",
                    "measurement_units",
                )
            },
        ),
        (
            "Localization",
            {"fields": ("language", "currency", "date_format", "time_format")},
        ),
        (
            "Commercial Settings",
            {"fields": ("commercial_holidays", "commercial_check_open_now")},
        ),
        ("Preferences", {"fields": ("transport_preferences", "cuisine_preferences")}),
        (
            "Environment Cache",
            {"fields": ("weather_cache", "sunrise_cache", "sunset_cache")},
        ),
        (
            "Timestamps",
            {"fields": ("created_at", "updated_at"), "classes": ("collapse",)},
        ),
    )
