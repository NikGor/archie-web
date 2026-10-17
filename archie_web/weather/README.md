# Weather App - Приложение для отображения погоды

Это Django приложение для отображения актуальной информации о погоде в городе Бад-Мергентхайм, Германия.

## Возможности

- Отображение актуальных данных о погоде
- Кэширование данных для оптимизации запросов к API
- Красивый пользовательский интерфейс с Bootstrap
- JSON API для интеграции с другими приложениями
- Автоматическое обновление данных каждые 10 минут

## Настройка

### 1. Получение API ключа OpenWeatherMap

1. Зарегистрируйтесь на https://openweathermap.org/api
2. Получите бесплатный API ключ
3. Добавьте ключ в файл `.env`:

```env
OPENWEATHER_API_KEY=ваш-api-ключ-здесь
```

### 2. Применение миграций

```bash
poetry run python manage.py migrate weather
```

### 3. Запуск приложения

```bash
make run
```

## Использование

### Веб-интерфейс

Откройте в браузере: http://127.0.0.1:8000/weather/

### JSON API

Получить данные в JSON формате: http://127.0.0.1:8000/weather/api/

## Файлы приложения

- `models.py` - Модель для кэширования данных о погоде
- `services.py` - Сервис для работы с OpenWeatherMap API
- `views.py` - Представления для отображения данных
- `templates/weather/weather.html` - HTML шаблон с красивым дизайном
- `admin.py` - Настройки админ панели
- `urls.py` - URL маршруты
- `tests.py` - Юнит тесты

## Особенности реализации

1. **Кэширование**: Данные кэшируются на 10 минут для снижения нагрузки на API
2. **Graceful degradation**: Приложение работает даже без API ключа (показывает сообщение об ошибке)
3. **Responsive design**: Интерфейс адаптивен для мобильных устройств
4. **Логирование**: Все ошибки API записываются в лог
5. **Типизация**: Используются type hints для лучшей читаемости кода

## Архитектура

```
weather/
├── __init__.py
├── admin.py           # Админ интерфейс
├── apps.py            # Конфигурация приложения
├── models.py          # Модели данных
├── services.py        # Бизнес логика
├── views.py           # Контроллеры
├── urls.py            # URL маршруты
├── tests.py           # Тесты
├── migrations/        # Миграции БД
└── templates/
    └── weather/
        └── weather.html  # Шаблон страницы
```

## API Endpoints

- `GET /weather/` - Веб-страница с погодой
- `GET /weather/api/` - JSON данные о погоде

## Модель данных

```python
class WeatherData(models.Model):
    city = models.CharField(max_length=100)
    country = models.CharField(max_length=100) 
    temperature = models.FloatField()
    description = models.CharField(max_length=200)
    humidity = models.IntegerField()
    pressure = models.FloatField()
    wind_speed = models.FloatField()
    icon = models.CharField(max_length=10)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
```

## Зависимости

- Django 5.2+
- requests (для API вызовов)
- python-dotenv (для переменных окружения)

## Тестирование

```bash
poetry run python manage.py test weather
```
