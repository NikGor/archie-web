import asyncio
import base64
import binascii
import json
import logging
from urllib.parse import quote
import os
import struct
import uuid

import requests
from archie_shared.voice import DEFAULT_TTS_VOICE, voice_for_persona
from asgiref.sync import async_to_sync
from django.db import transaction
from django.db.models import Count
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from archie_web.redis_client import redis_client

from . import live_session
from .image_processor import (IMAGE_GENERATION_COST_PER_IMAGE,
                              process_images_in_ui_answer)
from .models import Conversation, Message, MessageAudio, MessageFile, MessageImage

# AI Agent URL - keep for AI functionality
AI_AGENT_URL = os.getenv("AI_AGENT_URL", "http://archie-ai-agent:8005")

# --- Persona-voice TTS (OpenRouter Gemini) ---------------------------------
# Mirrors archie-voice: the frontend Voice Chat sends the assistant's answer here
# and gets back audio spoken in the persona's own voice. Requires OPENROUTER_API_KEY
# in the webapp environment; when it is absent the endpoint returns 503 and the
# frontend falls back to the browser's built-in speechSynthesis.
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE = os.getenv("OPENROUTER_BASE", "https://openrouter.ai/api/v1").rstrip(
    "/"
)
TTS_MODEL = os.getenv("TTS_MODEL", "google/gemini-3.1-flash-tts-preview")
TTS_PCM_RATE = int(os.getenv("TTS_PCM_RATE", "24000"))
# Persona -> Gemini voice lives in archie-shared (single source of truth, shared
# with archie-voice). TTS_VOICE env can still override the default fallback.
TTS_DEFAULT_VOICE = os.getenv("TTS_VOICE", DEFAULT_TTS_VOICE)

# Setup logging
logger = logging.getLogger(__name__)


def _pcm_to_wav(pcm_bytes, sample_rate=24000, channels=1, sample_width=2):
    """Wrap raw little-endian PCM16 in a minimal WAV container.

    Gemini TTS only returns headerless PCM; the browser's decodeAudioData needs a
    real container, so we prepend a 44-byte WAV header (no extra deps).
    """
    data_size = len(pcm_bytes)
    byte_rate = sample_rate * channels * sample_width
    block_align = channels * sample_width
    header = b"RIFF" + struct.pack("<I", 36 + data_size) + b"WAVE"
    header += b"fmt " + struct.pack(
        "<IHHIIHH",
        16,  # PCM fmt chunk size
        1,  # audio format = PCM
        channels,
        sample_rate,
        byte_rate,
        block_align,
        sample_width * 8,  # bits per sample
    )
    header += b"data" + struct.pack("<I", data_size)
    return header + pcm_bytes


def add_cors_headers(response):
    """Add CORS headers to response."""
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    response["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response


_PIPELINE_STAGES = ("command_call", "tool_execution", "create_output")


def aggregate_message_trace(llm_trace, pipeline_trace):
    """Aggregate token usage and cost for a single assistant message.

    A message spans several pipeline stages (command_call, tool_execution,
    create_output), each with its own llm_trace and possibly a different model.
    Summing every stage is the only correct per-message cost — the top-level
    llm_trace holds create_output alone and undercounts the command stage.
    Falls back to the top-level trace for direct flows (dashboard/widget) that
    carry no pipeline_trace.
    """
    totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "input_cached_tokens": 0,
        "output_reasoning_tokens": 0,
        "total_cost": 0.0,
    }

    def add(trace):
        totals["input_tokens"] += trace.get("input_tokens") or 0
        totals["output_tokens"] += trace.get("output_tokens") or 0
        totals["total_tokens"] += trace.get("total_tokens") or 0
        totals["total_cost"] += trace.get("total_cost") or 0.0
        totals["input_cached_tokens"] += (trace.get("input_tokens_details") or {}).get(
            "cached_tokens"
        ) or 0
        totals["output_reasoning_tokens"] += (
            trace.get("output_tokens_details") or {}
        ).get("reasoning_tokens") or 0

    found = False
    for stage_key in _PIPELINE_STAGES:
        stage = (pipeline_trace or {}).get(stage_key) or {}
        stage_trace = stage.get("llm_trace") or {}
        if stage_trace.get("total_tokens"):
            add(stage_trace)
            found = True

    if not found and (llm_trace or {}).get("total_tokens"):
        add(llm_trace)

    return totals


@csrf_exempt
@require_http_methods(["GET", "POST", "OPTIONS"])
def proxy_conversations(request):
    """Get conversations from Django DB or create new one (lazy)."""
    logger.info("ai_assistant_001: Processing conversations request")

    if request.method == "OPTIONS":
        response = HttpResponse()
        return add_cors_headers(response)

    try:
        if request.method == "GET":
            logger.info("ai_assistant_002: Fetching conversations from Django DB")
            # Get all conversations from Django models (metadata only, no messages)
            conversations = Conversation.objects.all().order_by("-created_at")

            # Return lightweight data without messages
            conversation_data = []
            for conv in conversations:
                conversation_data.append(
                    {
                        "conversation_id": conv.conversation_id,
                        "title": conv.title,
                        "created_at": conv.created_at.isoformat(),
                        "updated_at": (
                            conv.updated_at.isoformat()
                            if conv.updated_at
                            else conv.created_at.isoformat()
                        ),
                        "total_tokens": conv.total_tokens,
                        "total_cost": (
                            float(conv.total_cost) if conv.total_cost else 0.0
                        ),
                    }
                )

            logger.info(
                f"ai_assistant_003: Found {len(conversation_data)} conversations"
            )
            json_response = JsonResponse(conversation_data, safe=False)

        else:  # POST - create new conversation (LAZY)
            logger.info(
                "ai_assistant_004: Generating new conversation ID (lazy creation)"
            )

            # Parse request data
            data = json.loads(request.body) if request.body else {}
            title = data.get("title", "New Conversation")

            # Generate ID but DO NOT save to DB yet
            # The conversation will be saved only when the first message is sent
            conversation_id = str(uuid.uuid4())

            # Return structure as if it exists
            response_data = {
                "conversation_id": conversation_id,
                "title": title,
                "messages": [],
                "created_at": timezone.now().isoformat(),
                "updated_at": timezone.now().isoformat(),
                "total_tokens": 0,
                "total_cost": 0.0,
                "llm_trace": None,
            }

            logger.info(
                f"ai_assistant_005: Generated lazy conversation ID {conversation_id}"
            )
            json_response = JsonResponse(response_data)

        return add_cors_headers(json_response)

    except Exception as e:
        logger.error(f"ai_assistant_error_001: Failed to process conversations: {e}")
        error_response = JsonResponse({"error": str(e)}, status=500)
        return add_cors_headers(error_response)


@csrf_exempt
@require_http_methods(["GET", "DELETE", "PATCH", "OPTIONS"])
def proxy_conversation_detail(request, conversation_id):
    """Get, update or delete conversation details from Django DB."""
    logger.info(
        f"ai_assistant_006: Processing conversation {conversation_id} detail request"
    )

    if request.method == "OPTIONS":
        response = HttpResponse()
        return add_cors_headers(response)

    try:
        if request.method == "GET":
            logger.info(
                f"ai_assistant_007: Getting conversation {conversation_id} from Django DB"
            )

            # Get conversation from Django models
            conversation = Conversation.objects.get(conversation_id=conversation_id)

            # Convert to Pydantic model for API compatibility
            pydantic_conv = conversation.to_conversation_model()
            json_response = JsonResponse(pydantic_conv.model_dump())

        elif request.method == "PATCH":
            logger.info(f"ai_assistant_007b: Updating conversation {conversation_id}")

            data = json.loads(request.body)
            conversation = Conversation.objects.get(conversation_id=conversation_id)

            if "title" in data:
                conversation.title = data["title"]
                conversation.save()

            pydantic_conv = conversation.to_conversation_model()
            json_response = JsonResponse(pydantic_conv.model_dump())

        else:  # DELETE
            logger.info(
                f"ai_assistant_008: Deleting conversation {conversation_id} from Django DB"
            )

            # Delete conversation and all related messages
            conversation = Conversation.objects.get(conversation_id=conversation_id)
            conversation.delete()

            json_response = JsonResponse(
                {"success": True, "message": f"Conversation {conversation_id} deleted"}
            )

        return add_cors_headers(json_response)

    except Conversation.DoesNotExist:
        logger.error(
            f"ai_assistant_error_002: Conversation {conversation_id} not found"
        )
        error_response = JsonResponse({"error": "Conversation not found"}, status=404)
        return add_cors_headers(error_response)

    except Exception as e:
        logger.error(
            f"ai_assistant_error_003: Failed to process conversation detail: {e}"
        )
        error_response = JsonResponse({"error": str(e)}, status=500)
        return add_cors_headers(error_response)


@csrf_exempt
@require_http_methods(["GET", "OPTIONS"])
def proxy_conversation_messages(request, conversation_id):
    """Get messages for a specific conversation from Django DB."""
    logger.info(
        f"ai_assistant_009: Processing messages request for conversation {conversation_id}"
    )

    if request.method == "OPTIONS":
        response = HttpResponse()
        return add_cors_headers(response)

    try:
        logger.info(
            f"ai_assistant_010: Fetching messages for conversation {conversation_id} from Django DB"
        )

        # Get messages from Django models
        messages = Message.objects.filter(
            conversation__conversation_id=conversation_id
        ).order_by("created_at")

        # Which of these messages have a saved voice recording (one query).
        audio_ids = set(
            MessageAudio.objects.filter(
                message__conversation__conversation_id=conversation_id
            ).values_list("message_id", flat=True)
        )

        # Number of attached images per message (one query).
        image_counts = dict(
            MessageImage.objects.filter(
                message__conversation__conversation_id=conversation_id
            )
            .values("message_id")
            .annotate(n=Count("pk"))
            .values_list("message_id", "n")
        )

        # Attached documents per message (metadata only, never the binary column).
        files_by_message = {}
        for row in MessageFile.objects.filter(
            message__conversation__conversation_id=conversation_id
        ).values("message_id", "position", "name", "size", "content_type"):
            files_by_message.setdefault(str(row["message_id"]), []).append(
                {
                    "position": row["position"],
                    "name": row["name"],
                    "size": row["size"],
                    "content_type": row["content_type"],
                }
            )

        # Convert to Pydantic models for API compatibility
        message_data = []
        for msg in messages:
            pydantic_msg = msg.to_chat_message()
            msg_dict = pydantic_msg.model_dump()
            msg_dict["has_audio"] = str(msg.message_id) in audio_ids
            msg_dict["image_count"] = image_counts.get(str(msg.message_id), 0)
            msg_dict["files"] = sorted(
                files_by_message.get(str(msg.message_id), []),
                key=lambda f: f["position"],
            )
            logger.info(
                f"ai_assistant_011a: Message {msg.message_id} dict keys: {msg_dict.keys()}"
            )
            logger.info(
                f"ai_assistant_011b: Message content keys: {msg_dict.get('content', {}).keys() if isinstance(msg_dict.get('content'), dict) else 'NOT A DICT'}"
            )
            if msg_dict.get("content", {}).get("ui_answer"):
                logger.info(
                    f"ai_assistant_011c: Message has ui_answer with {len(msg_dict['content']['ui_answer'].get('items', []))} items"
                )
            message_data.append(msg_dict)

        logger.info(
            f"ai_assistant_011: Found {len(message_data)} messages for conversation {conversation_id}"
        )
        json_response = JsonResponse(message_data, safe=False)
        return add_cors_headers(json_response)

    except Exception as e:
        logger.error(
            f"ai_assistant_error_004: Failed to get conversation messages: {e}"
        )
        error_response = JsonResponse({"error": str(e)}, status=500)
        return add_cors_headers(error_response)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def proxy_send_message(request):
    """Send message to AI Agent and save to Django DB."""
    logger.info("ai_assistant_012: Processing send message request")

    if request.method == "OPTIONS":
        response = HttpResponse()
        return add_cors_headers(response)

    try:
        data = json.loads(request.body)
        conversation_id = data.get("conversation_id")
        user_input = data.get("input")

        if not conversation_id:
            raise ValueError("conversation_id is required")

        # 1. Check/Create Conversation
        try:
            conversation = Conversation.objects.get(conversation_id=conversation_id)
        except Conversation.DoesNotExist:
            logger.info(
                f"ai_assistant_013: Creating new conversation {conversation_id} on first message"
            )
            conversation = Conversation.objects.create(
                conversation_id=conversation_id,
                title=f"Chat {timezone.now().strftime('%Y-%m-%d %H:%M')}",
            )

        # 2. Save User Message
        user_message_id = str(uuid.uuid4())
        user_content = {"content_format": "plain", "text": user_input}

        Message.objects.create(
            message_id=user_message_id,
            conversation=conversation,
            role="user",
            content=user_content,
            created_at=timezone.now(),
        )
        logger.info(f"ai_assistant_014: Saved user message {user_message_id}")

        # 3. Call AI Agent
        logger.info("ai_assistant_015: Calling AI Agent")
        ai_response = requests.post(f"{AI_AGENT_URL}/chat", json=data)
        ai_response.raise_for_status()
        ai_data = ai_response.json()

        # 3.5 Process images if ui_answer exists
        assistant_content = ai_data.get("content", {})
        if assistant_content.get(
            "content_format"
        ) == "ui_answer" and assistant_content.get("ui_answer"):
            logger.info("ai_assistant_015a: Processing images in ui_answer")
            try:
                ui_answer = assistant_content["ui_answer"]
                processed_ui_answer, _ = async_to_sync(process_images_in_ui_answer)(
                    ui_answer
                )
                assistant_content["ui_answer"] = processed_ui_answer
                ai_data["content"] = assistant_content
            except Exception as img_error:
                logger.error(
                    f"ai_assistant_error_006: Image processing failed: {img_error}"
                )

        # 4. Save Assistant Message
        # AI Agent returns a Message object structure
        assistant_message_id = ai_data.get("message_id", str(uuid.uuid4()))
        assistant_llm_trace = ai_data.get("llm_trace", {})
        assistant_pipeline_trace = ai_data.get("pipeline_trace")

        # Per-message cost is the sum of all pipeline stages (command_call may
        # run on a different, pricier model than create_output).
        totals = aggregate_message_trace(assistant_llm_trace, assistant_pipeline_trace)
        input_tokens = totals["input_tokens"]
        output_tokens = totals["output_tokens"]
        total_tokens = totals["total_tokens"]
        total_cost = totals["total_cost"]

        # Update conversation stats
        if total_tokens:
            conversation.total_tokens += total_tokens
            conversation.total_input_tokens += input_tokens
            conversation.total_input_cached_tokens += totals["input_cached_tokens"]
            conversation.total_output_tokens += output_tokens
            conversation.total_output_reasoning_tokens += totals[
                "output_reasoning_tokens"
            ]
            conversation.total_cost += total_cost
            conversation.save()

        Message.objects.create(
            message_id=assistant_message_id,
            conversation=conversation,
            role="assistant",
            content=assistant_content,
            response_format=ai_data.get("response_format") or data.get("response_format"),
            model=ai_data.get("model"),
            created_at=timezone.now(),
            llm_trace=assistant_llm_trace,
            input_tokens=input_tokens,
            input_cached_tokens=totals["input_cached_tokens"],
            output_tokens=output_tokens,
            output_reasoning_tokens=totals["output_reasoning_tokens"],
            total_tokens=total_tokens,
            total_cost=total_cost,
            pipeline_trace=assistant_pipeline_trace,
        )
        logger.info(f"ai_assistant_016: Saved assistant message {assistant_message_id}")

        # Expose the user message id so voice clients can attach the user's audio
        # recording (the assistant id is already in ai_data["message_id"]).
        if isinstance(ai_data, dict):
            ai_data["user_message_id"] = user_message_id

        json_response = JsonResponse(ai_data, safe=False)
        return add_cors_headers(json_response)

    except Exception as e:
        logger.error(f"ai_assistant_error_005: Failed to send message: {e}")
        error_response = JsonResponse({"error": str(e)}, status=500)
        return add_cors_headers(error_response)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def proxy_chat(request):
    """Proxy for sending chat messages to API."""
    if request.method == "OPTIONS":
        response = HttpResponse()
        return add_cors_headers(response)

    try:
        data = json.loads(request.body)

        user_name = data.get("user_name")
        if user_name and "device_id" not in data:
            device_id = redis_client.get_user_field(user_name, "spotify_device_id")
            if device_id:
                data["device_id"] = device_id

        response = requests.post(f"{AI_AGENT_URL}/chat", json=data)
        json_response = JsonResponse(response.json(), safe=False)
        return add_cors_headers(json_response)
    except Exception as e:
        error_response = JsonResponse({"error": str(e)}, status=500)
        return add_cors_headers(error_response)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def generate_title(request):
    """Generate a short title for a conversation based on user message."""
    logger.info("ai_assistant_020: Processing generate title request")

    if request.method == "OPTIONS":
        response = HttpResponse()
        return add_cors_headers(response)

    try:
        data = json.loads(request.body)
        user_message = data.get("message", "")

        if not user_message:
            error_response = JsonResponse({"error": "Message is required"}, status=400)
            return add_cors_headers(error_response)

        # Call AI Agent to generate title
        ai_request = {
            "user_name": "system",
            "response_format": "plain",
            "input": f'Generate a short title (3-5 words, no quotes, no emoji) for a conversation that starts with: "{user_message}"',
        }

        response = requests.post(f"{AI_AGENT_URL}/chat", json=ai_request, timeout=30)

        if response.status_code == 200:
            ai_data = response.json()
            title = ai_data.get("content", {}).get("text", "").strip()
            # Clean up title
            title = title.strip("\"'")
            if len(title) > 50:
                title = title[:47] + "..."

            logger.info(f"ai_assistant_021: Generated title: {title}")
            json_response = JsonResponse({"title": title})
            return add_cors_headers(json_response)
        else:
            logger.error(
                f"ai_assistant_error_020: AI Agent returned {response.status_code}"
            )
            error_response = JsonResponse(
                {"error": "Failed to generate title"}, status=500
            )
            return add_cors_headers(error_response)

    except Exception as e:
        logger.error(f"ai_assistant_error_021: Failed to generate title: {e}")
        error_response = JsonResponse({"error": str(e)}, status=500)
        return add_cors_headers(error_response)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def regenerate_title(request, conversation_id):
    """Regenerate title for existing conversation based on chat history."""
    logger.info(
        f"ai_assistant_030: Processing regenerate title request for {conversation_id}"
    )

    if request.method == "OPTIONS":
        response = HttpResponse()
        return add_cors_headers(response)

    try:
        conversation = Conversation.objects.get(conversation_id=conversation_id)
        chat_history = conversation.get_chat_history_yaml()
        if not chat_history:
            error_response = JsonResponse(
                {"error": "No chat history found"}, status=400
            )
            return add_cors_headers(error_response)
        history_preview = (
            chat_history[:1000] if len(chat_history) > 1000 else chat_history
        )
        ai_request = {
            "user_name": "system",
            "response_format": "plain",
            "input": f"Generate a short title (3-5 words, no quotes, no emoji) for this conversation:\n\n{history_preview}",
        }
        response = requests.post(f"{AI_AGENT_URL}/chat", json=ai_request, timeout=30)
        if response.status_code == 200:
            ai_data = response.json()
            title = ai_data.get("content", {}).get("text", "").strip()
            title = title.strip("\"'")
            if len(title) > 50:
                title = title[:47] + "..."
            conversation.title = title
            conversation.save()
            logger.info(f"ai_assistant_031: Regenerated title: {title}")
            json_response = JsonResponse(
                {"title": title, "conversation_id": conversation_id}
            )
            return add_cors_headers(json_response)
        logger.error(
            f"ai_assistant_error_030: AI Agent returned {response.status_code}"
        )
        error_response = JsonResponse(
            {"error": "Failed to regenerate title"}, status=500
        )
        return add_cors_headers(error_response)
    except Conversation.DoesNotExist:
        logger.error(
            f"ai_assistant_error_031: Conversation {conversation_id} not found"
        )
        error_response = JsonResponse({"error": "Conversation not found"}, status=404)
        return add_cors_headers(error_response)
    except Exception as e:
        logger.error(f"ai_assistant_error_032: Failed to regenerate title: {e}")
        error_response = JsonResponse({"error": str(e)}, status=500)
        return add_cors_headers(error_response)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def process_images(request):
    """Process images in ui_answer - generate images from prompts."""
    logger.info("ai_assistant_040: Processing images request")
    if request.method == "OPTIONS":
        response = HttpResponse()
        return add_cors_headers(response)
    try:
        data = json.loads(request.body)
        ui_answer = data.get("ui_answer")
        if not ui_answer:
            error_response = JsonResponse(
                {"error": "ui_answer is required"}, status=400
            )
            return add_cors_headers(error_response)
        logger.info("ai_assistant_041: Starting image processing")
        processed_ui_answer, images_generated = async_to_sync(
            process_images_in_ui_answer
        )(ui_answer)
        image_cost = images_generated * IMAGE_GENERATION_COST_PER_IMAGE
        logger.info(
            f"ai_assistant_042: Image processing completed, \033[33m{images_generated}\033[0m images, cost \033[33m${image_cost:.4f}\033[0m"
        )
        json_response = JsonResponse(
            {
                "ui_answer": processed_ui_answer,
                "images_generated": images_generated,
                "image_cost": image_cost,
            }
        )
        return add_cors_headers(json_response)
    except Exception as e:
        logger.error(f"ai_assistant_error_040: Failed to process images: {e}")
        error_response = JsonResponse({"error": str(e)}, status=500)
        return add_cors_headers(error_response)


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def save_message(request):
    """Save a message to conversation after WebSocket response."""
    logger.info("ai_assistant_050: Saving message request")
    if request.method == "OPTIONS":
        response = HttpResponse()
        return add_cors_headers(response)
    try:
        data = json.loads(request.body)
        conversation_id = data.get("conversation_id")
        message_data = data.get("message")
        if not conversation_id or not message_data:
            error_response = JsonResponse(
                {"error": "conversation_id and message are required"}, status=400
            )
            return add_cors_headers(error_response)
        try:
            conversation = Conversation.objects.get(conversation_id=conversation_id)
        except Conversation.DoesNotExist:
            logger.info(
                f"ai_assistant_051: Creating new conversation {conversation_id}"
            )
            conversation = Conversation.objects.create(
                conversation_id=conversation_id,
                title=f"Chat {timezone.now().strftime('%Y-%m-%d %H:%M')}",
            )
        message_id = message_data.get("message_id", str(uuid.uuid4()))
        role = message_data.get("role", "user")
        content = message_data.get("content", {})
        llm_trace = message_data.get("llm_trace", {})
        pipeline_steps = message_data.get("pipeline_steps", [])
        pipeline_trace = message_data.get("pipeline_trace")

        # Per-message cost is the sum of all pipeline stages (command_call may
        # run on a different, pricier model than create_output).
        totals = aggregate_message_trace(llm_trace, pipeline_trace)

        Message.objects.create(
            message_id=message_id,
            conversation=conversation,
            role=role,
            content=content,
            response_format=message_data.get("response_format"),
            model=message_data.get("model"),
            created_at=timezone.now(),
            llm_trace=llm_trace,
            input_tokens=totals["input_tokens"],
            input_cached_tokens=totals["input_cached_tokens"],
            output_tokens=totals["output_tokens"],
            output_reasoning_tokens=totals["output_reasoning_tokens"],
            total_tokens=totals["total_tokens"],
            total_cost=totals["total_cost"],
            pipeline_steps=pipeline_steps,
            pipeline_trace=pipeline_trace,
        )
        if totals["total_tokens"]:
            conversation.total_tokens += totals["total_tokens"]
            conversation.total_input_tokens += totals["input_tokens"]
            conversation.total_input_cached_tokens += totals["input_cached_tokens"]
            conversation.total_output_tokens += totals["output_tokens"]
            conversation.total_output_reasoning_tokens += totals[
                "output_reasoning_tokens"
            ]
            conversation.total_cost += totals["total_cost"]
            conversation.save()
        logger.info(f"ai_assistant_052: Saved {role} message {message_id}")
        json_response = JsonResponse({"success": True, "message_id": message_id})
        return add_cors_headers(json_response)
    except Exception as e:
        logger.error(f"ai_assistant_error_050: Failed to save message: {e}")
        error_response = JsonResponse({"error": str(e)}, status=500)
        return add_cors_headers(error_response)


def _user_state(user_name):
    """Redis UserState for `user_name` (persona, language…), or None."""
    if not user_name:
        return None
    try:
        return redis_client.get_user_state_by_name(user_name)
    except Exception as e:
        logger.error(f"ai_assistant_error_060: user state lookup failed: {e}")
        return None


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def live_token(request):
    """Mint an ephemeral Gemini Live token for the frontend Voice Chat (Live mode).

    Body: {"user_name"?: str}. The persona/language come from the user's Redis
    state and are locked into the token (voice, system instruction, ask_archie
    tool), so the browser can open the Live WebSocket without GEMINI_API_KEY.
    Returns {"token", "ws_url", "model", "voice"}; 503 when Live is not configured.
    """
    logger.info("ai_assistant_070: Processing Live token request")
    if request.method == "OPTIONS":
        return add_cors_headers(HttpResponse())
    if not live_session.GEMINI_API_KEY:
        logger.warning("ai_assistant_071: Live requested but GEMINI_API_KEY is not set")
        return add_cors_headers(
            JsonResponse({"error": "Live voice not configured"}, status=503)
        )
    try:
        data = json.loads(request.body) if request.body else {}
        state = _user_state(data.get("user_name"))
        result = live_session.create_live_token(
            persona=getattr(state, "persona", None) if state else None,
            language=getattr(state, "language", None) if state else None,
        )
        return add_cors_headers(JsonResponse(result))
    except Exception as e:
        logger.error(f"ai_assistant_error_070: Live token failed: {e}")
        return add_cors_headers(
            JsonResponse({"error": "Live token upstream error"}, status=502)
        )


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def synth_speech(request):
    """Synthesize an assistant answer in the caller's persona voice.

    Body: {"text": str, "persona"?: str, "user_name"?: str}. The persona picks the
    Gemini voice (PERSONA_VOICES); if it is omitted we resolve it from the user's
    Redis state. Returns audio/wav (PCM16 @ 24 kHz). Used by the frontend Voice
    Chat; on 4xx/5xx the frontend falls back to browser speechSynthesis.
    """
    logger.info("ai_assistant_060: Processing TTS request")
    if request.method == "OPTIONS":
        return add_cors_headers(HttpResponse())
    try:
        data = json.loads(request.body) if request.body else {}
        text = (data.get("text") or "").strip()
        if not text:
            return add_cors_headers(
                JsonResponse({"error": "text is required"}, status=400)
            )
        if not OPENROUTER_API_KEY:
            logger.warning(
                "ai_assistant_061: TTS requested but OPENROUTER_API_KEY is not set"
            )
            return add_cors_headers(
                JsonResponse({"error": "TTS not configured"}, status=503)
            )

        persona = data.get("persona")
        if not persona:
            state = _user_state(data.get("user_name"))
            persona = getattr(state, "persona", None) if state else None
        voice = voice_for_persona(persona) if persona else TTS_DEFAULT_VOICE

        resp = requests.post(
            f"{OPENROUTER_BASE}/audio/speech",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": TTS_MODEL,
                "input": text,
                "voice": voice,
                "response_format": "pcm",
            },
            timeout=120,
        )
        if resp.status_code >= 400:
            logger.error(
                f"ai_assistant_error_061: TTS upstream {resp.status_code}: "
                f"{resp.text[:300]}"
            )
            return add_cors_headers(
                JsonResponse({"error": "TTS upstream error"}, status=502)
            )

        wav = _pcm_to_wav(resp.content, TTS_PCM_RATE)
        logger.info(
            f"ai_assistant_062: Synthesized {len(wav)} bytes "
            f"(persona={persona}, voice={voice})"
        )
        audio_response = HttpResponse(wav, content_type="audio/wav")
        audio_response["X-Voice"] = voice
        return add_cors_headers(audio_response)
    except Exception as e:
        logger.error(f"ai_assistant_error_062: TTS failed: {e}")
        return add_cors_headers(JsonResponse({"error": str(e)}, status=500))


# Cap on a single stored recording (keeps the DB and uploads sane).
MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10 MB


@csrf_exempt
@require_http_methods(["GET", "POST", "OPTIONS"])
def message_audio(request, message_id):
    """Store or serve the voice recording for a message.

    POST: raw audio bytes in the request body, mime type in the Content-Type
    header (e.g. audio/webm for a user recording, audio/wav for a TTS answer).
    GET: returns the stored bytes with their content type (200) or 404 if none.
    Audio lives in the DB (MessageAudio), one recording per message.
    """
    if request.method == "OPTIONS":
        return add_cors_headers(HttpResponse())

    if request.method == "GET":
        try:
            rec = MessageAudio.objects.get(message_id=message_id)
        except MessageAudio.DoesNotExist:
            return add_cors_headers(JsonResponse({"error": "no audio"}, status=404))
        resp = HttpResponse(bytes(rec.audio), content_type=rec.content_type)
        resp["Cache-Control"] = "private, max-age=31536000"
        return add_cors_headers(resp)

    # POST — store the recording
    try:
        data = request.body or b""
        if not data:
            return add_cors_headers(
                JsonResponse({"error": "empty audio body"}, status=400)
            )
        if len(data) > MAX_AUDIO_BYTES:
            return add_cors_headers(
                JsonResponse({"error": "audio too large"}, status=413)
            )
        try:
            message = Message.objects.get(message_id=message_id)
        except Message.DoesNotExist:
            return add_cors_headers(
                JsonResponse({"error": "message not found"}, status=404)
            )
        content_type = request.content_type or "audio/webm"
        MessageAudio.objects.update_or_create(
            message=message,
            defaults={"audio": data, "content_type": content_type},
        )
        logger.info(
            f"ai_assistant_070: Saved {len(data)} bytes of {content_type} "
            f"for message {message_id}"
        )
        return add_cors_headers(JsonResponse({"success": True, "bytes": len(data)}))
    except Exception as e:
        logger.error(f"ai_assistant_error_070: Failed to save audio: {e}")
        return add_cors_headers(JsonResponse({"error": str(e)}, status=500))


# Limits for user-attached images (the frontend downsizes to ~1568px JPEG first).
MAX_IMAGES_PER_MESSAGE = 4
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB per image
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def message_images(request, message_id):
    """Store the images a user attached to a message.

    POST JSON: {"images": [{"media_type": "image/jpeg", "data": "<base64>"}, ...]}
    Replaces any previously stored images for the message. Images live in the DB
    (MessageImage) and are served by `message_image`.
    """
    if request.method == "OPTIONS":
        return add_cors_headers(HttpResponse())

    try:
        payload = json.loads(request.body or b"{}")
        items = payload.get("images") or []
        if not items:
            return add_cors_headers(JsonResponse({"error": "no images"}, status=400))
        if len(items) > MAX_IMAGES_PER_MESSAGE:
            return add_cors_headers(JsonResponse({"error": "too many images"}, status=413))
        try:
            message = Message.objects.get(message_id=message_id)
        except Message.DoesNotExist:
            return add_cors_headers(JsonResponse({"error": "message not found"}, status=404))

        records = []
        for position, item in enumerate(items):
            media_type = item.get("media_type")
            if media_type not in ALLOWED_IMAGE_TYPES:
                return add_cors_headers(
                    JsonResponse({"error": f"unsupported media_type: {media_type}"}, status=400)
                )
            try:
                data = base64.b64decode(item.get("data") or "", validate=True)
            except (binascii.Error, ValueError):
                return add_cors_headers(JsonResponse({"error": "invalid base64"}, status=400))
            if not data:
                return add_cors_headers(JsonResponse({"error": "empty image"}, status=400))
            if len(data) > MAX_IMAGE_BYTES:
                return add_cors_headers(JsonResponse({"error": "image too large"}, status=413))
            records.append(
                MessageImage(
                    message=message, position=position, image=data, content_type=media_type
                )
            )

        with transaction.atomic():
            MessageImage.objects.filter(message=message).delete()
            MessageImage.objects.bulk_create(records)
        logger.info(f"ai_assistant_071: Saved {len(records)} image(s) for message {message_id}")
        return add_cors_headers(JsonResponse({"success": True, "count": len(records)}))
    except json.JSONDecodeError:
        return add_cors_headers(JsonResponse({"error": "invalid JSON"}, status=400))
    except Exception as e:
        logger.error(f"ai_assistant_error_071: Failed to save images: {e}")
        return add_cors_headers(JsonResponse({"error": str(e)}, status=500))


@csrf_exempt
@require_http_methods(["GET", "OPTIONS"])
def message_image(request, message_id, position):
    """Serve one stored attachment image (200) or 404."""
    if request.method == "OPTIONS":
        return add_cors_headers(HttpResponse())
    try:
        rec = MessageImage.objects.get(message_id=message_id, position=position)
    except MessageImage.DoesNotExist:
        return add_cors_headers(JsonResponse({"error": "no image"}, status=404))
    resp = HttpResponse(bytes(rec.image), content_type=rec.content_type)
    resp["Cache-Control"] = "private, max-age=31536000"
    return add_cors_headers(resp)


# Limits for user-attached documents (the agent WS payload is capped at ~16 MB).
MAX_FILES_PER_MESSAGE = 5
MAX_FILE_BYTES = 8 * 1024 * 1024  # 8 MB per file


def _stored_file_type(name, data):
    """Server-decided content type: only a real PDF is served as PDF."""
    if name.lower().endswith(".pdf") and data.startswith(b"%PDF"):
        return "application/pdf"
    return "application/octet-stream"


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def message_files(request, message_id):
    """Store the documents a user attached to a message.

    POST JSON: {"files": [{"name": "a.pdf", "media_type": "...", "data": "<base64>"}]}
    Replaces any previously stored files for the message.
    """
    if request.method == "OPTIONS":
        return add_cors_headers(HttpResponse())

    try:
        payload = json.loads(request.body or b"{}")
        items = payload.get("files") or []
        if not items:
            return add_cors_headers(JsonResponse({"error": "no files"}, status=400))
        if len(items) > MAX_FILES_PER_MESSAGE:
            return add_cors_headers(JsonResponse({"error": "too many files"}, status=413))
        try:
            message = Message.objects.get(message_id=message_id)
        except Message.DoesNotExist:
            return add_cors_headers(JsonResponse({"error": "message not found"}, status=404))

        records = []
        for position, item in enumerate(items):
            name = (item.get("name") or "").strip()[:255]
            if not name:
                return add_cors_headers(JsonResponse({"error": "file name required"}, status=400))
            try:
                data = base64.b64decode(item.get("data") or "", validate=True)
            except (binascii.Error, ValueError):
                return add_cors_headers(JsonResponse({"error": "invalid base64"}, status=400))
            if not data:
                return add_cors_headers(JsonResponse({"error": "empty file"}, status=400))
            if len(data) > MAX_FILE_BYTES:
                return add_cors_headers(JsonResponse({"error": "file too large"}, status=413))
            records.append(
                MessageFile(
                    message=message,
                    position=position,
                    name=name,
                    content_type=_stored_file_type(name, data),
                    size=len(data),
                    data=data,
                )
            )

        with transaction.atomic():
            MessageFile.objects.filter(message=message).delete()
            MessageFile.objects.bulk_create(records)
        logger.info(f"ai_assistant_072: Saved {len(records)} file(s) for message {message_id}")
        return add_cors_headers(JsonResponse({"success": True, "count": len(records)}))
    except json.JSONDecodeError:
        return add_cors_headers(JsonResponse({"error": "invalid JSON"}, status=400))
    except Exception as e:
        logger.error(f"ai_assistant_error_072: Failed to save files: {e}")
        return add_cors_headers(JsonResponse({"error": str(e)}, status=500))


@csrf_exempt
@require_http_methods(["GET", "OPTIONS"])
def message_file(request, message_id, position):
    """Serve one stored attachment: PDFs inline, everything else as a download.

    User-uploaded content is served from our origin, so anything that is not a
    verified PDF is forced to `attachment` + octet-stream (no HTML/JS execution).
    """
    if request.method == "OPTIONS":
        return add_cors_headers(HttpResponse())
    try:
        rec = MessageFile.objects.get(message_id=message_id, position=position)
    except MessageFile.DoesNotExist:
        return add_cors_headers(JsonResponse({"error": "no file"}, status=404))
    resp = HttpResponse(bytes(rec.data), content_type=rec.content_type)
    disposition = "inline" if rec.content_type == "application/pdf" else "attachment"
    resp["Content-Disposition"] = f"{disposition}; filename*=UTF-8''{quote(rec.name)}"
    resp["X-Content-Type-Options"] = "nosniff"
    resp["Cache-Control"] = "private, max-age=31536000"
    return add_cors_headers(resp)
