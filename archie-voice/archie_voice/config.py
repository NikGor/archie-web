"""Runtime configuration, loaded from environment / .env."""

import os

from dotenv import load_dotenv

load_dotenv()


def _as_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_float(value, default):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


# --- Identity / agent -------------------------------------------------------
# Must match the user_name whose state lives in Redis (user_state:name:<name>),
# so the agent applies persona/city/language/etc.
USER_NAME = os.getenv("ARCHIE_USER_NAME", "Niko")
# Base URL of the Django webapp that proxies to the agent and persists messages.
API_BASE = os.getenv("ARCHIE_API_BASE", "http://localhost:8000").rstrip("/")
# "ssml" (agent returns SSML, tags stripped) or "gemini_tts" (agent returns text
# with Gemini inline audio tags like [excited]; kept and fed straight to the TTS).
RESPONSE_FORMAT = os.getenv("ARCHIE_RESPONSE_FORMAT", "ssml")

# --- Wake word (OpenWakeWord) ----------------------------------------------
# Stage 1 uses the pre-trained "hey_jarvis" model. Swap to a custom "hey_archie"
# model file once trained.
WAKE_MODEL = os.getenv("WAKE_MODEL", "hey_jarvis")
WAKE_THRESHOLD = _as_float(os.getenv("WAKE_THRESHOLD"), 0.6)
WAKE_INFERENCE = os.getenv("WAKE_INFERENCE_FRAMEWORK", "onnx")  # "onnx" | "tflite"

# --- STT (faster-whisper, offline) -----------------------------------------
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3-turbo")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
STT_LANGUAGE = os.getenv("STT_LANGUAGE", "ru")

# --- TTS (OpenRouter, OpenAI-compatible /audio/speech) ----------------------
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE = os.getenv("OPENROUTER_BASE", "https://openrouter.ai/api/v1").rstrip(
    "/"
)
# Safe default that is known to work; switch to Gemini once a valid voice id is set:
#   TTS_MODEL=google/gemini-3.1-flash-tts-preview  TTS_VOICE=<gemini_voice_id>
TTS_MODEL = os.getenv("TTS_MODEL", "google/gemini-3.1-flash-tts-preview")
TTS_VOICE = os.getenv("TTS_VOICE", "Kore")
# Gemini TTS only supports "pcm"; mp3-capable models (grok, kokoro) can use "mp3".
TTS_FORMAT = os.getenv("TTS_FORMAT", "pcm")
TTS_PCM_RATE = _as_int(os.getenv("TTS_PCM_RATE"), 24000)

# Assistant persona -> Gemini TTS voice. Single source of truth in archie-shared
# (shared with the webapp Voice Chat). If the package is not installed in this
# venv we fall back to a local copy so the systemd service still runs; install
# archie-shared (`pip install -e ../archie-shared`) to keep the two in sync.
try:
    from archie_shared.voice import PERSONA_VOICES  # noqa: F401
except ImportError:
    import logging

    logging.getLogger(__name__).warning(
        "config_warn_001: archie_shared not installed — using bundled PERSONA_VOICES "
        "fallback; run `pip install -e ../archie-shared` to share with the webapp"
    )
    PERSONA_VOICES = {
        "business": "Achird",
        "bro": "Puck",
        "flirty": "Zephyr",
        "futurebot": "Charon",
        "butler": "Sadachbia",
        "marcus": "Fenrir",
    }

# --- Announce (scheduled voice messages over Redis pub/sub) -----------------
# The agent's cron publishes to ANNOUNCE_CHANNEL; we synthesize + speak it.
# archie-voice runs on the host, so Redis is reached via the mapped localhost
# port (not the "redis" Docker hostname the agent container uses).
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = _as_int(os.getenv("REDIS_PORT"), 6379)
REDIS_DB = _as_int(os.getenv("REDIS_DB"), 0)
ANNOUNCE_CHANNEL = os.getenv("ANNOUNCE_CHANNEL", "archie:voice:announce")
ANNOUNCE_ENABLED = os.getenv("ANNOUNCE_ENABLED", "1") not in ("0", "false", "False", "")

# --- Audio ------------------------------------------------------------------
SAMPLE_RATE = 16000
MIC_DEVICE = _as_int(os.getenv("MIC_DEVICE"), None)  # None -> system default

# --- Session timing ---------------------------------------------------------
# End the session if the user stays silent this long when we start listening.
SILENCE_TIMEOUT_S = _as_float(os.getenv("SILENCE_TIMEOUT_S"), 10.0)
# Trailing silence that marks the end of an utterance.
END_OF_SPEECH_SILENCE_S = _as_float(os.getenv("END_OF_SPEECH_SILENCE_S"), 1.5)
# Hard cap on a single utterance length.
MAX_UTTERANCE_S = _as_float(os.getenv("MAX_UTTERANCE_S"), 15.0)
# Minimum amount of *voiced* audio to accept an utterance (drops noise/silence
# blips that make Whisper hallucinate).
MIN_SPEECH_S = _as_float(os.getenv("MIN_SPEECH_S"), 0.5)
# Gap between "thinking" cue repeats while waiting for the agent.
THINKING_INTERVAL_S = _as_float(os.getenv("THINKING_INTERVAL_S"), 1.5)
