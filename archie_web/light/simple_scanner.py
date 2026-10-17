#!/usr/bin/env python3

import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "archie_web.settings")

import django

django.setup()

from yeelight import Bulb, discover_bulbs

# Configure logging according to LOGGING_GUIDELINES.md
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def scan_network():
    logger.info("=== STEP 1: Network Scan ===")
    logger.info("scanner_001: Starting Yeelight network discovery...")

    try:
        # Сканируем с большим таймаутом
        discovered = discover_bulbs(timeout=10)

        logger.info(
            f"scanner_002: Discovery complete: \033[33m{len(discovered)}\033[0m devices found"
        )

        for i, bulb_info in enumerate(discovered, 1):
            ip = bulb_info["ip"]
            port = bulb_info.get("port", 55443)

            logger.info(
                f"scanner_003: Device \033[33m{i}/{len(discovered)}\033[0m - \033[36m{ip}:{port}\033[0m"
            )

            # Подключаемся и получаем свойства
            try:
                bulb = Bulb(ip)
                properties = bulb.get_properties()

                power_status = "ON" if properties.get("power") == "on" else "OFF"
                power_color = "\033[32m" if power_status == "ON" else "\033[31m"

                logger.info(f"scanner_004: Status: {power_color}{power_status}\033[0m")
                logger.info(
                    f"scanner_005: Brightness: \033[33m{properties.get('bright', 'N/A')}%\033[0m"
                )
                logger.info(
                    f"scanner_006: Color temp: \033[33m{properties.get('ct', 'N/A')}K\033[0m"
                )
                logger.info(
                    f"scanner_007: Model: \033[35m{properties.get('model', 'Unknown')}\033[0m"
                )
                logger.info(
                    f"scanner_008: ID: \033[36m{properties.get('id', 'Unknown')}\033[0m"
                )

            except Exception as e:
                logger.error(
                    f"scanner_error_001: \033[31mConnection failed to \033[36m{ip}\033[31m: {str(e)}\033[0m"
                )

    except Exception as e:
        logger.error(f"scanner_error_002: \033[31mNetwork scan failed: {str(e)}\033[0m")


if __name__ == "__main__":
    scan_network()
