# Wake-word сервис «Hey Archie» — план

> Статус: черновик плана (реализация ещё не начата).
> Стек детекции: **OpenWakeWord** (решено). Остальные компоненты — в разделе «Открытые решения».

## Ключевой вывод

**OpenWakeWord делает только детекцию wake word** — не STT и не TTS. Поэтому это
не «одна библиотека», а отдельный headless-сервис, где OWW — только «спусковой
крючок», а вокруг него: запись команды, STT, вызов агента, TTS-воспроизведение.
Дальше цикл повторяет логику существующего voice-режима, но без UI.

---

## 0. Существующий код (`archie-voice/`)

В репо уже есть папка `archie-voice/` (трекается в этом же git-репо archie-web):

- `main.py` — детектор wake word на **Picovoice Porcupine** + `hey-archie_..._v3_0_0.ppn`.
  **Picovoice-аккаунт забанен → выкидываем Porcupine и `.ppn`, заменяем на OpenWakeWord.**
- `voice.py` — рабочий каркас голосового цикла, **переиспользуем**:
  - брать как есть: выбор/тест микрофона (`sounddevice`), запись WAV, воспроизведение
    (`mpg123`/`simpleaudio`), структура loop record→STT→agent→TTS→play;
  - заменить STT: облачный OpenAI `whisper-1` → **офлайн faster-whisper**;
  - заменить TTS: OpenAI `tts-1`/alloy → **OpenRouter `gemini-3.1-flash-tts-preview`**
    (тот же `/audio/speech`, меняется base_url + model + ключ);
  - вызов агента сейчас **заглушка** (`# TODO Runner/agent`) → провести на реальный
    HTTP `/chat` + `/save-message` (как voice-режим);
  - `from .state import get_state` — модуля нет и это не пакет → оформить пакет,
    убрать/заменить импорт.

Итог по коду: (1) OWW вместо Porcupine, (2) STT офлайн + TTS OpenRouter,
(3) реальный вызов агента, (4) привести в рабочий вид пакет/зависимости/`.env`.

## 1. Что делает OpenWakeWord (и что нет)

- **Делает:** непрерывно принимает аудио (16-бит, 16 кГц PCM, кадры кратно 80 мс =
  1280 сэмплов). Для каждого кадра `model.predict(frame)` возвращает score 0–1 по
  каждому wake word; срабатывание при score > ~0.5. Есть опции Speex noise
  suppression и Silero VAD для снижения ложных срабатываний.
- **API:**
  ```python
  import openwakeword
  from openwakeword.model import Model
  openwakeword.utils.download_models()
  model = Model(wakeword_models=["hey_archie.onnx"])  # или .tflite
  prediction = model.predict(frame)  # dict {model_name: score}
  ```
  Пример потоковой детекции с микрофона (PyAudio) есть в репозитории
  (`examples/detect_from_microphone.py`).
- **НЕ делает:** не распознаёт речь (STT) и не синтезирует речь (TTS).
- «Hey Archie» — **кастомное** слово; в предобученных нет (есть alexa / hey jarvis /
  hey mycroft), значит нужно обучать свою модель.
- Инференс: tflite (быстрее на ARM) или onnx (кроссплатформенно, `onnxruntime`
  на aarch64 доступен через pip).

## 2. Архитектура (headless-сервис на Pi)

Логично запускать на Raspberry Pi — там и микрофон, и колонка (BT-спикер).

```
[Pi mic] → аудио-поток 16кГц
   │
   ├─(1) OpenWakeWord: слушает "Hey Archie" ──► детект
   │
   ├─(2) VAD-запись команды (webrtcvad / silero) до конца фразы
   │
   ├─(3) STT (ru-RU): аудио → текст
   │
   ├─(4) POST на агента: {user_name, input, response_format:"ssml", conversation_id}
   │        через Django-прокси /ai-assistant/api/chat/ + /save-message/
   │        (как в voice-режиме → «одна сессия = один сохранённый чат»)
   │
   ├─(5) SSML → чистка тегов / SSML-TTS → аудио
   │
   └─(6) воспроизведение на колонке Pi → снова слушать команду
            (follow-up'ы; 10 c тишины завершают сессию) → назад к ожиданию wake word
```

## 3. Цикл-состояние (зеркало voice-режима, без UI)

```
IDLE (ждём wake) → WAKE detected → LISTEN command (VAD) → THINK (агент)
   → SPEAK (TTS) → LISTEN follow-up … → таймаут 10 c → IDLE
```

## 4. Обучение кастомной модели «Hey Archie» (самый весомый кусок)

- Обучение только на Linux (зависит от Piper).
- Пайплайн: `piper-sample-generator` синтезирует тысячи вариантов «Hey Archie»
  разными голосами → аугментация (шумы/реверберация) → `openwakeword/train.py`
  с шагами `--generate_clips` / `--augment_clips` / `--train_model` по YAML-конфигу
  → на выходе `hey_archie.tflite` / `.onnx`.
- Тяжело для Pi: обучать на машине с GPU (Colab / ПК), на Pi класть только готовый
  файл модели (небольшой).
- Дальше — подбор порога и прогон против ложных срабатываний.
- Референсы: `notebooks/automatic_model_training.ipynb`, `examples/custom_model.yml`
  в репозитории dscripka/openwakeword.

## 5. Железо

- **Raspberry Pi 5, 16 ГБ RAM** — тянет качественный офлайн-STT. Ограничение —
  CPU (Cortex-A76, без GPU), а не память.

## 6. STT — офлайн, русский (РЕШЕНО)

- **faster-whisper** (CTranslate2), модель **`large-v3-turbo`** в int8 — лучший
  баланс на Pi 5: почти точность large-v3, но заметно быстрее; multilingual,
  русский из коробки. Альтернатива при нехватке скорости — `medium` / `small`.
- Альтернатива движка: **whisper.cpp** (ggml, NEON-оптимизация под ARM) — очень
  хорошо идёт на Pi 5, квантованные модели.
- Полностью офлайн, интернет не нужен.

## 7. TTS — через OpenRouter (РЕШЕНО: облако)

OpenRouter **поддерживает TTS** (эндпоинт совместим с OpenAI Audio API):

- **URL:** `POST https://openrouter.ai/api/v1/audio/speech`
- **Auth:** `Authorization: Bearer $OPENROUTER_API_KEY` (ключ уже используется агентом)
- **Тело:** `{ model, input, voice, response_format: "mp3"|"pcm", speed? }`
- **Топовая модель:** `google/gemini-3.1-flash-tts-preview` — 30 голосов, 70+ языков
  (**русский есть**), **inline audio tags** (`[whispers]`, `[laughs]`, `[excited]` —
  200+) для управления эмоцией/темпом/подачей прямо в тексте. Цена токенами:
  ~$1/M input text, $20/M audio output.
- **Альтернатива:** `openai/gpt-4o-mini-tts-*` (голоса alloy/nova/…, стилевые
  инструкции), Voxtral Mini TTS (клонирование голоса), Kokoro 82M.

Пример:
```python
from openai import OpenAI
client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=OPENROUTER_API_KEY)
with client.audio.speech.with_streaming_response.create(
    model="google/gemini-3.1-flash-tts-preview",
    input="Привет! Это тест синтеза речи.",
    voice="<voice_id>",
    response_format="mp3",
) as resp:
    resp.stream_to_file("out.mp3")
```

### ⚠️ Важно: SSML ↔ OpenRouter TTS

OpenRouter TTS принимает **обычный текст (+ inline audio tags конкретного
провайдера)**, а НЕ SSML. Агент сейчас отдаёт SSML. Поэтому:

- **Путь A (просто, рекомендую для старта):** снимаем SSML-теги → чистый текст →
  Gemini TTS. Нейросетевой голос сам даёт естественную интонацию — уже огромный
  скачок против браузерного TTS.
- **Путь B (богаче эмоции, позже):** добавить агенту `response_format`, который
  вместо SSML эмитит inline-теги Gemini (`[excited]` и т.п.) или стилевую
  инструкцию — тогда эмоции/паузы отрабатывают «нативно».

Вывод mp3/pcm играем на колонке Pi (см. раздел про аудио).

## 8. Открытые решения (осталось определить)

| Решение | Варианты | Заметки |
|---|---|---|
| **Где код** | ~~отдельный репо~~ / **подпапка `archie-voice/`** (уже есть, трекается в archie-web) | Де-факто решено: код уже живёт подпапкой. Держать его Python-env отдельно (свой venv/requirements) и **исключить из Docker-сборки вебаппа** (`.dockerignore`) |
| **Рантайм на Pi** | systemd-сервис на хосте / Docker-контейнер | Рекомендация — systemd (проще доступ к аудио; Docker требует проброс `/dev/snd` + PipeWire-сокет) |
| **Микрофон** | mic BT-колонки Leitz / отдельный USB-микрофон | У Leitz mic только в профиле `headset-head-unit` и узкополосный → плохо для STT/wake. Вероятно нужен **USB-микрофон** |
| **Пользователь** | один `user_name` / различать говорящих | По умолчанию — один фиксированный user_name |

## 9. Интеграция с агентом и персистентность

- Переиспользуем существующие эндпоинты Django (как voice-режим):
  - `/ai-assistant/api/chat/` — pass-through на агента (`AI_AGENT_URL/chat`);
  - `/ai-assistant/api/save-message/` — сохранение user/assistant сообщений.
- Оба сейчас `@csrf_exempt` и **без** `login_required` → headless-сервис может
  вызывать напрямую. Стоит подумать о простом токене для защиты.
- «Одна сессия = один сохранённый чат»: один `conversation_id` на сессию
  (от wake до таймаута), все реплики пишутся в него.

## 10. Риски / открытые вопросы

- Качество кастомной «Hey Archie» (ложные срабатывания / пропуски) — итеративная
  настройка порога, VAD, шумоподавления.
- Аудио на Pi: одновременный захват mic + вывод TTS через PipeWire/`wpctl`,
  конфликт BT-профилей (a2dp-sink без mic vs headset-head-unit с узкополосным mic).
- Задержка на Pi (CPU aarch64): OWW лёгкий, но whisper может тормозить.
- Прокси-эндпоинты без аутентификации.

## 11. Этапы (предлагаемый порядок)

1. Скелет сервиса + захват mic + OWW на **предобученном** «hey jarvis» — проверить
   сквозной цикл до агента и TTS (без кастомной модели).
2. STT + агент + TTS-воспроизведение — полный loop как voice-режим.
3. Обучить и подключить кастомную «Hey Archie».
4. Тюнинг порога/VAD/шумоподавления, автозапуск (systemd), деплой на Pi.

## 12. Ссылки

- OpenWakeWord: https://github.com/dscripka/openwakeword
- piper-sample-generator: https://github.com/rhasspy/piper-sample-generator
- Автообучение: `notebooks/automatic_model_training.ipynb` (в репо OWW)
- Пример детекции с микрофона: `examples/detect_from_microphone.py` (в репо OWW)
- OpenRouter TTS (docs): https://openrouter.ai/docs/guides/overview/multimodal/tts
- OpenRouter TTS-модели: https://openrouter.ai/collections/text-to-speech-models
- Gemini 3.1 Flash TTS: https://openrouter.ai/google/gemini-3.1-flash-tts-preview
- faster-whisper: https://github.com/SYSTRAN/faster-whisper
- whisper.cpp: https://github.com/ggerganov/whisper.cpp
