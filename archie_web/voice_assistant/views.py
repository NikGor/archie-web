import json
import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .services import VoiceAssistantService

logger = logging.getLogger(__name__)


@csrf_exempt
@require_http_methods(["POST"])
def process_voice_message(request):
    """Simple endpoint to trigger voice processing manually"""
    try:
        service = VoiceAssistantService()

        if not service.wake_word_service:
            return JsonResponse(
                {
                    "error": "Voice assistant not available - voice dependencies missing or disabled"
                },
                status=503,
            )

        # Record audio
        audio_file = service.voice_service.record_audio()

        # Transcribe
        user_text = service.voice_service.transcribe_audio(audio_file)

        if not user_text or len(user_text.strip()) < 2:
            return JsonResponse({"error": "No valid speech detected"}, status=400)

        # Send to chat
        ai_response = service.send_to_chat(user_text)

        # Synthesize and play
        audio_file = service.voice_service.synthesize_speech(ai_response)
        service.voice_service.play_audio(audio_file)

        return JsonResponse(
            {"user_text": user_text, "ai_response": ai_response, "status": "completed"}
        )

    except ImportError as e:
        return JsonResponse(
            {
                "error": "Voice dependencies not available - run locally with 'make install-voice'"
            },
            status=503,
        )
    except Exception as e:
        logger.error(f"voice_assistant_view_error: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["GET"])
def voice_status(request):
    """Check if voice assistant services are available"""
    try:
        from .services import VOICE_DEPENDENCIES_AVAILABLE

        service = VoiceAssistantService()

        status = {
            "voice_dependencies_available": VOICE_DEPENDENCIES_AVAILABLE,
            "wake_word_available": service.wake_word_service is not None,
            "openai_key_available": bool(service.voice_service.api_key),
            "ai_agent_url": service.ai_agent_url,
            "message": (
                "Voice assistant disabled in Docker - run locally with 'make voice'"
                if not VOICE_DEPENDENCIES_AVAILABLE
                else "Voice assistant ready"
            ),
        }

        return JsonResponse(status)

    except Exception as e:
        logger.error(f"voice_assistant_status_error: {e}")
        return JsonResponse({"error": str(e)}, status=500)
