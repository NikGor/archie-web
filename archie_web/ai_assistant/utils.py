"""
Utils for AI Assistant - now delegates to shared models
"""

from typing import TYPE_CHECKING, List, Optional

if TYPE_CHECKING:
    from .pydantic_models import ChatMessage, LllmTrace


def calculate_conversation_llm_trace(
    messages: Optional[List["ChatMessage"]],
) -> Optional["LllmTrace"]:
    """Calculate aggregated LLM trace from all messages in conversation"""
    if not messages:
        return None

    traces = [msg.llm_trace for msg in messages if msg.llm_trace]
    if not traces:
        return None

    # Sum up all tokens and costs
    total_input = sum(trace.input_tokens for trace in traces)
    total_output = sum(trace.output_tokens for trace in traces)
    total_cached = sum(trace.input_tokens_details.cached_tokens for trace in traces)
    total_reasoning = sum(
        trace.output_tokens_details.reasoning_tokens for trace in traces
    )
    total_cost = sum(trace.total_cost for trace in traces)

    # Use the first model name (could be enhanced to handle multiple models)
    model = traces[0].model

    # Import here to avoid circular import
    from .pydantic_models import (InputTokensDetails, LllmTrace,
                                  OutputTokensDetails)

    return LllmTrace(
        model=model,
        input_tokens=total_input,
        input_tokens_details=InputTokensDetails(cached_tokens=total_cached),
        output_tokens=total_output,
        output_tokens_details=OutputTokensDetails(reasoning_tokens=total_reasoning),
        total_tokens=total_input + total_output,
        total_cost=total_cost,
    )
