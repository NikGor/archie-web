import json
import logging

import requests
from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from archie_web.redis_client import redis_client

from .exceptions import SpotifyAuthError
from .services import token_store

logger = logging.getLogger(__name__)

CONTROL_ACTIONS = {
    "play",
    "pause",
    "next",
    "previous",
    "volume",
    "shuffle",
    "repeat",
    "seek",
    "favorite",
    "unfavorite",
    "play_track",
}


def _current_user_name(request) -> str:
    if request.user.is_authenticated:
        return request.user.profile.user_name
    return "Niko"


@method_decorator(csrf_exempt, name="dispatch")
class SpotifyTokenAPIView(View):
    def get(self, request, *args, **kwargs):
        try:
            access_token = token_store.get_valid_access_token()
        except SpotifyAuthError as e:
            return JsonResponse({"success": False, "message": str(e)}, status=400)
        return JsonResponse({"success": True, "access_token": access_token})


@method_decorator(csrf_exempt, name="dispatch")
class SpotifyStatusAPIView(View):
    def get(self, request, *args, **kwargs):
        return JsonResponse({"success": True, "connected": token_store.has_token()})


@method_decorator(csrf_exempt, name="dispatch")
class SpotifyNowPlayingAPIView(View):
    """Reports the account-wide playback state (any device), not just our SDK device."""

    def get(self, request, *args, **kwargs):
        try:
            access_token = token_store.get_valid_access_token()
        except SpotifyAuthError as e:
            return JsonResponse({"success": False, "message": str(e)}, status=400)

        try:
            response = requests.get(
                "https://api.spotify.com/v1/me/player",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10,
            )
        except Exception as e:
            logger.error(f"spotify_008: now-playing request failed: {e}")
            return JsonResponse({"success": False, "message": str(e)}, status=502)

        if response.status_code == 204 or not response.content:
            return JsonResponse({"success": True, "playback": None})
        if response.status_code != 200:
            logger.error(f"spotify_009: now-playing failed: {response.text}")
            return JsonResponse(
                {"success": False, "message": "Failed to fetch playback state"},
                status=502,
            )

        data = response.json()
        item = data.get("item")
        if not item:
            return JsonResponse({"success": True, "playback": None})

        images = item.get("album", {}).get("images") or []
        playback = {
            "is_playing": data.get("is_playing", False),
            "progress_seconds": (data.get("progress_ms") or 0) // 1000,
            "volume": (data.get("device") or {}).get("volume_percent"),
            "shuffle": data.get("shuffle_state", False),
            "repeat": data.get("repeat_state", "off"),
            "has_context": data.get("context") is not None,
            "current_track": {
                "title": item.get("name"),
                "artist": ", ".join(a.get("name") for a in item.get("artists", [])),
                "album": item.get("album", {}).get("name"),
                "duration_seconds": (item.get("duration_ms") or 0) // 1000,
                "cover_url": images[0]["url"] if images else None,
            },
        }
        return JsonResponse({"success": True, "playback": playback})


@method_decorator(csrf_exempt, name="dispatch")
class SpotifyQueueAPIView(View):
    """Reports the upcoming tracks in the user's playback queue."""

    def get(self, request, *args, **kwargs):
        try:
            access_token = token_store.get_valid_access_token()
        except SpotifyAuthError as e:
            return JsonResponse({"success": False, "message": str(e)}, status=400)

        try:
            response = requests.get(
                "https://api.spotify.com/v1/me/player/queue",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10,
            )
        except Exception as e:
            logger.error(f"spotify_010: queue request failed: {e}")
            return JsonResponse({"success": False, "message": str(e)}, status=502)

        if response.status_code != 200:
            logger.error(f"spotify_011: queue fetch failed: {response.text}")
            return JsonResponse(
                {"success": False, "message": "Failed to fetch queue"}, status=502
            )

        data = response.json()
        queue = []
        for item in (data.get("queue") or [])[:5]:
            images = item.get("album", {}).get("images") or []
            queue.append(
                {
                    "title": item.get("name"),
                    "artist": ", ".join(a.get("name") for a in item.get("artists", [])),
                    "album": item.get("album", {}).get("name"),
                    "duration_seconds": (item.get("duration_ms") or 0) // 1000,
                    "cover_url": images[0]["url"] if images else None,
                }
            )
        return JsonResponse({"success": True, "queue": queue})


@method_decorator(csrf_exempt, name="dispatch")
class SpotifyDeviceAPIView(View):
    def post(self, request, *args, **kwargs):
        data = json.loads(request.body)
        device_id = data.get("device_id")
        if not device_id:
            return JsonResponse(
                {"success": False, "message": "device_id is required"}, status=400
            )

        user_name = _current_user_name(request)
        redis_client.set_user_field(user_name, "spotify_device_id", device_id)
        logger.info(f"spotify_006: registered device_id for {user_name}")
        return JsonResponse({"success": True})


@method_decorator(csrf_exempt, name="dispatch")
class SpotifyDevicesAPIView(View):
    """Lists real Spotify Connect devices so the user can pick which one
    playback commands should target, instead of always defaulting to
    whichever browser tab last registered its Web Playback SDK instance."""

    def get(self, request, *args, **kwargs):
        try:
            access_token = token_store.get_valid_access_token()
        except SpotifyAuthError as e:
            return JsonResponse({"success": False, "message": str(e)}, status=400)

        try:
            response = requests.get(
                "https://api.spotify.com/v1/me/player/devices",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10,
            )
        except Exception as e:
            logger.error(f"spotify_013: devices request failed: {e}")
            return JsonResponse({"success": False, "message": str(e)}, status=502)

        if response.status_code != 200:
            logger.error(f"spotify_014: devices fetch failed: {response.text}")
            return JsonResponse(
                {"success": False, "message": "Failed to fetch devices"}, status=502
            )

        user_name = _current_user_name(request)
        selected_device_id = redis_client.get_user_field(user_name, "spotify_device_id")
        devices = [
            {
                "id": d.get("id"),
                "name": d.get("name"),
                "type": d.get("type"),
                "is_active": d.get("is_active", False),
                "is_selected": d.get("id") == selected_device_id,
                "volume_percent": d.get("volume_percent"),
            }
            for d in response.json().get("devices", [])
        ]
        return JsonResponse({"success": True, "devices": devices})


@method_decorator(csrf_exempt, name="dispatch")
class SpotifyControlAPIView(View):
    """Calls the Spotify Web API directly (no AI-agent relay) for deterministic
    playback actions — fast, cheap, and doesn't depend on an LLM deciding to
    invoke a tool."""

    def post(self, request, *args, **kwargs):
        data = json.loads(request.body)
        action = data.get("action")
        value = data.get("value")
        if action not in CONTROL_ACTIONS:
            return JsonResponse(
                {"success": False, "message": f"Unknown action: {action}"}, status=400
            )

        user_name = _current_user_name(request)
        device_id = redis_client.get_user_field(user_name, "spotify_device_id")
        if not device_id:
            return JsonResponse(
                {
                    "success": False,
                    "message": "No active Spotify Web Playback device registered",
                },
                status=400,
            )

        try:
            access_token = token_store.get_valid_access_token()
        except SpotifyAuthError as e:
            return JsonResponse({"success": False, "message": str(e)}, status=400)

        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            success, message = self._execute(action, value, device_id, headers)
        except Exception as e:
            logger.error(f"spotify_007: control request failed: {e}")
            return JsonResponse({"success": False, "message": str(e)}, status=502)

        if not success:
            return JsonResponse({"success": False, "message": message}, status=502)
        return JsonResponse({"success": True})

    def _execute(
        self, action: str, value, device_id: str, headers: dict
    ) -> tuple[bool, str | None]:
        base = "https://api.spotify.com/v1/me/player"

        if action == "play":
            resp = requests.put(
                f"{base}/play",
                params={"device_id": device_id},
                headers=headers,
                timeout=10,
            )
        elif action == "pause":
            resp = requests.put(
                f"{base}/pause",
                params={"device_id": device_id},
                headers=headers,
                timeout=10,
            )
        elif action == "next":
            resp = requests.post(
                f"{base}/next",
                params={"device_id": device_id},
                headers=headers,
                timeout=10,
            )
        elif action == "previous":
            resp = requests.post(
                f"{base}/previous",
                params={"device_id": device_id},
                headers=headers,
                timeout=10,
            )
        elif action == "volume":
            resp = requests.put(
                f"{base}/volume",
                params={"volume_percent": int(value), "device_id": device_id},
                headers=headers,
                timeout=10,
            )
        elif action == "shuffle":
            resp = requests.put(
                f"{base}/shuffle",
                params={"state": "true" if value else "false", "device_id": device_id},
                headers=headers,
                timeout=10,
            )
        elif action == "repeat":
            resp = requests.put(
                f"{base}/repeat",
                params={"state": value, "device_id": device_id},
                headers=headers,
                timeout=10,
            )
        elif action == "seek":
            resp = requests.put(
                f"{base}/seek",
                params={"position_ms": int(value) * 1000, "device_id": device_id},
                headers=headers,
                timeout=10,
            )
        elif action == "play_track":
            track_uri = self._search_track_uri(value, headers)
            if not track_uri:
                return False, f"Track not found: {value}"
            resp = requests.put(
                f"{base}/play",
                params={"device_id": device_id},
                json={"uris": [track_uri]},
                headers=headers,
                timeout=10,
            )
        elif action in ("favorite", "unfavorite"):
            track_id = self._current_track_id(headers)
            if not track_id:
                return False, "No track is currently playing"
            method = requests.put if action == "favorite" else requests.delete
            resp = method(
                "https://api.spotify.com/v1/me/tracks",
                params={"ids": track_id},
                headers=headers,
                timeout=10,
            )
        else:
            return False, f"Unhandled action: {action}"

        if resp.status_code not in (200, 202, 204):
            logger.error(
                f"spotify_012: {action} failed ({resp.status_code}): {resp.text}"
            )
            return False, f"Spotify API error ({resp.status_code})"
        return True, None

    @staticmethod
    def _current_track_id(headers: dict) -> str | None:
        resp = requests.get(
            "https://api.spotify.com/v1/me/player/currently-playing",
            headers=headers,
            timeout=10,
        )
        if resp.status_code != 200 or not resp.content:
            return None
        item = resp.json().get("item")
        return item.get("id") if item else None

    @staticmethod
    def _search_track_uri(query: str, headers: dict) -> str | None:
        resp = requests.get(
            "https://api.spotify.com/v1/search",
            params={"q": query, "type": "track", "limit": 1},
            headers=headers,
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        items = resp.json().get("tracks", {}).get("items", [])
        return items[0]["uri"] if items else None
