import logging

from django.apps import AppConfig

logger = logging.getLogger(__name__)


class WebappConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "archie_web.webapp"

    def ready(self):
        """Called when Django app is ready - sync all user profiles to Redis"""
        from .models import UserProfile

        try:
            # Sync all user profiles to Redis on startup
            profiles = UserProfile.objects.all()
            synced_count = 0

            for profile in profiles:
                if profile.sync_to_redis():
                    synced_count += 1

            logger.info(
                f"webapp_001: Synced {synced_count} user profiles to Redis on startup"
            )
        except Exception as e:
            logger.error(
                f"webapp_002: Failed to sync user profiles to Redis on startup: {e}"
            )
