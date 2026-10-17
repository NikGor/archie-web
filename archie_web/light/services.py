import logging
from abc import ABC, abstractmethod

from yeelight import Bulb

logger = logging.getLogger(__name__)


class DeviceInterface(ABC):
    @abstractmethod
    def get_properties(self):
        pass

    @abstractmethod
    def toggle(self):
        pass

    @abstractmethod
    def set_brightness(self, brightness: int):
        pass

    @abstractmethod
    def set_color_temp(self, temperature: int):
        pass

    @abstractmethod
    def set_rgb(self, red: int, green: int, blue: int):
        pass


class YeelightDevice(DeviceInterface):
    def __init__(self, ip: str):
        self.ip = ip
        self.bulb = Bulb(ip)

    def get_properties(self):
        try:
            return self.bulb.get_properties()
        except Exception as e:
            logger.error(
                f"light_services_001: \033[31mError getting properties from \033[36m{self.ip}\033[31m: {str(e)}\033[0m"
            )
            return {"success": False, "error": str(e)}

    def toggle(self):
        properties = self.get_properties()

        # Check if get_properties returned an error
        if isinstance(properties, dict) and not properties.get("success", True):
            logger.error(
                f"light_services_002: \033[31mError toggling device \033[36m{self.ip}\033[31m: {properties.get('error')}\033[0m"
            )
            return {"success": False, "error": properties.get("error")}

        try:
            current_state = properties.get("power") == "on"
            if current_state:
                self.bulb.turn_off()
            else:
                self.bulb.turn_on()
            return not current_state
        except Exception as e:
            logger.error(
                f"light_services_003: \033[31mError toggling device \033[36m{self.ip}\033[31m: {str(e)}\033[0m"
            )
            return {"success": False, "error": str(e)}

    def set_brightness(self, brightness: int):
        try:
            self.bulb.set_brightness(brightness)
        except Exception as e:
            logger.error(
                f"light_services_004: \033[31mError setting brightness \033[33m{brightness}%\033[31m for \033[36m{self.ip}\033[31m: {str(e)}\033[0m"
            )
            raise

    def set_color_temp(self, temperature: int):
        try:
            self.bulb.set_color_temp(temperature)
        except Exception as e:
            logger.error(
                f"light_services_005: \033[31mError setting color temp \033[33m{temperature}K\033[31m for \033[36m{self.ip}\033[31m: {str(e)}\033[0m"
            )
            raise

    def set_rgb(self, red: int, green: int, blue: int):
        try:
            self.bulb.set_rgb(red, green, blue)
        except Exception as e:
            logger.error(
                f"light_services_006: \033[31mError setting RGB \033[33m({red},{green},{blue})\033[31m for \033[36m{self.ip}\033[31m: {str(e)}\033[0m"
            )
            raise
