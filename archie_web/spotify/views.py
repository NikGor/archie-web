import logging
import secrets

from django.http import HttpResponseRedirect
from django.views import View

from .exceptions import SpotifyAuthError
from .services import SpotifyOAuthService

logger = logging.getLogger(__name__)


class SpotifyAuthorizeView(View):
    def get(self, request, *args, **kwargs):
        state = secrets.token_urlsafe(16)
        request.session["spotify_oauth_state"] = state
        url = SpotifyOAuthService().get_authorize_url(state)
        return HttpResponseRedirect(url)


class SpotifyCallbackView(View):
    def get(self, request, *args, **kwargs):
        error = request.GET.get("error")
        if error:
            logger.error(f"spotify_003: authorize denied: {error}")
            return HttpResponseRedirect(f"/?spotify_error={error}")

        code = request.GET.get("code")
        state = request.GET.get("state")
        expected_state = request.session.pop("spotify_oauth_state", None)
        if not code or not state or state != expected_state:
            logger.error("spotify_004: invalid OAuth state or missing code")
            return HttpResponseRedirect("/?spotify_error=invalid_state")

        try:
            SpotifyOAuthService().exchange_code(code)
        except SpotifyAuthError as e:
            logger.error(f"spotify_005: {e}")
            return HttpResponseRedirect("/?spotify_error=token_exchange_failed")

        return HttpResponseRedirect("/?spotify_connected=1")
