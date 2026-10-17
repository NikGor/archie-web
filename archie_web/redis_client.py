import json
import logging
from datetime import datetime
from typing import Any

import redis
from archie_shared.user.models import UserState
from django.conf import settings

logger = logging.getLogger(__name__)


class RedisClient:
    """Redis client for user state caching"""

    def __init__(self):
        self.redis_client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=settings.REDIS_DB,
            decode_responses=True,
        )

    def _get_user_key_by_name(self, user_name: str) -> str:
        """Generates key for user state by username"""
        return f"user_state:name:{user_name}"

    def get_user_state_by_name(self, user_name: str) -> UserState | None:
        """Gets user state from Redis by username; current date/time/weekday are always computed at read time, not stored"""
        try:
            key = self._get_user_key_by_name(user_name)
            data = self.redis_client.get(key)

            if data:
                state_dict = json.loads(data)
                now = datetime.now()
                state_dict["current_date"] = now.strftime("%Y-%m-%d")
                state_dict["current_time"] = now.strftime("%H:%M:%S")
                state_dict["current_weekday"] = now.strftime("%A")
                return UserState(**state_dict)
            return None

        except Exception as e:
            logger.error(
                f"redis_client_006: Error getting user state by name {user_name}: {e}"
            )
            return None

    def set_user_state(
        self, user_name: str, state: UserState, ttl: int | None = None
    ) -> bool:
        """
        Saves user state to Redis

        Args:
            user_name: User name
            state: User state
            ttl: Time to live in seconds (default: None)
        """
        try:
            key = self._get_user_key_by_name(user_name)
            data = state.model_dump_json()

            if ttl:
                self.redis_client.setex(key, ttl, data)
            else:
                self.redis_client.set(key, data)

            return True

        except Exception as e:
            logger.error(f"redis_client_002: Error saving user state {user_name}: {e}")
            return False

    def update_user_state(
        self, user_name: str, updates: dict[str, Any], ttl: int | None = None
    ) -> bool:
        """
        Partially updates user state

        Args:
            user_name: User name
            updates: Dictionary with updates
            ttl: Record lifetime in seconds
        """
        try:
            current_state = self.get_user_state_by_name(user_name)

            if current_state is None:
                logger.error(f"redis_client_007: User state not found for {user_name}")
                return False

            # Update fields
            state_dict = current_state.model_dump()
            state_dict.update(updates)

            updated_state = UserState(**state_dict)
            return self.set_user_state(user_name, updated_state, ttl)

        except Exception as e:
            logger.error(
                f"redis_client_003: Error updating user state {user_name}: {e}"
            )
            return False

    def delete_user_state(self, user_name: str) -> bool:
        """Deletes user state from Redis"""
        try:
            key = self._get_user_key_by_name(user_name)
            result = self.redis_client.delete(key)
            return result > 0

        except Exception as e:
            logger.error(
                f"redis_client_004: Error deleting user state {user_name}: {e}"
            )
            return False

    def get_user_field(self, user_name: str, field: str) -> Any | None:
        """Gets specific field from user state"""
        state = self.get_user_state_by_name(user_name)
        if state:
            return getattr(state, field, None)
        return None

    def set_user_field(
        self, user_name: str, field: str, value: Any, ttl: int | None = None
    ) -> bool:
        """Sets specific field in user state"""
        return self.update_user_state(user_name, {field: value}, ttl)

    def ping(self) -> bool:
        """Check Redis connection"""
        try:
            return self.redis_client.ping()
        except Exception as e:
            logger.error(f"redis_client_005: Redis connection error: {e}")
            return False


# Global client instance
redis_client = RedisClient()
