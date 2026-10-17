"""Gemini Live (realtime voice) session bootstrap for the frontend Voice Chat.

The browser talks to the Gemini Live API directly over WebSocket, but never sees
GEMINI_API_KEY: we mint a single-use ephemeral token whose `live_connect_constraints`
lock the whole session config (model, persona voice, system instruction, tools).
The client then only sends `{"setup": {"model": ...}}` and cannot change any of it.

The Live model handles conversation itself and delegates anything that needs real
data or actions to the Archie agent through one tool, `ask_archie`, which the
browser executes via `/ai-assistant/api/chat/` and answers with a toolResponse.
"""

import datetime
import logging
import os
from typing import Optional

from archie_shared.voice import DEFAULT_TTS_VOICE, voice_for_persona
from google import genai

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
LIVE_MODEL = os.getenv("LIVE_MODEL", "gemini-3.8-live")
# Ephemeral tokens are v1alpha-only; the browser must hit the Constrained method.
LIVE_API_VERSION = "v1alpha"
LIVE_WS_URL = (
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage."
    f"{LIVE_API_VERSION}.GenerativeService.BidiGenerateContentConstrained"
)
# The token must open a session within NEW_SESSION_TTL; the session itself may
# then run until SESSION_TTL (Gemini caps a single connection at ~10–15 min anyway).
NEW_SESSION_TTL = datetime.timedelta(minutes=1)
SESSION_TTL = datetime.timedelta(minutes=30)

ASK_ARCHIE_TOOL = "ask_archie"

# UserState.language -> BCP-47 speech language for the Live voice.
_LANGUAGE_CODES = {
    "ru": "ru-RU",
    "en": "en-US",
    "de": "de-DE",
    "uk": "uk-UA",
}
DEFAULT_LANGUAGE_CODE = "ru-RU"

_SYSTEM_INSTRUCTION = """You are Archie, a voice home assistant. Persona: {persona}.
Speak in the language of the user ({language_code}); keep answers short and natural for speech, no lists or markdown.

You have one tool, {tool}. Call it for anything that needs real data or actions:
smart home (lights, climate, devices), weather, calendar and events, tasks, notes,
reminders, music/TV, places, documents, web search, news, sport, and any fact you are not sure about.
Pass the user's request in full, self-contained (resolve "it"/"there" from the conversation).
Then retell the tool's answer briefly in your own words. Never invent results or claim an action was done without the tool.
Small talk and general knowledge you answer yourself, without the tool."""


def language_code_for(language: Optional[str]) -> str:
    """Map a UserState language ("ru", "en-GB", "English"…) to a speech language code."""
    if not language:
        return DEFAULT_LANGUAGE_CODE
    return _LANGUAGE_CODES.get(language.strip().lower()[:2], DEFAULT_LANGUAGE_CODE)


def build_live_config(persona: Optional[str], language: Optional[str]) -> dict:
    """Session config locked into the token (snake_case, google-genai LiveConnectConfig)."""
    voice = voice_for_persona(persona) if persona else DEFAULT_TTS_VOICE
    language_code = language_code_for(language)
    return {
        "response_modalities": ["AUDIO"],
        "speech_config": {
            "voice_config": {"prebuilt_voice_config": {"voice_name": voice}},
            "language_code": language_code,
        },
        "system_instruction": _SYSTEM_INSTRUCTION.format(
            persona=persona or "default",
            language_code=language_code,
            tool=ASK_ARCHIE_TOOL,
        ),
        "tools": [
            {
                "function_declarations": [
                    {
                        "name": ASK_ARCHIE_TOOL,
                        "description": (
                            "Ask the Archie agent, which controls the smart home and has "
                            "weather, calendar, tasks, notes, music, places, documents and "
                            "web search. Returns a short text answer."
                        ),
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "request": {
                                    "type": "STRING",
                                    "description": "The user's request, full and self-contained.",
                                }
                            },
                            "required": ["request"],
                        },
                        # Wait for the agent instead of talking over the pending call.
                        "behavior": "BLOCKING",
                    }
                ]
            }
        ],
        "input_audio_transcription": {},
        "output_audio_transcription": {},
    }


def create_live_token(persona: Optional[str], language: Optional[str]) -> dict:
    """Mint a single-use ephemeral token locked to the persona's Live session config.

    Returns {"token", "ws_url", "model", "voice"}. Raises on upstream errors.
    """
    config = build_live_config(persona, language)
    now = datetime.datetime.now(tz=datetime.timezone.utc)
    client = genai.Client(
        api_key=GEMINI_API_KEY, http_options={"api_version": LIVE_API_VERSION}
    )
    token = client.auth_tokens.create(
        config={
            "uses": 1,
            "expire_time": now + SESSION_TTL,
            "new_session_expire_time": now + NEW_SESSION_TTL,
            "live_connect_constraints": {"model": LIVE_MODEL, "config": config},
            "http_options": {"api_version": LIVE_API_VERSION},
        }
    )
    voice = config["speech_config"]["voice_config"]["prebuilt_voice_config"][
        "voice_name"
    ]
    logger.info(
        f"live_session_001: Minted Live token (model={LIVE_MODEL}, "
        f"persona={persona}, voice={voice})"
    )
    return {
        "token": token.name,
        "ws_url": LIVE_WS_URL,
        "model": f"models/{LIVE_MODEL}",
        "voice": voice,
    }
