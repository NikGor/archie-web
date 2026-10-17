import logging

logger = logging.getLogger(__name__)


class DeviceError(Exception):
    """Base exception for device errors."""

    def __init__(self, message, ip=None):
        super().__init__(message)
        self.ip = ip
        logger.error(f"DeviceError: {message} (IP: {ip})")


class DeviceConnectionError(DeviceError):
    """Exception raised for errors in device connection."""


class DeviceOperationError(DeviceError):
    """Exception raised for errors during device operations."""
