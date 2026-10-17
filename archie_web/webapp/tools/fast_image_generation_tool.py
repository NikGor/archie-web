import asyncio
import base64
import logging
import mimetypes
import os
from typing import Any, Literal

from dotenv import load_dotenv
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)
load_dotenv()


def _generate_image_sync(
    prompt: str,
    aspect_ratio: str,
) -> dict[str, Any]:
    """Synchronous image generation - runs in thread pool."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.error(
            "fast_image_gen_error_001: \033[31mGEMINI_API_KEY not found\033[0m"
        )
        return {
            "success": False,
            "message": "GEMINI_API_KEY not configured",
            "prompt": prompt,
        }

    client = genai.Client(api_key=api_key)

    system_instruction = "Ensure the image has perfect composition and correct geometry. High fidelity, sharp details, no artifacts. If text is present, it must be legible, correctly spelled, and naturally integrated into the surface. High aesthetic quality."

    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(text=prompt),
            ],
        ),
    ]

    generate_content_config = types.GenerateContentConfig(
        response_modalities=["IMAGE", "TEXT"],
        image_config=types.ImageConfig(
            aspect_ratio=aspect_ratio,
        ),
        system_instruction=[
            types.Part.from_text(text=system_instruction),
        ],
    )

    logger.info("fast_image_gen_003: Calling \033[36mGemini 2.5 Flash Image\033[0m")

    image_data = None
    image_mime_type = None
    text_response = ""

    for chunk in client.models.generate_content_stream(
        model="gemini-2.5-flash-image",
        contents=contents,
        config=generate_content_config,
    ):
        if (
            chunk.candidates is None
            or chunk.candidates[0].content is None
            or chunk.candidates[0].content.parts is None
        ):
            continue

        part = chunk.candidates[0].content.parts[0]

        if part.inline_data and part.inline_data.data:
            inline_data = part.inline_data
            image_data = inline_data.data
            image_mime_type = inline_data.mime_type
            logger.info(
                f"fast_image_gen_004: Received image data - mime: \033[33m{image_mime_type}\033[0m"
            )
        elif hasattr(chunk, "text") and chunk.text:
            text_response += chunk.text

    if not image_data:
        logger.warning("fast_image_gen_warning_002: No image data received")
        return {
            "success": False,
            "message": "No image generated",
            "prompt": prompt,
            "text_response": text_response,
        }

    image_base64 = base64.b64encode(image_data).decode("utf-8")
    file_extension = mimetypes.guess_extension(image_mime_type) or ".bin"

    logger.info(
        f"fast_image_gen_005: Successfully generated image with extension \033[33m{file_extension}\033[0m"
    )

    return {
        "success": True,
        "prompt": prompt,
        "image": {
            "base64": image_base64,
            "mime_type": image_mime_type,
            "extension": file_extension,
        },
        "aspect_ratio": aspect_ratio,
        "model": "gemini-2.5-flash-image",
        "text_response": text_response,
        "message": "Successfully generated image using Gemini 2.5 Flash Image",
    }


async def fast_image_generation_tool(
    prompt: str,
    aspect_ratio: Literal["1:1", "3:4", "4:3", "9:16", "16:9"] = "1:1",
) -> dict[str, Any]:
    """
    Fast image generation using Gemini 2.5 Flash Image model.
    Runs synchronous API call in thread pool for true parallelism.
    """
    logger.info(
        f"fast_image_gen_001: Fast generation requested for: \033[36m{prompt[:50]}...\033[0m"
    )
    logger.info(
        f"fast_image_gen_002: Parameters - ratio: \033[33m{aspect_ratio}\033[0m"
    )

    try:
        result = await asyncio.to_thread(_generate_image_sync, prompt, aspect_ratio)
        return result
    except Exception as e:
        logger.error(f"fast_image_gen_error_002: \033[31m{e!s}\033[0m")
        return {
            "success": False,
            "message": f"Fast image generation failed: {e!s}",
            "prompt": prompt,
        }
