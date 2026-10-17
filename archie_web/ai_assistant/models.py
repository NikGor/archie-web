from typing import Optional

from archie_shared.chat.models import ChatMessage
from archie_shared.chat.models import Conversation as ConversationModel
from archie_shared.chat.models import (InputTokensDetails, LllmTrace,
                                       OutputTokensDetails, PipelineStep,
                                       PipelineTrace)
from archie_shared.ui.models import Content
from django.db import models
from django.utils import timezone


class Conversation(models.Model):
    """Django model for storing conversations in PostgreSQL"""

    conversation_id = models.CharField(max_length=255, primary_key=True, db_index=True)
    title = models.TextField(default="New Conversation")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    # LLM Trace fields - expanded set
    total_input_tokens = models.IntegerField(default=0)
    total_input_cached_tokens = models.IntegerField(default=0)
    total_output_tokens = models.IntegerField(default=0)
    total_output_reasoning_tokens = models.IntegerField(default=0)
    total_tokens = models.IntegerField(default=0)
    total_cost = models.FloatField(default=0.0)

    class Meta:
        db_table = "ai_assistant_conversation"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"]),
            models.Index(fields=["conversation_id"]),
        ]

    def __str__(self):
        return f"{self.title} ({self.conversation_id})"

    def to_conversation_model(self):
        """Convert Django model to Pydantic model"""

        messages = [msg.to_chat_message() for msg in self.messages.all()]

        return ConversationModel(
            conversation_id=str(self.conversation_id),
            title=self.title,
            messages=messages,
            created_at=self.created_at,
            updated_at=self.updated_at,
            total_input_tokens=self.total_input_tokens,
            total_output_tokens=self.total_output_tokens,
            total_tokens=self.total_tokens,
            total_cost=float(self.total_cost),
            llm_trace=(
                LllmTrace(
                    model="aggregate",
                    input_tokens=self.total_input_tokens,
                    input_tokens_details=InputTokensDetails(
                        cached_tokens=self.total_input_cached_tokens
                    ),
                    output_tokens=self.total_output_tokens,
                    output_tokens_details=OutputTokensDetails(
                        reasoning_tokens=self.total_output_reasoning_tokens
                    ),
                    total_tokens=self.total_tokens,
                    total_cost=float(self.total_cost),
                )
                if self.total_tokens > 0
                else None
            ),
        )

    def get_chat_history_yaml(self) -> str:
        """
        Get chat history in YAML format.
        Extracts text content only, skipping buttons and images.
        Format: User: ... / Assistant: ...
        """
        lines = []
        for msg in self.messages.all().order_by("created_at"):
            role_label = "User" if msg.role == "user" else "Assistant"
            text_content = self.extract_text_from_content(msg.content)
            if text_content:
                lines.append(f"{role_label}: {text_content}")
        return "\n".join(lines)

    def extract_text_from_content(self, content: dict) -> Optional[str]:
        """Extract text from Content, skipping buttons and images."""
        if isinstance(content, str):
            import json

            content = json.loads(content)
        content_format = content.get("content_format", "plain")
        if content_format == "plain" or content_format == "markdown":
            return content.get("text", "")
        if content_format == "level2_answer":
            level2 = content.get("level2_answer", {})
            text_answer = level2.get("text", {})
            return text_answer.get("text", "")
        if content_format == "level3_answer":
            level3 = content.get("level3_answer", {})
            text_answer = level3.get("text", {})
            return text_answer.get("text", "")
        if content_format == "ui_answer":
            return self._extract_text_from_ui_answer(content.get("ui_answer", {}))
        return content.get("text", "")

    def _extract_text_from_ui_answer(self, ui_answer: dict) -> str:
        """Extract text from UIAnswer, skipping buttons and images."""
        texts = []
        intro = ui_answer.get("intro_text", {})
        if intro and intro.get("text"):
            texts.append(intro["text"])
        for item in ui_answer.get("items", []):
            item_type = item.get("type")
            item_content = item.get("content", {})
            if item_type == "text_answer":
                if item_content.get("text"):
                    texts.append(item_content["text"])
            elif item_type == "card_grid":
                texts.append(self._extract_text_from_card_grid(item_content))
            elif item_type == "table":
                texts.append(self._extract_text_from_table(item_content))
        return "\n".join(filter(None, texts))

    def _extract_text_from_card_grid(self, card_grid: dict) -> str:
        """Extract text from CardGrid, skipping buttons and image_prompt."""
        texts = []
        for card in card_grid.get("cards", []):
            card_texts = []
            if card.get("title"):
                card_texts.append(card["title"])
            if card.get("subtitle"):
                card_texts.append(card["subtitle"])
            if card.get("text"):
                card_texts.append(card["text"])
            if card.get("description"):
                card_texts.append(card["description"])
            if card_texts:
                texts.append(" - ".join(card_texts))
        return "\n".join(texts)

    def _extract_text_from_table(self, table: dict) -> str:
        """Extract text from Table."""
        lines = []
        if table.get("title"):
            lines.append(table["title"])
        headers = table.get("headers", [])
        if headers:
            lines.append(" | ".join(headers))
        for row in table.get("rows", []):
            lines.append(" | ".join(row))
        return "\n".join(lines)


class Message(models.Model):
    """Django model for storing chat messages in PostgreSQL"""

    message_id = models.CharField(max_length=255, primary_key=True, db_index=True)
    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name="messages",
        db_index=True,
        to_field="conversation_id",
    )
    role = models.CharField(max_length=20)
    content = models.JSONField(default=dict)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    previous_message_id = models.CharField(max_length=255, null=True, blank=True)
    model = models.TextField(null=True, blank=True)
    # Requested format of an assistant message: Content does not keep it, and chat
    # monitoring judges the message by that format's prompt spec (ARCHIE-213)
    response_format = models.CharField(max_length=32, null=True, blank=True)

    # LLM Trace fields - expanded set
    llm_model = models.TextField(null=True, blank=True)
    llm_trace = models.JSONField(null=True, blank=True)
    input_tokens = models.IntegerField(null=True, blank=True)
    input_cached_tokens = models.IntegerField(default=0)
    output_tokens = models.IntegerField(null=True, blank=True)
    output_reasoning_tokens = models.IntegerField(default=0)
    total_tokens = models.IntegerField(null=True, blank=True)
    total_cost = models.FloatField(null=True, blank=True)
    pipeline_steps = models.JSONField(default=list)
    pipeline_trace = models.JSONField(null=True, blank=True)

    class Meta:
        db_table = "ai_assistant_message"
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["conversation", "created_at"]),
            models.Index(fields=["message_id"]),
            models.Index(fields=["role"]),
            models.Index(fields=["-created_at"]),
        ]

    def __str__(self):
        content_str = str(self.content) if self.content else ""
        return (
            f"{self.role}: {content_str[:50]}..."
            if len(content_str) > 50
            else f"{self.role}: {content_str}"
        )

    def to_chat_message(self):
        """Convert Django model to Pydantic model"""
        import json

        llm_trace = None
        if self.input_tokens is not None and self.output_tokens is not None:
            llm_trace = LllmTrace(
                model=self.llm_model or "",
                input_tokens=self.input_tokens,
                input_tokens_details=InputTokensDetails(
                    cached_tokens=self.input_cached_tokens
                ),
                output_tokens=self.output_tokens,
                output_tokens_details=OutputTokensDetails(
                    reasoning_tokens=self.output_reasoning_tokens
                ),
                total_tokens=self.total_tokens
                or (self.input_tokens + self.output_tokens),
                total_cost=float(self.total_cost) if self.total_cost else 0.0,
            )

        content_dict = (
            json.loads(self.content) if isinstance(self.content, str) else self.content
        )
        content_obj = Content(**content_dict)

        return ChatMessage(
            message_id=str(self.message_id),
            role=self.role,
            content=content_obj,
            created_at=self.created_at,
            conversation_id=str(self.conversation.conversation_id),
            previous_message_id=(
                str(self.previous_message_id) if self.previous_message_id else None
            ),
            model=self.model,
            llm_trace=llm_trace,
            pipeline_steps=[PipelineStep(**s) for s in (self.pipeline_steps or [])],
            pipeline_trace=(
                PipelineTrace(**self.pipeline_trace) if self.pipeline_trace else None
            ),
        )


class MessageAudio(models.Model):
    """Voice recording attached to a message.

    Stored in the DB (not on disk) because the web container has no media volume
    and its filesystem is ephemeral. One recording per message: the user's spoken
    input, or the assistant's TTS answer. Written when a turn goes through a voice
    channel (Voice Chat, archie-voice) or the assistant generated speech.
    """

    message = models.OneToOneField(
        Message,
        on_delete=models.CASCADE,
        related_name="audio",
        primary_key=True,
        to_field="message_id",
    )
    audio = models.BinaryField()
    content_type = models.CharField(max_length=50, default="audio/webm")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_assistant_message_audio"

    def __str__(self):
        return f"audio for {self.message_id} ({len(self.audio or b'')} bytes)"


class MessageImage(models.Model):
    """Image attached by the user to a message.

    Stored in the DB for the same reason as MessageAudio (no media volume,
    ephemeral container filesystem). `position` keeps the attachment order.
    """

    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name="images",
        to_field="message_id",
    )
    position = models.PositiveSmallIntegerField(default=0)
    image = models.BinaryField()
    content_type = models.CharField(max_length=50, default="image/jpeg")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_assistant_message_image"
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(
                fields=["message", "position"], name="unique_message_image_position"
            )
        ]

    def __str__(self):
        return f"image {self.position} for {self.message_id} ({len(self.image or b'')} bytes)"


class MessageFile(models.Model):
    """Document (PDF, text, DOCX, ...) attached by the user to a message.

    Stored in the DB for the same reason as MessageAudio/MessageImage. `size` is
    kept separately so listings never have to load the binary column.
    """

    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name="files",
        to_field="message_id",
    )
    position = models.PositiveSmallIntegerField(default=0)
    name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100, default="application/octet-stream")
    size = models.PositiveIntegerField(default=0)
    data = models.BinaryField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "ai_assistant_message_file"
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(
                fields=["message", "position"], name="unique_message_file_position"
            )
        ]

    def __str__(self):
        return f"file {self.name} for {self.message_id} ({self.size} bytes)"
