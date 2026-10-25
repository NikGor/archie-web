"""Prompt eval protocol: case catalog, run requests, results and WS progress events.

The AI agent runs evals and streams events over /ws_evals/{run_id}; Django stores
runs and results for history and model comparison.
"""

from typing import Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field

from archie_shared.swarm.models import SwarmImportance, SwarmWatchTask

# stage1 / full: chat pipeline; swarm_turn / swarm_watch: one swarm agent turn or check (ARCHIE-297)
EvalStage = Literal[
    "stage1",
    "full",
    "swarm_turn",
    "swarm_watch",
    "ephemeral_run",
    "temporal_run",
    "cognitive_tick",
]
EvalAgentKind = Literal["chat", "swarm", "ephemeral", "temporal", "cognitive"]
EvalAttemptStatus = Literal["passed", "failed", "error"]
EvalRunStatus = Literal["queued", "running", "completed", "cancelled", "failed"]
EvalTrigger = Literal["ui", "claude", "cli"]

EVAL_MAX_REPEATS = 10


class EvalExpect(BaseModel):
    """Assertions one eval case checks; unset fields are not checked"""

    action_type: Optional[
        Literal["function_call", "parameters_request", "final_response"]
    ] = Field(default=None, description="Stage 1 action type (stage1 only)")
    tools_called: Optional[List[str]] = Field(
        default=None, description="Tools Stage 1 must call (stage1 only)"
    )
    content_not_empty: Optional[bool] = Field(
        default=None, description="Response content must not be empty (full only)"
    )
    max_total_tokens: Optional[int] = Field(
        default=None, description="Token budget for the whole pipeline (full only)"
    )
    max_latency_ms: Optional[int] = Field(
        default=None, description="Latency budget for the whole pipeline (full only)"
    )
    text_contains: Optional[str] = Field(
        default=None, description="Substring the response text must contain (full only)"
    )
    min_ui_items: Optional[int] = Field(
        default=None, description="Minimum number of ui_answer items (full only)"
    )
    has_quick_actions: Optional[bool] = Field(
        default=None, description="ui_answer must have quick action buttons (full only)"
    )
    has_form: Optional[bool] = Field(
        default=None,
        description="ui_answer must have an event_form, note_form or email_form (full only)",
    )
    expected_item_types: Optional[List[str]] = Field(
        default=None, description="ui_answer item types that must appear (full only)"
    )
    rules_followed: Optional[bool] = Field(
        default=None,
        description=(
            "The monitoring judge must not grade any of the case's rules red "
            "(full only; assistant_prompt and format_* rules; swarm cases: swarm specs)"
        ),
    )
    alert: Optional[bool] = Field(
        default=None,
        description="swarm_watch: the check must write an alert (true) or stay silent (false)",
    )
    importance: Optional[List[SwarmImportance]] = Field(
        default=None, description="swarm_watch: allowed importance of the alert"
    )
    reply_contains: Optional[str] = Field(
        default=None,
        description="Swarm cases: substring the reply or alert must contain",
    )
    reply_empty: Optional[bool] = Field(
        default=None,
        description="swarm_turn: the agent must stay silent (true) or reply (false)",
    )


class SwarmEvalInput(BaseModel):
    """Fixed context of a swarm eval case: the agent, its chat, memory and tool results"""

    agent_id: str = Field(description="Swarm agent that takes the turn, e.g. 'light'")
    watch_task: Optional[SwarmWatchTask] = Field(
        default=None, description="Check to run (swarm_watch only)"
    )
    history: List[str] = Field(
        default_factory=list,
        description="Swarm chat lines before the trigger, e.g. '@weather: Дождь после 17:00'",
    )
    memory: List[str] = Field(
        default_factory=list,
        description="Memory lines the agent sees (facts, today's notes)",
    )
    tool_results: Dict[str, str] = Field(
        default_factory=dict,
        description="Tool name -> JSON output the tool returns in the case (no real calls)",
    )
    now: Optional[str] = Field(
        default=None,
        description="Local date and time of the case, ISO 8601; None = now",
    )


class EvalCaseInfo(BaseModel):
    """One eval case from the agent's case catalog"""

    id: str = Field(description="Stable case ID, unique across all suites")
    name: str = Field(description="Short human-readable case name")
    description: str = Field(
        description="What the case checks and which prompt rule it protects"
    )
    suite: str = Field(description="Suite (YAML file) the case belongs to")
    prompts: List[str] = Field(
        description="Prompt templates the case tests, e.g. 'cmd_prompt', 'format_ui_answer'"
    )
    tags: List[str] = Field(
        default_factory=list, description="Free-form tags for selection"
    )
    rules: List[str] = Field(
        default_factory=list,
        description="Prompt spec rules the case protects, as 'spec:rule_id'",
    )
    input: str = Field(description="User message sent to the agent")
    response_format: str = Field(description="ChatRequest.response_format for the case")
    stage: EvalStage = Field(
        description="stage1 = Stage 1 only, full = whole pipeline, swarm_turn / swarm_watch = swarm"
    )
    agent_kind: EvalAgentKind = Field(
        default="chat", description="Agent kind the case runs on (ARCHIE-297)"
    )
    swarm: Optional[SwarmEvalInput] = Field(
        default=None, description="Swarm context (swarm cases only)"
    )
    judge: bool = Field(
        default=False, description="Score the response with the LLM judge"
    )
    expect: EvalExpect = Field(description="Assertions for the case")


class EvalAssertionFailure(BaseModel):
    """One failed assertion"""

    key: str = Field(description="EvalExpect field that failed")
    expected: str = Field(description="Expected value as JSON")
    actual: str = Field(description="Actual value as JSON")


class EvalJudgeScores(BaseModel):
    """LLM-as-judge scores for one response, 0-10 each"""

    ui_optimality: int = Field(description="Right UI component types were chosen")
    content_informativeness: int = Field(description="Content is useful and complete")
    prompt_following: int = Field(description="Response follows the format guidelines")
    reasoning: str = Field(description="Judge explanation of the scores")


class EvalCaseResult(BaseModel):
    """Result of one attempt of one case on one model"""

    run_id: str = Field(description="Eval run ID")
    case_id: str = Field(description="EvalCaseInfo.id")
    model: str = Field(description="Model used for Stage 1 and Stage 3")
    attempt: int = Field(description="Attempt number, 1..repeats")
    status: EvalAttemptStatus = Field(description="Attempt outcome")
    failures: List[EvalAssertionFailure] = Field(
        default_factory=list, description="Failed assertions"
    )
    error: Optional[str] = Field(
        default=None, description="Exception text if status is error"
    )
    stage1_ms: Optional[int] = Field(default=None, description="Stage 1 duration")
    stage2_ms: Optional[int] = Field(default=None, description="Stage 2 duration")
    stage3_ms: Optional[int] = Field(default=None, description="Stage 3 duration")
    total_ms: Optional[int] = Field(default=None, description="Whole attempt duration")
    total_tokens: Optional[int] = Field(
        default=None, description="Tokens used by the pipeline"
    )
    ui_items_count: Optional[int] = Field(
        default=None, description="Number of ui_answer items"
    )
    judge: Optional[EvalJudgeScores] = Field(
        default=None, description="Judge scores if judged"
    )
    output_json: Optional[str] = Field(
        default=None, description="Raw agent output (decision or content) as JSON"
    )
    finished_at: str = Field(description="ISO 8601 UTC timestamp")


class EvalRunRequest(BaseModel):
    """Request to start an eval run; cases match if they match any selector"""

    case_ids: List[str] = Field(default_factory=list, description="Select cases by ID")
    prompts: List[str] = Field(
        default_factory=list, description="Select cases by prompt"
    )
    tags: List[str] = Field(default_factory=list, description="Select cases by tag")
    suites: List[str] = Field(default_factory=list, description="Select cases by suite")
    rules: List[str] = Field(
        default_factory=list,
        description="Select cases by protected rule 'spec:rule_id'",
    )
    models: List[str] = Field(min_length=1, description="Models to run every case on")
    repeats: int = Field(
        default=1, ge=1, le=EVAL_MAX_REPEATS, description="Attempts per case and model"
    )
    judge: bool = Field(default=False, description="Run the LLM judge for judge cases")
    judge_model: Optional[str] = Field(default=None, description="Judge model (OpenAI)")
    reason: str = Field(min_length=3, description="Why the run was started")
    jira_key: Optional[str] = Field(
        default=None, description="Related JIRA issue, e.g. ARCHIE-208"
    )
    triggered_by: EvalTrigger = Field(default="ui", description="Who started the run")


class EvalRunInfo(BaseModel):
    """State and totals of one eval run"""

    run_id: str = Field(description="Eval run ID")
    status: EvalRunStatus = Field(description="Run state")
    request: EvalRunRequest = Field(description="Request the run was started with")
    case_ids: List[str] = Field(description="IDs of the selected cases")
    git_sha: Optional[str] = Field(
        default=None, description="Agent git commit, if known"
    )
    prompt_hashes: Dict[str, str] = Field(
        default_factory=dict, description="Prompt template name -> sha256 of its source"
    )
    total_attempts: int = Field(description="cases x models x repeats")
    done_attempts: int = Field(default=0, description="Finished attempts")
    passed: int = Field(default=0, description="Passed attempts")
    failed: int = Field(default=0, description="Failed attempts")
    errors: int = Field(default=0, description="Attempts that raised an error")
    total_tokens: int = Field(default=0, description="Tokens used so far")
    error: Optional[str] = Field(
        default=None, description="Run-level error if status is failed"
    )
    created_at: str = Field(description="ISO 8601 UTC timestamp")
    finished_at: Optional[str] = Field(
        default=None, description="ISO 8601 UTC timestamp"
    )


class EvalAttemptRef(BaseModel):
    """Identifies one attempt in progress"""

    case_id: str = Field(description="EvalCaseInfo.id")
    model: str = Field(description="Model of the attempt")
    attempt: int = Field(description="Attempt number")
    step: Optional[str] = Field(
        default=None, description="Current pipeline step, if known"
    )


class EvalSnapshotEvent(BaseModel):
    """Full run state, sent first on connect"""

    type: Literal["snapshot"] = Field("snapshot", description="Event type")
    run: EvalRunInfo = Field(description="Run state")
    cases: List[EvalCaseInfo] = Field(description="Selected cases")
    results: List[EvalCaseResult] = Field(description="Finished attempts")
    running: List[EvalAttemptRef] = Field(description="Attempts in progress")


class EvalAttemptStartedEvent(BaseModel):
    """An attempt started"""

    type: Literal["attempt_started"] = Field(
        "attempt_started", description="Event type"
    )
    attempt: EvalAttemptRef = Field(description="Started attempt")


class EvalAttemptStepEvent(BaseModel):
    """An attempt reached a new pipeline step"""

    type: Literal["attempt_step"] = Field("attempt_step", description="Event type")
    attempt: EvalAttemptRef = Field(description="Attempt with its current step")


class EvalAttemptFinishedEvent(BaseModel):
    """An attempt finished"""

    type: Literal["attempt_finished"] = Field(
        "attempt_finished", description="Event type"
    )
    result: EvalCaseResult = Field(description="Attempt result")
    run: EvalRunInfo = Field(description="Run state with updated totals")


class EvalRunFinishedEvent(BaseModel):
    """The run completed, was cancelled or failed"""

    type: Literal["run_finished"] = Field("run_finished", description="Event type")
    run: EvalRunInfo = Field(description="Final run state")


EvalServerEvent = Union[
    EvalSnapshotEvent,
    EvalAttemptStartedEvent,
    EvalAttemptStepEvent,
    EvalAttemptFinishedEvent,
    EvalRunFinishedEvent,
]
