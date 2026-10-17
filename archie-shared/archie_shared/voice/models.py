"""Single source of truth for persona -> Gemini TTS voice mapping.

Consumed by both archie-voice (the Pi wake-word assistant) and the archie-web
webapp (the browser Voice Chat), so a persona always speaks in the same voice
everywhere. Voices are Gemini TTS voice ids (male/female, style-matched).
"""

# Fallback voice for unknown/unset personas.
DEFAULT_TTS_VOICE = "Kore"

# Assistant persona -> Gemini TTS voice id.
PERSONA_VOICES = {
    "business": "Achird",  # Friendly — professional
    "bro": "Puck",  # Upbeat — casual (male)
    "flirty": "Zephyr",  # Bright (female)
    "futurebot": "Charon",  # Informative — deep, techy (male)
    "butler": "Sadachbia",  # Lively
}


def voice_for_persona(persona: str | None) -> str:
    """Return the Gemini voice for a persona, falling back to DEFAULT_TTS_VOICE."""
    return PERSONA_VOICES.get(persona or "", DEFAULT_TTS_VOICE)
