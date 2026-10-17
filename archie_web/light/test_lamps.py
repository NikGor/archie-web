#!/usr/bin/env python3

import logging

from yeelight import Bulb

# Configure logging according to LOGGING_GUIDELINES.md
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# IP адреса ламп
lamps = ["192.168.0.35", "192.168.0.226", "192.168.0.20"]

logger.info("=== STEP 1: Lamp Testing ===")

for i, ip in enumerate(lamps, 1):
    logger.info(
        f"test_lamps_001: Testing lamp \033[33m{i}/3\033[0m at \033[36m{ip}\033[0m"
    )
    try:
        bulb = Bulb(ip)
        properties = bulb.get_properties()

        logger.info(f"test_lamps_002: Properties for \033[36m{ip}\033[0m:")
        for key, value in properties.items():
            if key in ["power", "bright", "ct", "rgb", "model"]:
                color = "\033[32m" if key == "power" and value == "on" else "\033[33m"
                logger.info(f"test_lamps_003:   {key}: {color}{value}\033[0m")

        # Проверяем доступные команды
        methods = [
            method
            for method in dir(bulb)
            if not method.startswith("_") and callable(getattr(bulb, method))
        ]
        available_methods = [
            m
            for m in methods
            if m
            in [
                "turn_on",
                "turn_off",
                "toggle",
                "set_brightness",
                "set_color_temp",
                "set_rgb",
                "set_hsv",
            ]
        ]
        logger.info(
            f"test_lamps_004: Available methods: \033[33m{len(available_methods)}\033[0m"
        )
        for method in sorted(available_methods):
            logger.info(f"test_lamps_005:   \033[35m{method}\033[0m")

    except Exception as e:
        logger.error(
            f"test_lamps_error_001: \033[31mConnection failed to \033[36m{ip}\033[31m: {str(e)}\033[0m"
        )

logger.info("test_lamps_006: Testing completed")
