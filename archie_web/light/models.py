from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class LightDevice(models.Model):
    DEVICE_TYPES = [
        ("yeelight", "Yeelight"),
        ("philips_hue", "Philips Hue"),
        ("generic", "Generic Smart Light"),
    ]

    name = models.CharField(max_length=100, verbose_name="Название")
    device_type = models.CharField(
        max_length=20,
        choices=DEVICE_TYPES,
        default="yeelight",
        verbose_name="Тип устройства",
    )
    ip_address = models.GenericIPAddressField(verbose_name="IP адрес")
    port = models.PositiveIntegerField(default=55443, verbose_name="Порт")
    is_active = models.BooleanField(default=True, verbose_name="Активен")
    room = models.CharField(max_length=50, blank=True, verbose_name="Комната")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Устройство освещения"
        verbose_name_plural = "Устройства освещения"

    def __str__(self):
        return f"{self.name} ({self.ip_address})"


class LightState(models.Model):
    device = models.OneToOneField(
        LightDevice, on_delete=models.CASCADE, related_name="state"
    )
    is_on = models.BooleanField(default=False, verbose_name="Включен")
    brightness = models.PositiveIntegerField(
        default=100,
        validators=[MinValueValidator(1), MaxValueValidator(100)],
        verbose_name="Яркость (%)",
    )
    color_temp = models.PositiveIntegerField(
        default=4000,
        validators=[MinValueValidator(1700), MaxValueValidator(6500)],
        verbose_name="Цветовая температура (K)",
    )
    rgb_color = models.CharField(
        max_length=7, default="#FFFFFF", verbose_name="RGB цвет"
    )
    last_updated = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Состояние освещения"
        verbose_name_plural = "Состояния освещения"

    def __str__(self):
        return f"{self.device.name} - {'Вкл' if self.is_on else 'Выкл'}"


class LightGroup(models.Model):
    name = models.CharField(max_length=100, verbose_name="Название группы")
    devices = models.ManyToManyField(
        LightDevice, related_name="groups", verbose_name="Устройства"
    )
    room = models.CharField(max_length=50, blank=True, verbose_name="Комната")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Группа освещения"
        verbose_name_plural = "Группы освещения"

    def __str__(self):
        return self.name

    def turn_on_all(self):
        """Включить все устройства в группе"""
        for device in self.devices.filter(is_active=True):
            state, created = LightState.objects.get_or_create(device=device)
            state.is_on = True
            state.save()

    def turn_off_all(self):
        """Выключить все устройства в группе"""
        for device in self.devices.filter(is_active=True):
            state, created = LightState.objects.get_or_create(device=device)
            state.is_on = False
            state.save()


class LightSchedule(models.Model):
    DAYS_OF_WEEK = [
        (0, "Понедельник"),
        (1, "Вторник"),
        (2, "Среда"),
        (3, "Четверг"),
        (4, "Пятница"),
        (5, "Суббота"),
        (6, "Воскресенье"),
    ]

    ACTION_CHOICES = [
        ("turn_on", "Включить"),
        ("turn_off", "Выключить"),
    ]

    name = models.CharField(max_length=100, verbose_name="Название расписания")
    device = models.ForeignKey(
        LightDevice,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="Устройство",
    )
    group = models.ForeignKey(
        LightGroup,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="Группа",
    )
    time = models.TimeField(verbose_name="Время")
    days_of_week = models.JSONField(default=list, verbose_name="Дни недели")
    action = models.CharField(
        max_length=10, choices=ACTION_CHOICES, verbose_name="Действие"
    )
    brightness = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(100)],
        verbose_name="Яркость (%)",
    )
    is_active = models.BooleanField(default=True, verbose_name="Активно")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Расписание освещения"
        verbose_name_plural = "Расписания освещения"

    def __str__(self):
        return f"{self.name} - {self.time}"
