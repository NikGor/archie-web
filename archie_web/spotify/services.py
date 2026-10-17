import logging
import time
from pathlib import Path
from urllib.parse import urlencode

import requests
from django.conf import settings
from dotenv import set_key

from .exceptions import SpotifyAuthError

logger = logging.getLogger(__name__)

AUTHORIZE_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "playlist-read-private",
    "playlist-modify-public",
    "playlist-modify-private",
]

ENV_PATH = Path(settings.BASE_DIR) / ".env"


class TokenStore:
    """Persists the single household Spotify token pair in .env, with an in-memory cache."""

    def __init__(self):
        self._access_token: str | None = None
        self._expires_at: float = 0

    def save(self, access_token: str, refresh_token: str, expires_in: int) -> None:
        self._access_token = access_token
        self._expires_at = time.time() + expires_in

        set_key(str(ENV_PATH), "SPOTIFY_ACCESS_TOKEN", access_token)
        set_key(str(ENV_PATH), "SPOTIFY_REFRESH_TOKEN", refresh_token)
        set_key(str(ENV_PATH), "SPOTIFY_TOKEN_EXPIRES_AT", str(int(self._expires_at)))

    def get_refresh_token(self) -> str | None:
        return getattr(settings, "SPOTIFY_REFRESH_TOKEN", None)

    def has_token(self) -> bool:
        return bool(self.get_refresh_token())

    def get_valid_access_token(self) -> str:
        if self._access_token and time.time() < self._expires_at - 30:
            return self._access_token

        refresh_token = self.get_refresh_token()
        if not refresh_token:
            raise SpotifyAuthError("Spotify is not connected: no refresh token")

        return SpotifyOAuthService().refresh_access_token(refresh_token)


token_store = TokenStore()


class SpotifyOAuthService:
    def __init__(self):
        self.client_id = settings.SPOTIFY_CLIENT_ID
        self.client_secret = settings.SPOTIFY_CLIENT_SECRET
        self.redirect_uri = settings.SPOTIFY_REDIRECT_URI

    def get_authorize_url(self, state: str) -> str:
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(SCOPES),
            "state": state,
        }
        return f"{AUTHORIZE_URL}?{urlencode(params)}"

    def exchange_code(self, code: str) -> str:
        response = requests.post(
            TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.redirect_uri,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
            timeout=10,
        )
        if response.status_code != 200:
            logger.error(f"spotify_001: token exchange failed: {response.text}")
            raise SpotifyAuthError("Failed to exchange Spotify authorization code")

        data = response.json()
        token_store.save(
            access_token=data["access_token"],
            refresh_token=data["refresh_token"],
            expires_in=data["expires_in"],
        )
        return data["access_token"]

    def refresh_access_token(self, refresh_token: str) -> str:
        response = requests.post(
            TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
            timeout=10,
        )
        if response.status_code != 200:
            logger.error(f"spotify_002: token refresh failed: {response.text}")
            raise SpotifyAuthError("Failed to refresh Spotify access token")

        data = response.json()
        token_store.save(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token", refresh_token),
            expires_in=data["expires_in"],
        )
        return data["access_token"]
