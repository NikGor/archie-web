import logging
import os
import struct
import tempfile
import time
import wave
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# Conditional imports for voice dependencies (only available locally, not in Docker)
try:
    import numpy as np
    import pvporcupine
    import pyaudio
    import simpleaudio as sa
    import sounddevice as sd

    VOICE_DEPENDENCIES_AVAILABLE = True
except ImportError as e:
    logger.warning(
        f"voice_assistant_import_warning: Voice dependencies not available: {e}"
    )
    VOICE_DEPENDENCIES_AVAILABLE = False

logger = logging.getLogger(__name__)


class WakeWordService:
    """Service for wake word detection using Picovoice Porcupine"""

    def __init__(self, access_key: str, keyword_path: Optional[str] = None):
        """
        Initialize wake word detector.

        Args:
            access_key: Picovoice access key
            keyword_path: Path to custom keyword file (.ppn)
        """
        if not VOICE_DEPENDENCIES_AVAILABLE:
            raise ImportError(
                "Voice dependencies not available - run locally with 'make install-voice'"
            )

        self.access_key = access_key
        self.keyword_path = keyword_path
        self.is_listening = False

        # Audio configuration
        self.sample_rate = 16000
        self.frame_length = 512

        # Initialize Porcupine
        keywords = ["hey google"] if keyword_path is None else None
        keyword_paths = [keyword_path] if keyword_path else None

        try:
            self.porcupine = pvporcupine.create(
                access_key=access_key, keywords=keywords, keyword_paths=keyword_paths
            )

            # PyAudio setup
            self.pa = pyaudio.PyAudio()
            self.audio_stream = None

            logger.info("voice_assistant_001: Wake word detector initialized")

        except Exception as e:
            logger.error(
                f"voice_assistant_error_001: Failed to initialize wake word detector: {e}"
            )
            raise

    def start_listening(self, callback=None):
        """Start listening for wake word"""
        logger.info("voice_assistant_002: Starting wake word detection")

        try:
            self.audio_stream = self.pa.open(
                rate=self.porcupine.sample_rate,
                channels=1,
                format=pyaudio.paInt16,
                input=True,
                frames_per_buffer=self.porcupine.frame_length,
            )

            self.is_listening = True

            while self.is_listening:
                pcm = self.audio_stream.read(self.porcupine.frame_length)
                pcm = struct.unpack_from("h" * self.porcupine.frame_length, pcm)
                keyword_index = self.porcupine.process(pcm)

                if keyword_index >= 0:
                    logger.info(
                        f"voice_assistant_003: Wake word detected (index: {keyword_index})"
                    )
                    if callback:
                        callback(keyword_index)

        except Exception as e:
            logger.error(f"voice_assistant_error_002: Wake word detection failed: {e}")
        finally:
            self.stop_listening()

    def stop_listening(self):
        """Stop listening and cleanup resources"""
        logger.info("voice_assistant_004: Stopping wake word detection")

        self.is_listening = False

        if self.audio_stream:
            self.audio_stream.close()

        if self.pa:
            self.pa.terminate()

        if self.porcupine:
            self.porcupine.delete()


class VoiceProcessingService:
    """Service for voice recording, STT, TTS using OpenAI API"""

    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY not found in environment")

        self.api_base = "https://api.openai.com/v1"
        self.stt_model = "whisper-1"
        self.tts_model = "tts-1"
        self.voice = "alloy"
        self.audio_format = "mp3"

        # Recording settings
        self.sample_rate = 16000
        self.channels = 1
        self.record_seconds = 10  # Увеличено до 10 секунд

        logger.info("voice_assistant_005: Voice processing service initialized")

    def record_audio(
        self, duration: int = None, device_id: Optional[int] = None
    ) -> str:
        """Record audio and save as WAV file"""
        if not VOICE_DEPENDENCIES_AVAILABLE:
            raise ImportError(
                "Voice dependencies not available - run locally with 'make install-voice'"
            )

        duration = duration or self.record_seconds

        logger.info(f"voice_assistant_006: Recording audio for {duration} seconds")

        try:
            # Record audio
            audio = sd.rec(
                int(duration * self.sample_rate),
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype="int16",
                device=device_id,
            )
            sd.wait()

            # Save to temporary file
            temp_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            with wave.open(temp_file.name, "wb") as wf:
                wf.setnchannels(self.channels)
                wf.setsampwidth(2)
                wf.setframerate(self.sample_rate)
                wf.writeframes(audio.tobytes())

            logger.info(f"voice_assistant_007: Audio recorded to {temp_file.name}")
            return temp_file.name

        except Exception as e:
            logger.error(f"voice_assistant_error_003: Audio recording failed: {e}")
            raise

    def transcribe_audio(self, audio_file_path: str) -> str:
        """Transcribe audio using OpenAI Whisper"""
        logger.info("voice_assistant_008: Transcribing audio")

        url = f"{self.api_base}/audio/transcriptions"
        headers = {"Authorization": f"Bearer {self.api_key}"}

        try:
            with open(audio_file_path, "rb") as audio_file:
                files = {
                    "file": ("speech.wav", audio_file, "audio/wav"),
                }
                data = {
                    "model": self.stt_model,
                    "language": "ru",
                    "response_format": "json",
                }

                response = requests.post(
                    url, headers=headers, files=files, data=data, timeout=120
                )
                response.raise_for_status()

                result = response.json()
                transcribed_text = result.get("text", "").strip()

                logger.info(f"voice_assistant_009: Transcribed: '{transcribed_text}'")
                return transcribed_text

        except Exception as e:
            logger.error(f"voice_assistant_error_004: Transcription failed: {e}")
            return f"Ошибка распознавания: {e}"

    def synthesize_speech(self, text: str) -> str:
        """Synthesize speech using OpenAI TTS"""
        logger.info("voice_assistant_010: Synthesizing speech")

        url = f"{self.api_base}/audio/speech"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        data = {
            "model": self.tts_model,
            "voice": self.voice,
            "input": text,
            "response_format": self.audio_format,
        }

        try:
            response = requests.post(url, headers=headers, json=data, timeout=120)
            response.raise_for_status()

            temp_file = tempfile.NamedTemporaryFile(
                suffix=f".{self.audio_format}", delete=False
            )
            temp_file.write(response.content)
            temp_file.close()

            logger.info(f"voice_assistant_011: Speech synthesized to {temp_file.name}")
            return temp_file.name

        except Exception as e:
            logger.error(f"voice_assistant_error_005: Speech synthesis failed: {e}")
            raise

    def play_audio(self, audio_file_path: str):
        """Play audio file"""
        if not VOICE_DEPENDENCIES_AVAILABLE:
            raise ImportError(
                "Voice dependencies not available - run locally with 'make install-voice'"
            )

        logger.info("voice_assistant_012: Playing audio")

        try:
            if audio_file_path.endswith(".mp3"):
                # Use system command for MP3
                import subprocess

                subprocess.run(["mpg123", "-q", audio_file_path], check=True)
            else:
                # Use simpleaudio for WAV
                wave_obj = sa.WaveObject.from_wave_file(audio_file_path)
                play_obj = wave_obj.play()
                play_obj.wait_done()

        except Exception as e:
            logger.error(f"voice_assistant_error_006: Audio playback failed: {e}")
            raise


class VoiceAssistantService:
    """Main voice assistant service - listens for wake word, processes voice, talks back"""

    def __init__(self):
        self.voice_service = VoiceProcessingService()
        self.ai_agent_url = os.getenv("AI_AGENT_URL", "http://localhost:8005")

        # Initialize wake word service if key is available and dependencies are present
        access_key = os.getenv("PICOVOICE_ACCESS_KEY")
        keyword_path = os.getenv("WAKE_WORD_FILE", "hey-archie_en_linux_v3_0_0.ppn")

        self.wake_word_service = None
        if access_key and VOICE_DEPENDENCIES_AVAILABLE:
            try:
                self.wake_word_service = WakeWordService(access_key, keyword_path)
            except Exception as e:
                logger.error(
                    f"voice_assistant_error_009: Wake word service unavailable: {e}"
                )
        elif not VOICE_DEPENDENCIES_AVAILABLE:
            logger.info(
                "voice_assistant_info_001: Voice dependencies not available - voice assistant disabled in Docker"
            )

        logger.info("voice_assistant_013: Voice assistant service initialized")

    def send_to_chat(self, text: str, conversation_id: str = None) -> str:
        """Send message directly to AI Agent /chat endpoint"""
        logger.info("voice_assistant_014: Sending to AI Agent")

        chat_url = f"{self.ai_agent_url}/chat"

        # ChatRequest format with plain response
        chat_request = {
            "user_name": "Voice User",
            "response_format": "plain",
            "input": text,
            "conversation_id": conversation_id,
        }

        try:
            response = requests.post(chat_url, json=chat_request, timeout=60)
            response.raise_for_status()
            result = response.json()

            logger.info("voice_assistant_015: Received response from AI Agent")

            # ChatMessage -> content -> text
            content = result.get("content", {})
            return content.get("text", "Нет ответа")

        except Exception as e:
            logger.error(f"voice_assistant_error_007: Failed to send to AI Agent: {e}")
            return f"Ошибка связи с сервером: {e}"

    def run_continuous_listening(self):
        """Main loop: wake word -> record -> chat -> speak -> repeat"""
        logger.info("voice_assistant_016: Starting continuous listening")

        if not self.wake_word_service:
            logger.error("voice_assistant_error_008: Wake word service not available")
            return

        def wake_word_callback(keyword_index):
            logger.info(f"voice_assistant_017: Wake word detected, processing...")

            try:
                # Record user message
                audio_file = self.voice_service.record_audio()

                # Transcribe to text
                user_text = self.voice_service.transcribe_audio(audio_file)

                if not user_text or len(user_text.strip()) < 2:
                    logger.warning("voice_assistant_018: No valid speech detected")
                    return

                logger.info(f"voice_assistant_019: User said: '{user_text}'")

                # Send to chat (можно добавить conversation_id если нужно)
                ai_response = self.send_to_chat(user_text)

                # Convert response to speech and play
                audio_file = self.voice_service.synthesize_speech(ai_response)
                self.voice_service.play_audio(audio_file)

                logger.info("voice_assistant_020: Voice interaction completed")

            except Exception as e:
                logger.error(
                    f"voice_assistant_error_009: Voice interaction failed: {e}"
                )

        # Start listening for wake words with callback
        self.wake_word_service.start_listening(callback=wake_word_callback)
