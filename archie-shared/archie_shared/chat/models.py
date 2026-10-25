from datetime import datetime
from datetime import timezone as dt_timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from ..ui.models import Content


class InputTokensDetails(BaseModel):
    """Details about input token usage"""

    cached_tokens: int = Field(default=0, description="Number of cached tokens used")


class OutputTokensDetails(BaseModel):
    """Details about output token usage"""

    reasoning_tokens: int = Field(
        default=0, description="Number of reasoning tokens generated"
    )


class PipelineStep(BaseModel):
    """Single pipeline step timing record"""

    step: str = Field(description="Name of the pipeline step")
    status: str = Field(description="Status of the step")
    duration_ms: int = Field(description="Duration of the step in milliseconds")


class LllmTrace(BaseModel):
    """Complete LLM usage trace for cost tracking and analytics"""

    model: str = Field(description="Name of the LLM model used")
    input_tokens: int = Field(description="Number of input tokens processed")
    input_tokens_details: InputTokensDetails = Field(
        default_factory=InputTokensDetails,
        description="Details about input token usage",
    )
    output_tokens: int = Field(description="Number of output tokens generated")
    output_tokens_details: OutputTokensDetails = Field(
        default_factory=OutputTokensDetails,
        description="Details about output token usage",
    )
    total_tokens: int = Field(description="Total number of tokens used")
    total_cost: float = Field(default=0.0, description="Total cost of the API call")


class StepTrace(BaseModel):
    """Timing and LLM usage data for a single pipeline stage"""

    duration_ms: int = Field(description="Duration of the stage in milliseconds")
    ttft_ms: Optional[int] = Field(
        default=None,
        description="Time to first token in milliseconds (streaming mode only)",
    )
    llm_trace: Optional[LllmTrace] = Field(
        default=None,
        description="LLM usage trace for this stage, if it involved an LLM call",
    )


class PipelineTrace(BaseModel):
    """Aggregated trace for all stages of a single agent request"""

    command_call: Optional[StepTrace] = Field(
        default=None, description="Command call stage trace"
    )
    tool_execution: Optional[StepTrace] = Field(
        default=None, description="Tool execution stage trace"
    )
    response_format: Optional[StepTrace] = Field(
        default=None, description="Auto response format selection stage"
    )
    create_output: Optional[StepTrace] = Field(
        default=None, description="Output generation stage trace"
    )
    ttft_ms: Optional[int] = Field(
        default=None,
        description="Time to first token from pipeline start (stage1 + stage2 + create_output ttft), milliseconds",
    )
    total_ms: int = Field(
        description="Total duration of the arun() call in milliseconds"
    )


ResponseFormat = Literal[
    "auto",
    "plain",
    "markdown",
    "html",
    "ssml",
    "gemini_tts",
    "json",
    "csv",
    "xml",
    "yaml",
    "prompt",
    "python",
    "bash",
    "sql",
    "regex",
    "dockerfile",
    "makefile",
    "level2_answer",
    "level3_answer",
    "ui_answer",
    "dashboard",
    "widget",
]

# ARCHIE-289: OpenRouter reasoning effort levels; "none" turns reasoning off
ReasoningEffort = Literal["none", "minimal", "low", "medium", "high", "xhigh", "max"]


class ChatMessage(BaseModel):
    """Individual chat message in a conversation"""

    message_id: Optional[str] = Field(
        default=None, description="Unique identifier for the message"
    )
    role: Literal["user", "assistant", "system"] = Field(
        description="Role of the message sender"
    )
    response_format: Optional[ResponseFormat] = Field(
        default=None,
        description="Format the assistant message was requested in; Content does not keep it",
    )
    content: Content = Field(description="Structured content of the message")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(dt_timezone.utc),
        description="Timestamp when the message was created",
    )
    conversation_id: Optional[str] = Field(
        default=None, description="ID of the conversation this message belongs to"
    )
    previous_message_id: Optional[str] = Field(
        default=None, description="ID of the previous message for threading"
    )
    model: Optional[str] = Field(
        default=None, description="LLM model used to generate this message"
    )
    llm_trace: Optional[LllmTrace] = Field(
        default=None, description="LLM usage trace for this message"
    )
    pipeline_steps: list[PipelineStep] = Field(
        default_factory=list,
        description="Pipeline step timings for this message",
    )
    pipeline_trace: Optional[PipelineTrace] = Field(
        default=None,
        description="Detailed per-stage pipeline trace from the AI agent",
    )


class Conversation(BaseModel):
    """Complete conversation with messages and metadata"""

    conversation_id: str = Field(description="Unique identifier for the conversation")
    title: str = Field(
        default="New Conversation", description="Title of the conversation"
    )
    messages: Optional[List[ChatMessage]] = Field(
        default=None, description="List of messages in the conversation"
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(dt_timezone.utc),
        description="Timestamp when the conversation was created",
    )
    llm_trace: Optional[LllmTrace] = Field(
        default=None, description="Aggregated LLM usage trace for the conversation"
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(dt_timezone.utc),
        description="Timestamp when the conversation was last updated",
    )
    total_input_tokens: int = Field(
        default=0, description="Total input tokens used in this conversation"
    )
    total_output_tokens: int = Field(
        default=0, description="Total output tokens generated in this conversation"
    )
    total_tokens: int = Field(
        default=0, description="Total tokens used in this conversation"
    )
    total_cost: float = Field(
        default=0.0, description="Total cost of this conversation"
    )

    def __init__(self, **data):
        super().__init__(**data)
        if self.messages:
            # Calculate aggregated LLM trace using utils
            from .utils import calculate_conversation_llm_trace

            self.llm_trace = calculate_conversation_llm_trace(self.messages)


class ImageAttachment(BaseModel):
    """Image attached by the user to a chat request"""

    media_type: Literal["image/jpeg", "image/png", "image/webp", "image/gif"] = Field(
        description="MIME type of the image"
    )
    data: str = Field(description="Base64-encoded image bytes (no data: URL prefix)")


class FileAttachment(BaseModel):
    """Document (PDF, text, DOCX, ...) attached by the user to a chat request"""

    name: str = Field(description="Original file name, including extension")
    media_type: str = Field(description="MIME type of the file")
    data: str = Field(description="Base64-encoded file bytes (no data: URL prefix)")


class ChatRequest(BaseModel):
    """Request to send a chat message"""

    user_name: Optional[str] = Field(description="Name of the user sending the request")
    response_format: ResponseFormat = Field(default="plain", description="Format of response expected from the agent")
    input: str = Field(description="Text content of the request")
    conversation_id: Optional[str] = Field(
        default=None, description="ID of the conversation"
    )
    previous_message_id: Optional[str] = Field(
        default=None, description="ID of the previous message for threading"
    )
    chat_history: Optional[str] = Field(
        default=None, description="Previous chat messages for context"
    )
    demo_mode: Optional[bool] = Field(
        default=False, description="Flag to indicate if the request is in demo mode"
    )
    no_image: Optional[bool] = Field(
        default=False,
        description="Skip image generation in response. Use for faster, cheaper responses.",
    )
    command_model: Optional[str] = Field(
        default=None, description="LLM model to use for command processing"
    )
    final_output_model: Optional[str] = Field(
        default=None, description="LLM model to use for final output generation"
    )
    command_effort: Optional[ReasoningEffort] = Field(
        default=None,
        description="Reasoning effort of the command model; None keeps the provider default",
    )
    final_output_effort: Optional[ReasoningEffort] = Field(
        default=None,
        description="Reasoning effort of the final output model; None keeps the provider default",
    )
    images: Optional[List[ImageAttachment]] = Field(
        default=None,
        description="Images attached by the user; analyzed by the command model (must support vision)",
    )
    files: Optional[List[FileAttachment]] = Field(
        default=None,
        description="Documents attached by the user; their extracted text is added to the request input",
    )


class ConversationRequest(BaseModel):
    """Request model for creating a new conversation"""

    conversation_id: Optional[str] = Field(
        None,
        description="Optional custom conversation ID. If not provided, will be auto-generated",
    )
    title: Optional[str] = Field(
        "New Conversation", description="Title of the conversation"
    )


class ConversationResponse(BaseModel):
    """Response model for conversation creation"""

    conversation_id: str = Field(description="ID of the created conversation")
    title: str = Field(description="Title of the conversation")
    created_at: datetime = Field(
        description="Timestamp when the conversation was created"
    )
    message: str = Field(
        "Conversation created successfully", description="Success message"
    )


class MessageResponse(BaseModel):
    """Response model for message creation"""

    message_id: str = Field(description="ID of the created message")
    conversation_id: str = Field(description="ID of the conversation")
    created_at: datetime = Field(description="Timestamp when the message was created")
    message: str = Field("Message created successfully", description="Success message")


class ChatHistoryMessage(BaseModel):
    """Simplified message model for chat history"""

    role: Literal["user", "assistant", "system"] = Field(
        description="Role of the message sender"
    )
    content: Content = Field(description="Structured content of the message")


class ChatHistoryResponse(BaseModel):
    """Response model for chat history endpoint"""

    messages: List[ChatHistoryMessage] = Field(
        description="List of messages in the conversation"
    )


# Update forward references
ChatMessage.model_rebuild()
Conversation.model_rebuild()
