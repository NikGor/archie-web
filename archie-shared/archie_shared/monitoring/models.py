"""Chat monitoring protocol: an LLM judge grades assistant turns (ARCHIE-213).

Django keeps conversations and evaluations; the AI agent fetches turns that have
no evaluation yet, judges them and sends one MonitorTurnEvaluation per turn back.
"""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from archie_shared.chat.models import ResponseFormat
from archie_shared.swarm.models import SwarmMessage

MonitorGrade = Literal["red", "orange", "green"]
MonitorCriterion = Literal[
    "helpfulness", "correctness", "tool_choice", "skill_usage", "format_fit"
]
# Main reason of a red / orange criterion, picked from a fixed list by the judge
MonitorReason = Literal[
    # helpfulness
    "helpless_refusal",
    "needless_question",
    "off_topic",
    "partial_answer",
    "ignored_context",
    "wrong_language",
    # correctness
    "factual_error",
    "invented_data",
    "realtime_without_search",
    "leaked_error",
    "contradiction",
    "wrong_action",
    # tool_choice
    "missing_tool",
    "wrong_tool",
    "bad_arguments",
    "extra_tool",
    "tool_error_ignored",
    # skill_usage
    "skill_not_loaded",
    "wrong_skill",
    "skill_not_followed",
    # format_fit
    "broken_ui",
    "empty_response",
    "wrong_element",
    "missing_quick_actions",
    "too_long",
    "wrong_format",
]
# Why an outcome check failed: the request goal or the user's next message
MonitorOutcomeReason = Literal[
    "helpless_refusal",
    "needless_question",
    "off_topic",
    "partial_answer",
    "ignored_context",
    "rephrased_request",
    "user_correction",
]
MonitorRunStatus = Literal["running", "completed", "failed"]
MonitorTrigger = Literal["ui", "schedule", "claude", "cli"]
# Agent kind whose records a run judges (ARCHIE-297)
MonitorAgentKind = Literal["chat", "swarm"]

MONITOR_MAX_CONVERSATIONS = 200


class MonitorMessage(BaseModel):
    """One stored chat message"""

    message_id: str = Field(description="Message ID")
    role: Literal["user", "assistant"] = Field(description="Message author")
    content_json: str = Field(
        description="Stored Content as JSON; may be an older Content schema"
    )
    response_format: Optional[ResponseFormat] = Field(
        default=None, description="Requested response format, if stored (assistant only)"
    )
    created_at: str = Field(description="ISO 8601 timestamp")


class MonitorConversation(BaseModel):
    """A conversation with at least one assistant turn that has no evaluation"""

    conversation_id: str = Field(description="Conversation ID")
    title: str = Field(description="Conversation title")
    messages: List[MonitorMessage] = Field(description="All messages, oldest first")
    pending_message_ids: List[str] = Field(
        description="Assistant message IDs to judge"
    )


class MonitorPendingBatch(BaseModel):
    """Conversations to judge, oldest first"""

    conversations: List[MonitorConversation] = Field(
        description="Conversations with pending turns"
    )


class MonitorToolCall(BaseModel):
    """One tool call of the turn, taken from the Langfuse trace"""

    name: str = Field(description="Tool name, e.g. google_search_tool")
    arguments: str = Field(description="Tool arguments as JSON")
    success: Optional[bool] = Field(
        default=None, description="Tool result success flag, if known"
    )


class MonitorCriterionScore(BaseModel):
    """Grade for one criterion"""

    criterion: MonitorCriterion = Field(description="Judged criterion")
    grade: Optional[MonitorGrade] = Field(
        default=None, description="Grade; None if the criterion does not apply"
    )
    reason: Optional[MonitorReason] = Field(
        default=None, description="Main reason of a red / orange grade"
    )
    score: Optional[float] = Field(
        default=None, description="Judge score 0 (red) .. 1 (green), if the judge gives one"
    )
    comment: str = Field(default="", description="Free-text comment, if the judge writes one")


class MonitorRuleScore(BaseModel):
    """Grade for one prompt spec rule the turn had to follow"""

    spec: str = Field(
        description="Prompt spec name, e.g. format_ui_answer; 'outcome' for checks of the result"
    )
    rule_id: str = Field(description="Rule id from the spec's rule catalog")
    text: str = Field(description="Rule text as the model reads it")
    grade: Optional[MonitorGrade] = Field(
        default=None, description="green followed, orange partly, red broken; None if not applicable"
    )
    probability: Optional[float] = Field(
        default=None, description="Judge probability of the chosen answer"
    )
    reason: Optional[MonitorOutcomeReason] = Field(
        default=None, description="Why an outcome check is red / orange (outcome spec only)"
    )


class MonitorTurnEvaluation(BaseModel):
    """Judge result for one assistant turn"""

    run_id: str = Field(description="Monitor run ID")
    conversation_id: str = Field(description="Conversation ID")
    message_id: str = Field(description="Judged assistant message ID")
    grade: MonitorGrade = Field(description="Overall grade of the turn")
    summary: str = Field(default="", description="Free-text summary, if the judge writes one")
    criteria: List[MonitorCriterionScore] = Field(
        default_factory=list, description="Grade per generic criterion (older evaluations)"
    )
    rules: List[MonitorRuleScore] = Field(
        default_factory=list, description="Grade per prompt spec rule"
    )
    spec_versions: Dict[str, str] = Field(
        default_factory=dict, description="Spec name -> fingerprint of the judged spec version"
    )
    trace_found: bool = Field(
        description="True if the Langfuse trace with tool calls was found"
    )
    trace_id: Optional[str] = Field(default=None, description="Langfuse trace ID")
    tool_calls: List[MonitorToolCall] = Field(
        default_factory=list, description="Tool calls of the turn (skill loads included)"
    )
    skills_loaded: List[str] = Field(
        default_factory=list, description="Skill names loaded with skill_loader_tool"
    )
    judge_model: str = Field(description="Judge model ID")
    judge_cost: Optional[float] = Field(default=None, description="Judge call cost in USD")
    evaluated_at: str = Field(description="ISO 8601 UTC timestamp")


class MonitorRunRequest(BaseModel):
    """Request to judge pending turns"""

    conversation_ids: List[str] = Field(
        default_factory=list,
        description="Judge only these conversations; empty = oldest pending ones",
    )
    max_conversations: int = Field(
        default=20,
        ge=1,
        le=MONITOR_MAX_CONVERSATIONS,
        description="Maximum number of conversations in one run",
    )
    judge_model: Optional[str] = Field(
        default=None, description="Judge model; None = agent default"
    )
    triggered_by: MonitorTrigger = Field(default="ui", description="Who started the run")
    agent_kind: MonitorAgentKind = Field(
        default="chat",
        description="chat: assistant turns of conversations; swarm: swarm agent messages",
    )


class MonitorRunInfo(BaseModel):
    """State and totals of one monitor run"""

    run_id: str = Field(description="Monitor run ID")
    status: MonitorRunStatus = Field(description="Run state")
    request: MonitorRunRequest = Field(description="Request the run was started with")
    judge_model: str = Field(description="Judge model ID")
    conversations: int = Field(default=0, description="Conversations in the run")
    total_turns: int = Field(default=0, description="Turns to judge")
    done_turns: int = Field(default=0, description="Judged turns")
    red: int = Field(default=0, description="Turns graded red")
    orange: int = Field(default=0, description="Turns graded orange")
    green: int = Field(default=0, description="Turns graded green")
    errors: int = Field(default=0, description="Turns the judge failed on")
    total_cost: float = Field(default=0.0, description="Judge cost in USD")
    error: Optional[str] = Field(default=None, description="Run-level error if failed")
    created_at: str = Field(description="ISO 8601 UTC timestamp")
    finished_at: Optional[str] = Field(default=None, description="ISO 8601 UTC timestamp")


class SwarmMonitorRecord(BaseModel):
    """A swarm agent message to judge, with what it answers (ARCHIE-297)"""

    message: SwarmMessage = Field(description="The judged swarm agent message")
    trigger: Optional[SwarmMessage] = Field(
        default=None, description="The message it reacts to (reply_to), if any"
    )
    history: List[SwarmMessage] = Field(
        default_factory=list, description="Swarm chat messages before it, oldest first"
    )


class SwarmMonitorPendingBatch(BaseModel):
    """Swarm agent messages without an evaluation, oldest first"""

    records: List[SwarmMonitorRecord] = Field(description="Records to judge")


class SwarmTurnEvaluation(BaseModel):
    """Judge verdict on one swarm agent message (ARCHIE-297)"""

    run_id: str = Field(description="Monitor run ID")
    message_id: str = Field(description="Judged swarm message ID")
    agent_id: str = Field(description="Agent that wrote the message")
    grade: MonitorGrade = Field(description="Overall grade: the worst graded rule")
    rules: List[MonitorRuleScore] = Field(
        default_factory=list, description="Per-rule scores by the swarm prompt specs"
    )
    spec_versions: Dict[str, str] = Field(
        default_factory=dict, description="Spec -> fingerprint of the judged spec version"
    )
    judge_model: str = Field(description="Judge model ID")
    judge_cost: Optional[float] = Field(default=None, description="Judge call cost in USD")
    evaluated_at: str = Field(description="ISO 8601 UTC timestamp")
