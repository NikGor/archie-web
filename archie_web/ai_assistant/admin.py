import json
import os

import requests
from django.contrib import admin, messages
from django.db import models
from django.utils import timezone
from django.utils.html import format_html

from .models import Conversation, Message

AI_AGENT_URL = os.getenv("AI_AGENT_URL", "http://archie-ai-agent:8005")


class MessageInline(admin.TabularInline):
    model = Message
    extra = 0
    can_delete = False
    readonly_fields = (
        "message_link",
        "role",
        "content_preview",
        "model",
        "created_at",
        "total_tokens",
        "total_cost",
    )
    fields = (
        "message_link",
        "role",
        "content_preview",
        "model",
        "created_at",
        "total_tokens",
        "total_cost",
    )
    ordering = ("created_at",)

    def message_link(self, obj):
        if obj.message_id:
            url = f"/admin/ai_assistant/message/{obj.message_id}/change/"
            return format_html(
                '<a href="{}" target="_blank">{}</a>', url, obj.message_id
            )
        return "-"

    message_link.short_description = "Message ID"

    def content_preview(self, obj):
        if obj.content:
            content_str = (
                json.dumps(obj.content, ensure_ascii=False)
                if isinstance(obj.content, dict)
                else str(obj.content)
            )
            preview = content_str[:100]
            if len(content_str) > 100:
                preview += "..."
            return format_html(
                '<span style="font-family: monospace;">{}</span>', preview
            )
        return "-"

    content_preview.short_description = "Content Preview"

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = (
        "conversation_id",
        "title",
        "messages_count",
        "created_at",
        "updated_at",
        "total_tokens",
        "total_cost",
    )
    list_filter = ("created_at", "updated_at")
    search_fields = ("conversation_id", "title")
    readonly_fields = (
        "conversation_id",
        "created_at",
        "updated_at",
        "total_input_tokens",
        "total_input_cached_tokens",
        "total_output_tokens",
        "total_output_reasoning_tokens",
        "total_tokens",
        "total_cost",
        "messages_count",
        "chat_history_yaml",
    )
    ordering = ("-created_at",)
    inlines = [MessageInline]
    actions = ["regenerate_titles"]

    fieldsets = (
        (
            "Basic Information",
            {
                "fields": (
                    "conversation_id",
                    "title",
                    "messages_count",
                    "created_at",
                    "updated_at",
                )
            },
        ),
        (
            "Chat History (YAML)",
            {"fields": ("chat_history_yaml",), "classes": ("collapse",)},
        ),
        (
            "LLM Trace",
            {
                "fields": (
                    "total_input_tokens",
                    "total_input_cached_tokens",
                    "total_output_tokens",
                    "total_output_reasoning_tokens",
                    "total_tokens",
                    "total_cost",
                )
            },
        ),
    )

    def messages_count(self, obj):
        return obj.messages.count()

    messages_count.short_description = "Messages"

    def chat_history_yaml(self, obj):
        yaml_content = obj.get_chat_history_yaml()
        if yaml_content:
            return format_html(
                '<pre style="white-space: pre-wrap; word-wrap: break-word; '
                "background: #1e1e1e; color: #d4d4d4; padding: 10px; border-radius: 4px; "
                'max-height: 400px; overflow-y: auto; font-family: monospace;">{}</pre>',
                yaml_content,
            )
        return "-"

    chat_history_yaml.short_description = "Chat History"

    @admin.action(description="Regenerate titles using AI")
    def regenerate_titles(self, request, queryset):
        success_count = 0
        error_count = 0
        for conversation in queryset:
            chat_history = conversation.get_chat_history_yaml()
            if not chat_history:
                error_count += 1
                continue
            history_preview = (
                chat_history[:1000] if len(chat_history) > 1000 else chat_history
            )
            ai_request = {
                "user_name": "system",
                "response_format": "plain",
                "input": f"Generate a short title (3-5 words, no quotes, no emoji) for this conversation:\n\n{history_preview}",
            }
            try:
                response = requests.post(
                    f"{AI_AGENT_URL}/chat", json=ai_request, timeout=30
                )
                if response.status_code == 200:
                    ai_data = response.json()
                    title = ai_data.get("content", {}).get("text", "").strip()
                    title = title.strip("\"'")
                    if len(title) > 50:
                        title = title[:47] + "..."
                    conversation.title = title
                    conversation.save()
                    success_count += 1
                else:
                    error_count += 1
            except Exception:
                error_count += 1
        if success_count:
            self.message_user(
                request, f"Regenerated {success_count} title(s)", messages.SUCCESS
            )
        if error_count:
            self.message_user(
                request, f"Failed to regenerate {error_count} title(s)", messages.ERROR
            )


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = (
        "message_id",
        "conversation_link",
        "role",
        "content_short",
        "created_at",
        "total_tokens",
        "total_cost",
    )
    list_filter = ("role", "created_at", "llm_model")
    search_fields = (
        "message_id",
        "conversation__conversation_id",
        "conversation__title",
    )
    readonly_fields = (
        "message_id",
        "created_at",
        "input_tokens",
        "input_cached_tokens",
        "output_tokens",
        "output_reasoning_tokens",
        "total_tokens",
        "total_cost",
        "content_formatted",
    )
    ordering = ("-created_at",)
    raw_id_fields = ("conversation",)

    fieldsets = (
        (
            "Basic Information",
            {
                "fields": (
                    "message_id",
                    "conversation",
                    "role",
                    "created_at",
                    "previous_message_id",
                    "model",
                )
            },
        ),
        ("Content", {"fields": ("content_formatted",)}),
        (
            "LLM Trace",
            {
                "fields": (
                    "llm_model",
                    "llm_trace",
                    "input_tokens",
                    "input_cached_tokens",
                    "output_tokens",
                    "output_reasoning_tokens",
                    "total_tokens",
                    "total_cost",
                )
            },
        ),
    )

    def conversation_link(self, obj):
        if obj.conversation:
            url = f"/admin/ai_assistant/conversation/{obj.conversation.conversation_id}/change/"
            return format_html(
                '<a href="{}">{}</a>',
                url,
                obj.conversation.title or obj.conversation.conversation_id,
            )
        return "-"

    conversation_link.short_description = "Conversation"

    def content_short(self, obj):
        if obj.content:
            content_str = (
                json.dumps(obj.content, ensure_ascii=False)
                if isinstance(obj.content, dict)
                else str(obj.content)
            )
            preview = content_str[:50]
            if len(content_str) > 50:
                preview += "..."
            return preview
        return "-"

    content_short.short_description = "Content"

    def content_formatted(self, obj):
        if obj.content:
            content_str = (
                json.dumps(obj.content, indent=2, ensure_ascii=False)
                if isinstance(obj.content, dict)
                else str(obj.content)
            )
            return format_html(
                '<pre style="white-space: pre-wrap; word-wrap: break-word;">{}</pre>',
                content_str,
            )
        return "-"

    content_formatted.short_description = "Content"
