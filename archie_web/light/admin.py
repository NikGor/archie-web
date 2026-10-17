from django.contrib import admin

from .models import LightDevice, LightGroup, LightSchedule, LightState


@admin.register(LightDevice)
class LightDeviceAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "device_type",
        "ip_address",
        "room",
        "is_active",
        "created_at",
    )
    list_filter = ("device_type", "is_active", "room", "created_at")
    search_fields = ("name", "ip_address", "room")
    list_editable = ("is_active",)
    readonly_fields = ("created_at", "updated_at")

    fieldsets = (
        ("Основная информация", {"fields": ("name", "device_type", "room")}),
        ("Сетевые настройки", {"fields": ("ip_address", "port")}),
        ("Состояние", {"fields": ("is_active",)}),
        (
            "Служебная информация",
            {"fields": ("created_at", "updated_at"), "classes": ("collapse",)},
        ),
    )


@admin.register(LightState)
class LightStateAdmin(admin.ModelAdmin):
    list_display = (
        "device",
        "is_on",
        "brightness",
        "color_temp",
        "rgb_color",
        "last_updated",
    )
    list_filter = ("is_on", "last_updated")
    search_fields = ("device__name",)
    readonly_fields = ("last_updated",)

    def has_add_permission(self, request):
        return False


class LightDeviceInline(admin.TabularInline):
    model = LightGroup.devices.through
    extra = 1


@admin.register(LightGroup)
class LightGroupAdmin(admin.ModelAdmin):
    list_display = ("name", "room", "device_count", "created_at")
    list_filter = ("room", "created_at")
    search_fields = ("name", "room")
    inlines = [LightDeviceInline]

    def device_count(self, obj):
        return obj.devices.count()

    device_count.short_description = "Количество устройств"


@admin.register(LightSchedule)
class LightScheduleAdmin(admin.ModelAdmin):
    list_display = ("name", "get_target", "time", "action", "is_active", "created_at")
    list_filter = ("action", "is_active", "created_at")
    search_fields = ("name", "device__name", "group__name")
    list_editable = ("is_active",)

    fieldsets = (
        ("Основная информация", {"fields": ("name", "time", "action")}),
        (
            "Цель",
            {
                "fields": ("device", "group"),
                "description": "Выберите либо устройство, либо группу",
            },
        ),
        ("Расписание", {"fields": ("days_of_week",)}),
        (
            "Дополнительные параметры",
            {"fields": ("brightness",), "classes": ("collapse",)},
        ),
        ("Состояние", {"fields": ("is_active",)}),
    )

    def get_target(self, obj):
        if obj.device:
            return f"Устройство: {obj.device.name}"
        elif obj.group:
            return f"Группа: {obj.group.name}"
        return "Не задано"

    get_target.short_description = "Цель"

    def clean(self):
        from django.core.exceptions import ValidationError

        if not self.device and not self.group:
            raise ValidationError("Необходимо выбрать устройство или группу")
        if self.device and self.group:
            raise ValidationError("Нельзя выбрать одновременно устройство и группу")
