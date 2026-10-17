from django.contrib.auth.models import User
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver


class UserProfile(models.Model):
    """User profile with settings and preferences."""

    PERSONA_CHOICES = [
        ("business", "Business"),
        ("bro", "Bro"),
        ("flirty", "Flirty"),
        ("futurebot", "Futurebot"),
        ("butler", "Butler"),
    ]

    LANGUAGE_CHOICES = [
        ("en", "English"),
        ("ru", "Russian"),
        ("de", "German"),
    ]

    CURRENCY_CHOICES = [
        ("EUR", "Euro"),
        ("USD", "US Dollar"),
        ("RUB", "Russian Ruble"),
    ]

    TIME_FORMAT_CHOICES = [
        ("12h", "12-hour"),
        ("24h", "24-hour"),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    user_name = models.CharField(max_length=100, blank=True, default="")
    persona = models.CharField(
        max_length=20, choices=PERSONA_CHOICES, default="personal"
    )
    default_city = models.CharField(max_length=100, default="Bad Mergentheim")
    default_country = models.CharField(max_length=100, default="Germany")
    user_timezone = models.CharField(max_length=50, default="Europe/Berlin")
    measurement_units = models.CharField(max_length=20, default="metric")
    language = models.CharField(max_length=5, choices=LANGUAGE_CHOICES, default="en")
    currency = models.CharField(max_length=5, choices=CURRENCY_CHOICES, default="EUR")
    date_format = models.CharField(max_length=50, default="DD Month YYYY")
    time_format = models.CharField(
        max_length=5, choices=TIME_FORMAT_CHOICES, default="24h"
    )
    commercial_holidays = models.CharField(
        max_length=10, default="DE-BW", help_text="Holiday region code"
    )
    commercial_check_open_now = models.BooleanField(default=True)
    transport_preferences = models.JSONField(
        default=list, blank=True, help_text="List of preferred transport types"
    )
    cuisine_preferences = models.JSONField(
        default=list, blank=True, help_text="List of preferred cuisine types"
    )
    weather_cache = models.JSONField(
        null=True, blank=True, help_text="Cached weather data"
    )
    sunrise_cache = models.CharField(max_length=10, blank=True, default="")
    sunset_cache = models.CharField(max_length=10, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "User Profile"
        verbose_name_plural = "User Profiles"

    def __str__(self):
        return f"{self.user.username} Profile"

    def sync_to_redis(self):
        """Syncs user profile to Redis cache"""
        from archie_shared.user.models import UserState

        from archie_web.redis_client import redis_client

        user_name = self.user_name or self.user.username
        state = UserState(
            user_id=str(self.user.id),
            user_name=user_name,
            default_city=self.default_city,
            default_country=self.default_country,
            persona=self.persona,
            user_timezone=self.user_timezone,
            measurement_units=self.measurement_units,
            language=self.language,
            currency=self.currency,
            date_format=self.date_format,
            time_format=self.time_format,
            commercial_holidays=self.commercial_holidays,
            commercial_check_open_now=self.commercial_check_open_now,
            transport_preferences=self.transport_preferences or [],
            cuisine_preferences=self.cuisine_preferences or [],
        )
        return redis_client.set_user_state(user_name, state)


@receiver(post_save, sender=UserProfile)
def sync_user_profile_to_redis(sender, instance, **kwargs):
    """Automatically sync user profile to Redis on save"""
    instance.sync_to_redis()


class EmptyModel(models.Model):
    class Meta:
        abstract = True
