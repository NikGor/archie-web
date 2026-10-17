"""
Pydantic models for AI Assistant API schemas and validation
This module now imports from the shared models package for consistency across the Archie ecosystem.
"""

# Import all models from the shared package
# Note: In a real setup, you would install the shared package separately:
# pip install archie-ai-models

import os
# For demo purposes, importing from local archie-shared
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "archie-shared"))

try:
    from archie_shared import (  # Chat models; UI models; LLM models
        ButtonOption, Card, ChatMessage, ChatRequest, ChecklistOption,
        ContactCard, ConversationModel, DropdownOption, InputTokensDetails,
        LllmTrace, Metadata, NavigationCard, OutputTokensDetails, ToolCard,
        UIElements)
except ImportError:
    # Fallback to local definitions if shared package is not available
    print("Warning: Shared models package not found, using local definitions")

    from datetime import datetime
    from datetime import timezone as dt_timezone
    from typing import List, Literal, Optional

    from pydantic import BaseModel, Field

    # Include all the original model definitions as fallback...
    # This ensures the project works even without the shared package

    class ButtonOption(BaseModel):
        text: str
        command: Optional[str] = None

    class DropdownOption(BaseModel):
        label: str
        value: str
        command: Optional[str] = None

    class ChecklistOption(BaseModel):
        label: str
        value: str
        checked: bool = False
        command: Optional[str] = None

    class UIElements(BaseModel):
        dropdown: Optional[List[DropdownOption]] = None
        buttons: Optional[List[ButtonOption]] = None
        checklist: Optional[List[ChecklistOption]] = None

    class Card(BaseModel):
        title: Optional[str] = None
        subtitle: Optional[str] = None
        text: Optional[str] = None
        options: Optional[UIElements] = None

    class NavigationCard(BaseModel):
        title: str
        description: Optional[str] = None
        url: Optional[str] = None
        buttons: Optional[List[ButtonOption]] = None

    class ContactCard(BaseModel):
        name: str
        email: Optional[str] = None
        phone: Optional[str] = None
        buttons: Optional[List[ButtonOption]] = None

    class ToolCard(BaseModel):
        name: str
        description: Optional[str] = None

    class Metadata(BaseModel):
        cards: Optional[List[Card]] = None
        options: Optional[UIElements] = None
        tool_cards: Optional[List[ToolCard]] = None
        navigation_card: Optional[NavigationCard] = None
        contact_card: Optional[ContactCard] = None
        table: Optional[dict] = None
        elements: Optional[dict] = None

    class InputTokensDetails(BaseModel):
        cached_tokens: int = 0

    class OutputTokensDetails(BaseModel):
        reasoning_tokens: int = 0

    class LllmTrace(BaseModel):
        model: str
        input_tokens: int
        input_tokens_details: InputTokensDetails = InputTokensDetails()
        output_tokens: int
        output_tokens_details: OutputTokensDetails = OutputTokensDetails()
        total_tokens: int
        total_cost: float = 0.0

    class ChatMessage(BaseModel):
        message_id: Optional[str] = None
        role: Literal["user", "assistant", "system"]
        text_format: Literal["plain", "markdown", "html", "voice"] = "plain"
        text: str
        metadata: Optional[Metadata] = None
        created_at: datetime = datetime.now(dt_timezone.utc)
        conversation_id: Optional[str] = None
        previous_message_id: Optional[str] = None
        model: Optional[str] = None
        llm_trace: Optional[LllmTrace] = None

    class ConversationModel(BaseModel):
        conversation_id: str
        title: str = "New Conversation"
        messages: Optional[List[ChatMessage]] = None
        created_at: datetime = datetime.now(dt_timezone.utc)
        llm_trace: Optional[LllmTrace] = Field(default_factory=lambda: None)

        def __init__(self, **data):
            super().__init__(**data)
            # Import here to avoid circular import
            from .utils import calculate_conversation_llm_trace

            self.llm_trace = calculate_conversation_llm_trace(self.messages)

    class ChatRequest(BaseModel):
        role: Literal["user", "assistant", "system"]
        text: str
        text_format: Literal["plain", "markdown", "html", "voice"] = "plain"
        conversation_id: Optional[str] = None
        previous_message_id: Optional[str] = None
        model: Optional[str] = None


# Export all models for backward compatibility
__all__ = [
    "ChatMessage",
    "ConversationModel",
    "ChatRequest",
    "ButtonOption",
    "DropdownOption",
    "ChecklistOption",
    "UIElements",
    "Card",
    "NavigationCard",
    "ContactCard",
    "ToolCard",
    "Metadata",
    "InputTokensDetails",
    "OutputTokensDetails",
    "LllmTrace",
]
