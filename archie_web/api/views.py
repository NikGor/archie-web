import json
import logging

from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from archie_web.redis_client import RedisClient

logger = logging.getLogger(__name__)


class ChatView(View):
    def get(self, request):
        return JsonResponse({"message": "GET method is available at /api/chat"})

    def post(self, request):
        return JsonResponse({"message": "Hello from /chat endpoint!"})


@method_decorator(csrf_exempt, name="dispatch")
class UserStateView(View):
    """API endpoint for user state management"""

    def get(self, request):
        """Get user state by user_name query parameter"""
        user_name = request.GET.get("user_name")
        if not user_name:
            return JsonResponse({"error": "user_name is required"}, status=400)

        try:
            redis_client = RedisClient()
            state = redis_client.get_user_state_by_name(user_name)
            if state:
                return JsonResponse(state.model_dump())
            return JsonResponse({"error": "User state not found"}, status=404)
        except Exception as e:
            logger.error(f"api_views_001: Error getting user state: {e}")
            return JsonResponse({"error": str(e)}, status=500)

    def patch(self, request):
        """Partially update user state"""
        try:
            data = json.loads(request.body)
            user_name = data.get("user_name")
            if not user_name:
                return JsonResponse({"error": "user_name is required"}, status=400)

            # Remove user_name from updates
            updates = {k: v for k, v in data.items() if k != "user_name"}

            redis_client = RedisClient()
            success = redis_client.update_user_state(user_name, updates)

            if success:
                return JsonResponse({"status": "updated", "updates": updates})
            return JsonResponse({"error": "Failed to update user state"}, status=500)
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)
        except Exception as e:
            logger.error(f"api_views_002: Error updating user state: {e}")
            return JsonResponse({"error": str(e)}, status=500)
