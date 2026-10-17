import logging
import socket
import threading
import time
from typing import Any, Dict, List, Optional

from django.conf import settings
from yeelight import Bulb, BulbException, discover_bulbs

logger = logging.getLogger(__name__)


class YeelightDevice:
    """Класс для представления найденного Yeelight устройства"""

    def __init__(self, ip: str, port: int = 55443, properties: Dict = None):
        self.ip = ip
        self.port = port
        self.properties = properties or {}
        self.bulb = None
        self.last_seen = time.time()
        self._connected = False

    @property
    def id(self):
        """Уникальный ID устройства"""
        return self.properties.get("id", f"{self.ip}:{self.port}")

    @id.setter
    def id(self, value):
        """Установить ID устройства"""
        self.properties["id"] = value

    @property
    def name(self):
        """Название устройства"""
        return self.properties.get("name", f"Yeelight {self.ip.split('.')[-1]}")

    @name.setter
    def name(self, value):
        """Установить название устройства"""
        self.properties["name"] = value

    @property
    def model(self):
        """Модель устройства"""
        return self.properties.get("model", "Unknown")

    @property
    def is_on(self):
        """Включено ли устройство"""
        return self.properties.get("power", "off") == "on"

    @property
    def brightness(self):
        """Яркость устройства"""
        return int(self.properties.get("bright", 100))

    @property
    def color_temp(self):
        """Цветовая температура"""
        return int(self.properties.get("ct", 4000))

    @property
    def rgb_color(self):
        """RGB цвет в hex формате"""
        rgb = self.properties.get("rgb", 16777215)  # Белый по умолчанию
        try:
            rgb_int = int(rgb)
            return f"#{rgb_int:06x}"
        except (ValueError, TypeError):
            return "#ffffff"  # Белый по умолчанию при ошибке

    def connect(self) -> bool:
        """Подключиться к устройству"""
        if self._connected and self.bulb:
            return True

        try:
            self.bulb = Bulb(self.ip, port=self.port)
            self.bulb.get_properties()
            self._connected = True
            logger.info(
                f"light_ctrl_001: Connected to \033[35m{self.name}\033[0m (\033[36m{self.ip}\033[0m)"
            )
            return True
        except Exception as e:
            logger.error(
                f"light_ctrl_error_001: \033[31mConnection failed to \033[36m{self.ip}\033[31m: {str(e)}\033[0m"
            )
            self._connected = False
            return False

    def update_properties(self):
        """Обновить свойства устройства"""
        if not self.connect():
            return False

        try:
            self.properties.update(self.bulb.get_properties())
            self.last_seen = time.time()
            return True
        except Exception as e:
            logger.error(
                f"light_ctrl_error_002: \033[31mProperties update failed for \033[36m{self.ip}\033[31m: {str(e)}\033[0m"
            )
            self._connected = False
            return False


class LightController:
    """Контроллер для автоматического обнаружения и управления Yeelight устройствами"""

    def __init__(self):
        self.devices: Dict[str, YeelightDevice] = {}
        self.scanning = False
        self.scan_thread = None
        self.auto_scan_enabled = False  # Автосканирование отключено
        self.scan_interval = 30  # Сканирование каждые 30 секунд

    def discover_devices(self, timeout: int = 5) -> List[YeelightDevice]:
        """Сканировать сеть для поиска Yeelight устройств"""
        logger.info("=== STEP 1: Device Discovery ===")
        logger.info(
            f"light_ctrl_002: Starting Yeelight scan with timeout \033[33m{timeout}s\033[0m"
        )

        try:
            # Используем встроенную функцию yeelight для обнаружения
            discovered = discover_bulbs(timeout=timeout)
            found_devices = []

            for bulb_info in discovered:
                ip = bulb_info["ip"]
                port = bulb_info.get("port", 55443)

                # Создаем объект устройства
                device = YeelightDevice(ip, port)

                # Подключаемся и получаем свойства
                if device.connect():
                    device.update_properties()
                    found_devices.append(device)

                    # Добавляем или обновляем в списке устройств
                    device_id = device.id
                    self.devices[device_id] = device

                    logger.info(
                        f"light_ctrl_003: Found device \033[35m{device.name}\033[0m (\033[36m{device.ip}\033[0m)"
                    )

            logger.info(
                f"light_ctrl_004: Discovery complete: \033[33m{len(found_devices)}\033[0m devices found"
            )
            return found_devices

        except Exception as e:
            logger.error(
                f"light_ctrl_error_003: \033[31mDevice discovery failed: {str(e)}\033[0m"
            )
            return []

    def get_device(self, device_id: str) -> Optional[YeelightDevice]:
        """Получить устройство по ID"""
        return self.devices.get(device_id)

    def get_device_by_ip(self, ip: str) -> Optional[YeelightDevice]:
        """Получить устройство по IP"""
        for device in self.devices.values():
            if device.ip == ip:
                return device
        return None

    def get_all_devices(self) -> List[YeelightDevice]:
        """Получить все найденные устройства"""
        return list(self.devices.values())

    def refresh_devices(self):
        """Обновить информацию о всех устройствах"""
        for device in self.devices.values():
            device.update_properties()

    def start_auto_scan(self):
        """Запустить автоматическое сканирование в фоне"""
        if self.scanning:
            return

        self.scanning = True
        self.scan_thread = threading.Thread(target=self._auto_scan_loop, daemon=True)
        self.scan_thread.start()
        logger.info(
            f"light_ctrl_005: Auto-scan started with \033[33m{self.scan_interval}s\033[0m interval"
        )

    def stop_auto_scan(self):
        """Остановить автоматическое сканирование"""
        self.scanning = False
        if self.scan_thread:
            self.scan_thread.join(timeout=1)
        logger.info("light_ctrl_006: Auto-scan stopped")

    def _auto_scan_loop(self):
        """Цикл автоматического сканирования"""
        while self.scanning and self.auto_scan_enabled:
            try:
                self.discover_devices()
                time.sleep(self.scan_interval)
            except Exception as e:
                logger.error(
                    f"light_ctrl_error_004: \033[31mAuto-scan error: {str(e)}\033[0m"
                )
                time.sleep(5)

    # Методы управления устройствами
    def turn_on(self, device_id: str, brightness: Optional[int] = None) -> bool:
        """Включить устройство"""
        device = self.get_device(device_id)
        if not device or not device.connect():
            return False

        try:
            device.bulb.turn_on()
            if brightness is not None and 1 <= brightness <= 100:
                device.bulb.set_brightness(brightness)

            device.update_properties()
            logger.info(
                f"light_ctrl_007: Device \033[35m{device.name}\033[0m turned \033[32mON\033[0m"
            )
            return True

        except BulbException as e:
            logger.error(
                f"light_ctrl_error_005: \033[31mTurn ON failed for \033[35m{device.name}\033[31m: {str(e)}\033[0m"
            )
            return False

    def turn_off(self, device_id: str) -> bool:
        """Выключить устройство"""
        device = self.get_device(device_id)
        if not device or not device.connect():
            return False

        try:
            device.bulb.turn_off()
            device.update_properties()
            logger.info(
                f"light_ctrl_008: Device \033[35m{device.name}\033[0m turned \033[31mOFF\033[0m"
            )
            return True

        except BulbException as e:
            logger.error(
                f"light_ctrl_error_006: \033[31mTurn OFF failed for \033[35m{device.name}\033[31m: {str(e)}\033[0m"
            )
            return False

    def toggle(self, device_id: str) -> bool:
        """Переключить состояние устройства"""
        device = self.get_device(device_id)
        if not device or not device.connect():
            return False

        try:
            device.bulb.toggle()
            device.update_properties()
            logger.info(
                f"light_ctrl_009: Device \033[35m{device.name}\033[0m \033[33mtoggled\033[0m"
            )
            return True

        except BulbException as e:
            logger.error(
                f"light_ctrl_error_007: \033[31mToggle failed for \033[35m{device.name}\033[31m: {str(e)}\033[0m"
            )
            return False

    def set_brightness(self, device_id: str, brightness: int) -> bool:
        """Установить яркость устройства"""
        if not 1 <= brightness <= 100:
            logger.error(
                f"light_ctrl_error_008: \033[31mInvalid brightness: \033[33m{brightness}\033[31m (must be 1-100)\033[0m"
            )
            return False

        device = self.get_device(device_id)
        if not device or not device.connect():
            return False

        try:
            device.bulb.set_brightness(brightness)
            device.update_properties()
            logger.info(
                f"light_ctrl_010: Brightness set to \033[33m{brightness}%\033[0m for \033[35m{device.name}\033[0m"
            )
            return True

        except BulbException as e:
            logger.error(
                f"light_ctrl_error_009: \033[31mBrightness set failed for \033[35m{device.name}\033[31m: {str(e)}\033[0m"
            )
            return False

    def set_color_temp(self, device_id: str, temp: int) -> bool:
        """Установить цветовую температуру"""
        if not 1700 <= temp <= 6500:
            logger.error(
                f"light_ctrl_error_010: \033[31mInvalid color temp: \033[33m{temp}K\033[31m (must be 1700-6500K)\033[0m"
            )
            return False

        device = self.get_device(device_id)
        if not device or not device.connect():
            return False

        try:
            device.bulb.set_color_temp(temp)
            device.update_properties()
            logger.info(
                f"light_ctrl_011: Color temp set to \033[33m{temp}K\033[0m for \033[35m{device.name}\033[0m"
            )
            return True

        except BulbException as e:
            logger.error(
                f"light_ctrl_error_011: \033[31mColor temp set failed for \033[35m{device.name}\033[31m: {str(e)}\033[0m"
            )
            return False

    def set_rgb(self, device_id: str, red: int, green: int, blue: int) -> bool:
        """Установить RGB цвет"""
        if not all(0 <= c <= 255 for c in [red, green, blue]):
            logger.error(
                f"light_ctrl_error_012: \033[31mInvalid RGB values: \033[33m({red},{green},{blue})\033[31m (must be 0-255)\033[0m"
            )
            return False

        device = self.get_device(device_id)
        if not device or not device.connect():
            return False

        try:
            device.bulb.set_rgb(red, green, blue)
            device.update_properties()
            logger.info(
                f"light_ctrl_012: RGB color set to \033[33m({red},{green},{blue})\033[0m for \033[35m{device.name}\033[0m"
            )
            return True

        except BulbException as e:
            logger.error(
                f"light_ctrl_error_013: \033[31mRGB set failed for \033[35m{device.name}\033[31m: {str(e)}\033[0m"
            )
            return False


# Глобальный экземпляр контроллера
light_controller = LightController()

# Автоматическое сканирование отключено по умолчанию
# Для включения вызовите light_controller.start_auto_scan() вручную
