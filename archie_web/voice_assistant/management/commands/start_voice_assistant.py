import logging

from django.core.management.base import BaseCommand
from dotenv import load_dotenv

from archie_web.voice_assistant.services import VoiceAssistantService

load_dotenv()

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Start voice assistant continuous listening for wake words"

    def add_arguments(self, parser):
        parser.add_argument(
            "--device-id",
            type=int,
            default=None,
            help="Audio input device ID (optional)",
        )

    def handle(self, *args, **options):
        self.stdout.write(
            self.style.SUCCESS("Starting voice assistant continuous listening...")
        )

        try:
            service = VoiceAssistantService()

            self.stdout.write(
                self.style.WARNING('Voice assistant is now listening for "Hey Archie"')
            )
            self.stdout.write(self.style.WARNING("Press Ctrl+C to stop"))

            # Start continuous listening
            service.run_continuous_listening()

        except KeyboardInterrupt:
            self.stdout.write(self.style.SUCCESS("\nVoice assistant stopped."))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Error: {e}"))
            logger.error(f"voice_assistant_command_error: {e}")
