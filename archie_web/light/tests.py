import json

from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.urls import reverse

from .models import LightDevice, LightGroup, LightSchedule, LightState


class LightDeviceModelTest(TestCase):
    def setUp(self):
        self.device = LightDevice.objects.create(
            name="Тестовая лампа",
            device_type="yeelight",
            ip_address="192.168.1.100",
            port=55443,
            room="Гостиная",
        )

    def test_device_creation(self):
        self.assertEqual(self.device.name, "Тестовая лампа")
        self.assertEqual(self.device.device_type, "yeelight")
        self.assertEqual(self.device.ip_address, "192.168.1.100")
        self.assertTrue(self.device.is_active)

    def test_device_str(self):
        expected = f"{self.device.name} ({self.device.ip_address})"
        self.assertEqual(str(self.device), expected)


class LightStateModelTest(TestCase):
    def setUp(self):
        self.device = LightDevice.objects.create(
            name="Тестовая лампа", device_type="yeelight", ip_address="192.168.1.100"
        )
        self.state = LightState.objects.create(
            device=self.device, is_on=True, brightness=80, color_temp=4000
        )

    def test_state_creation(self):
        self.assertTrue(self.state.is_on)
        self.assertEqual(self.state.brightness, 80)
        self.assertEqual(self.state.color_temp, 4000)

    def test_state_str(self):
        expected = f"{self.device.name} - Вкл"
        self.assertEqual(str(self.state), expected)


class LightGroupModelTest(TestCase):
    def setUp(self):
        self.device1 = LightDevice.objects.create(
            name="Лампа 1", device_type="yeelight", ip_address="192.168.1.100"
        )
        self.device2 = LightDevice.objects.create(
            name="Лампа 2", device_type="yeelight", ip_address="192.168.1.101"
        )
        self.group = LightGroup.objects.create(name="Группа гостиной", room="Гостиная")
        self.group.devices.add(self.device1, self.device2)

    def test_group_creation(self):
        self.assertEqual(self.group.name, "Группа гостиной")
        self.assertEqual(self.group.devices.count(), 2)

    def test_group_str(self):
        self.assertEqual(str(self.group), "Группа гостиной")


class LightViewsTest(TestCase):
    def setUp(self):
        self.client = Client()
        self.device = LightDevice.objects.create(
            name="Тестовая лампа", device_type="yeelight", ip_address="192.168.1.100"
        )
        self.state = LightState.objects.create(
            device=self.device, is_on=False, brightness=50
        )

    def test_dashboard_view(self):
        response = self.client.get(reverse("light:dashboard"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Панель управления освещением")
        self.assertContains(response, self.device.name)

    def test_device_list_view(self):
        response = self.client.get(reverse("light:device_list"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Устройства освещения")
        self.assertContains(response, self.device.name)

    def test_device_detail_view(self):
        response = self.client.get(
            reverse("light:device_detail", args=[self.device.id])
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.device.name)
        self.assertContains(response, "Управление освещением")

    def test_group_list_view(self):
        response = self.client.get(reverse("light:group_list"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Группы освещения")

    def test_schedule_list_view(self):
        response = self.client.get(reverse("light:schedule_list"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Расписания освещения")


class LightAPITest(TestCase):
    def setUp(self):
        self.client = Client()
        self.device = LightDevice.objects.create(
            name="Тестовая лампа", device_type="yeelight", ip_address="192.168.1.100"
        )
        self.state = LightState.objects.create(
            device=self.device, is_on=False, brightness=50
        )

    def test_device_status_api(self):
        response = self.client.get(
            reverse("light:api_device_status", args=[self.device.id])
        )
        self.assertEqual(response.status_code, 200)

        data = json.loads(response.content)
        self.assertTrue(data["success"])
        self.assertEqual(data["device_id"], self.device.id)
        self.assertEqual(data["name"], self.device.name)

    def test_all_devices_status_api(self):
        response = self.client.get(reverse("light:api_all_devices_status"))
        self.assertEqual(response.status_code, 200)

        data = json.loads(response.content)
        self.assertTrue(data["success"])
        self.assertEqual(len(data["devices"]), 1)
        self.assertEqual(data["devices"][0]["name"], self.device.name)

    def test_set_brightness_api(self):
        response = self.client.post(
            reverse("light:api_set_brightness", args=[self.device.id]),
            data=json.dumps({"brightness": 75}),
            content_type="application/json",
        )
        # Поскольку у нас нет реального устройства, ожидаем ошибку соединения
        # но проверяем, что API обрабатывает запрос
        self.assertIn(response.status_code, [200, 400])

    def test_set_color_temp_api(self):
        response = self.client.post(
            reverse("light:api_set_color_temp", args=[self.device.id]),
            data=json.dumps({"temperature": 3000}),
            content_type="application/json",
        )
        # Аналогично тесту яркости
        self.assertIn(response.status_code, [200, 400])

    def test_set_rgb_color_api(self):
        response = self.client.post(
            reverse("light:api_set_rgb_color", args=[self.device.id]),
            data=json.dumps({"red": 255, "green": 0, "blue": 0}),
            content_type="application/json",
        )
        # Аналогично другим тестам
        self.assertIn(response.status_code, [200, 400])

    def test_invalid_brightness_api(self):
        # Тест с неверным значением яркости
        response = self.client.post(
            reverse("light:api_set_brightness", args=[self.device.id]),
            data=json.dumps({"brightness": 150}),  # Неверное значение
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

        data = json.loads(response.content)
        self.assertFalse(data["success"])

    def test_invalid_rgb_api(self):
        # Тест с неверными RGB значениями
        response = self.client.post(
            reverse("light:api_set_rgb_color", args=[self.device.id]),
            data=json.dumps({"red": 300, "green": 0, "blue": 0}),  # Неверное значение
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

        data = json.loads(response.content)
        self.assertFalse(data["success"])


class LightControllerTest(TestCase):
    def setUp(self):
        self.device = LightDevice.objects.create(
            name="Тестовая лампа", device_type="yeelight", ip_address="192.168.1.100"
        )

    def test_light_controller_import(self):
        # Проверяем, что контроллер можно импортировать
        from .light_controller import LightController, light_controller

        self.assertIsInstance(light_controller, LightController)
        self.assertIsNotNone(light_controller.connected_bulbs)
