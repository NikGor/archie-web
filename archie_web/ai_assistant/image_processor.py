import asyncio
import logging
from typing import Any

# from archie_web.webapp.tools.fast_image_generation_tool import fast_image_generation_tool
from archie_web.webapp.tools.profi_image_generation_tool import \
    profi_image_generation_tool

logger = logging.getLogger(__name__)

IMAGE_GENERATION_COST_PER_IMAGE = 0.04


async def process_images_in_ui_answer(
    ui_answer: dict[str, Any],
) -> tuple[dict[str, Any], int]:
    """
    Process all image_prompt fields in UIAnswer structure.
    Generates images and replaces image_prompt values with base64 strings.

    Image parameters:
    - Card in 1_column grid: 16:9, 1K
    - Card in 2_columns grid: 1:1, 1K
    - Standalone Image: 16:9, 2K

    Args:
        ui_answer: UIAnswer dict from AI Agent response

    Returns:
        Tuple of (modified ui_answer with base64 images, count of generated images)
    """
    if not ui_answer or "items" not in ui_answer:
        return ui_answer, 0

    logger.info("image_proc_001: Starting image generation for UIAnswer")

    all_tasks = []
    task_metadata = []

    for item in ui_answer["items"]:
        item_type = item.get("type")

        if item_type == "image":
            content = item.get("content", {})
            prompt = content.get("image_prompt")
            if prompt:
                task = profi_image_generation_tool(
                    prompt=prompt, aspect_ratio="16:9", image_size="2K"
                )
                all_tasks.append(task)
                task_metadata.append({"type": "image", "content": content})
                logger.info(
                    f"image_proc_002: Found image prompt (16:9, 2K): \033[36m{prompt[:50]}...\033[0m"
                )

        elif item_type == "card_grid":
            content = item.get("content", {})
            grid_dimensions = content.get("grid_dimensions", "2_columns")
            cards = content.get("cards", [])

            if grid_dimensions == "1_column":
                aspect_ratio = "16:9"
            else:
                aspect_ratio = "1:1"

            for card in cards:
                if card.get("type") == "card" and card.get("image_prompt"):
                    prompt = card["image_prompt"]
                    task = profi_image_generation_tool(
                        prompt=prompt, aspect_ratio=aspect_ratio, image_size="1K"
                    )
                    all_tasks.append(task)
                    task_metadata.append({"type": "card", "card": card})
                    logger.info(
                        f"image_proc_003: Found card prompt ({aspect_ratio}, 1K): \033[36m{prompt[:50]}...\033[0m"
                    )

    logger.info(
        f"image_proc_004: Collected \033[33m{len(all_tasks)}\033[0m image prompts"
    )

    images_generated = 0

    if all_tasks:
        logger.info(
            f"image_proc_005: Starting parallel generation for \033[33m{len(all_tasks)}\033[0m images"
        )
        results = await asyncio.gather(*all_tasks, return_exceptions=True)

        for metadata, result in zip(task_metadata, results):
            if isinstance(result, Exception):
                logger.error(
                    f"image_proc_error_001: Generation failed for {metadata['type']}"
                )
                continue

            if result.get("success") and result.get("images"):
                base64_img = result["images"][0]["base64"]
                if metadata["type"] == "card":
                    metadata["card"]["image_prompt"] = base64_img
                    logger.info("image_proc_006: Replaced card image prompt")
                else:
                    metadata["content"]["image_prompt"] = base64_img
                    logger.info("image_proc_007: Replaced image prompt")
                images_generated += 1
            else:
                logger.error(
                    f"image_proc_warning_001: Generation unsuccessful for {metadata['type']}"
                )

    logger.info(
        f"image_proc_008: Image generation complete, \033[33m{images_generated}\033[0m images generated"
    )
    return ui_answer, images_generated
