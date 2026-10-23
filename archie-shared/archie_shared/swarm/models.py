"""Swarm chat protocol: messages agents post to the shared swarm chat and WS events."""

from typing import List, Literal, Optional, Union

from pydantic import BaseModel, Field, model_validator

SWARM_TEXT_MAX_LENGTH = 280
SWARM_MEMORY_FACT_MAX_LENGTH = 200
_CLOCK_PATTERN = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"

SwarmMessageKind = Literal[
    "user",
    "report",
    "action",
    "proposal",
    "alert",
    "system",
    "opinion",  # council member position during a discussion; wakes nobody
    "decision",  # the single council answer to the user; may delegate via @mentions
    "check",  # a spontaneous check that found nothing new; agents do not read it
]
SwarmAgentRole = Literal["state", "action"]
# running: periodic checks and chat; paused: chat only; stopped: swarm off, chat cleared
SwarmMode = Literal["running", "paused", "stopped"]
SwarmWatchTask = Literal["home", "mail", "calendar", "football"]
# low: chat only; normal: LED display; high: LED display and voice
SwarmImportance = Literal["low", "normal", "high"]


class SwarmUsage(BaseModel):
    """LLM usage spent to produce one swarm message"""

    model: str = Field(description="LLM model that produced the message")
    input_tokens: int = Field(default=0, description="Input tokens used")
    output_tokens: int = Field(default=0, description="Output tokens used")
    total_cost: float = Field(default=0.0, description="Cost in USD")


class SwarmActionInfo(BaseModel):
    """A tool call an action agent executed or wants to execute"""

    tool_name: str = Field(description="Name of the Archie tool")
    arguments_json: str = Field(
        default="{}", description="Tool arguments as a JSON object string"
    )
    status: Literal["success", "error", "blocked"] = Field(
        description="Outcome of the tool call; blocked means the policy denied it"
    )
    summary: Optional[str] = Field(
        default=None, description="Short human-readable result of the call"
    )


class SwarmProposal(BaseModel):
    """An action that needs user approval before it runs"""

    proposal_id: str = Field(description="Unique proposal ID")
    action: SwarmActionInfo = Field(description="The proposed tool call")
    status: Literal["pending", "approved", "rejected", "executed", "failed"] = Field(
        default="pending", description="Approval state of the proposal"
    )


class SwarmMessage(BaseModel):
    """One message in the shared swarm chat"""

    message_id: str = Field(description="Unique message ID (Redis stream entry ID)")
    created_at: str = Field(description="ISO 8601 UTC timestamp")
    sender: str = Field(
        description="Agent ID (e.g. 'light'), or 'user', 'system', 'ha'"
    )
    kind: SwarmMessageKind = Field(description="Message kind, drives rendering")
    text: str = Field(
        max_length=SWARM_TEXT_MAX_LENGTH,
        description="Short message text; may contain @agent mentions",
    )
    mentions: List[str] = Field(
        default_factory=list, description="Agent IDs mentioned in the text"
    )
    reply_to: Optional[str] = Field(
        default=None, description="Message ID this message reacts to"
    )
    depth: int = Field(
        default=0,
        description="Number of agent hops since the last user/system trigger",
    )
    actions: List[SwarmActionInfo] = Field(
        default_factory=list, description="Tool calls executed for this message"
    )
    proposal: Optional[SwarmProposal] = Field(
        default=None, description="Action waiting for user approval"
    )
    importance: Optional[SwarmImportance] = Field(
        default=None, description="Importance of a spontaneous alert"
    )
    usage: Optional[SwarmUsage] = Field(
        default=None, description="LLM usage for this message"
    )


class SwarmAgentInfo(BaseModel):
    """Public description of a swarm agent for the roster UI"""

    agent_id: str = Field(description="Agent ID used in @mentions")
    display_name: str = Field(description="Human-readable agent name")
    role: SwarmAgentRole = Field(
        description="state agents only observe and report; action agents may act"
    )
    description: str = Field(description="One-line description of the agent")
    icon: str = Field(description="Lucide icon name")
    color: str = Field(description="Accent color as CSS hex, e.g. '#f5b301'")
    enabled: bool = Field(default=True, description="Whether the agent is awake")
    groups: List[str] = Field(
        default_factory=list,
        description="Groups the agent belongs to; '@group' mentions wake all members",
    )


class SwarmSettings(BaseModel):
    """User settings of the spontaneous swarm checks; times are HH:MM in the user's time zone"""

    interval_min_minutes: int = Field(
        default=3, ge=1, le=60, description="Shortest random pause between checks"
    )
    interval_max_minutes: int = Field(
        default=16, ge=1, le=60, description="Longest random pause between checks"
    )
    active_from: str = Field(
        default="08:00", pattern=_CLOCK_PATTERN, description="Checks start"
    )
    active_until: str = Field(
        default="00:00",
        pattern=_CLOCK_PATTERN,
        description="Checks end; 00:00 means midnight",
    )
    voice_from_weekday: str = Field(
        default="09:00",
        pattern=_CLOCK_PATTERN,
        description="Voice alerts start on Monday to Friday",
    )
    voice_from_weekend: str = Field(
        default="11:00",
        pattern=_CLOCK_PATTERN,
        description="Voice alerts start on Saturday and Sunday",
    )
    voice_until: str = Field(
        default="23:30", pattern=_CLOCK_PATTERN, description="Voice alerts end"
    )
    tasks: List[SwarmWatchTask] = Field(
        default_factory=lambda: ["home", "mail", "calendar", "football"],
        description="Enabled checks; one check runs per wake-up",
    )
    football_teams: List[str] = Field(
        default_factory=list, description="Teams whose live matches the swarm follows"
    )

    @model_validator(mode="after")
    def _check_interval(self) -> "SwarmSettings":
        if self.interval_min_minutes > self.interval_max_minutes:
            raise ValueError("interval_min_minutes must not exceed interval_max_minutes")
        return self


class SwarmMemoryFact(BaseModel):
    """A lasting fact or preference the swarm keeps in every prompt"""

    fact_id: str = Field(description="Unique fact ID")
    text: str = Field(
        max_length=SWARM_MEMORY_FACT_MAX_LENGTH, description="The fact, one sentence"
    )
    created_at: str = Field(description="ISO 8601 UTC timestamp")


class SwarmRunInfo(BaseModel):
    """Outcome of one spontaneous check"""

    task: SwarmWatchTask = Field(description="The check that ran")
    finished_at: str = Field(description="ISO 8601 UTC timestamp")
    outcome: Literal["silent", "reported", "failed"] = Field(
        description="silent: nothing new; reported: an alert was posted"
    )


# --- WebSocket events, server -> client ---


class SwarmHistoryEvent(BaseModel):
    """Recent messages and the agent roster, sent once on connect"""

    type: Literal["history"] = Field("history", description="Event type")
    messages: List[SwarmMessage] = Field(description="Recent messages, oldest first")
    agents: List[SwarmAgentInfo] = Field(description="Agent roster")


class SwarmMessageEvent(BaseModel):
    """A new message was posted to the swarm chat"""

    type: Literal["message"] = Field("message", description="Event type")
    message: SwarmMessage = Field(description="The new message")


class SwarmTypingEvent(BaseModel):
    """An agent started or stopped working on a reply"""

    type: Literal["typing"] = Field("typing", description="Event type")
    agent_id: str = Field(description="Agent ID")
    active: bool = Field(description="True while the agent is working")


class SwarmAgentsEvent(BaseModel):
    """The agent roster changed"""

    type: Literal["agents"] = Field("agents", description="Event type")
    agents: List[SwarmAgentInfo] = Field(description="Agent roster")


class SwarmControlEvent(BaseModel):
    """Mode, settings, schedule and long-term memory of the swarm"""

    type: Literal["control"] = Field("control", description="Event type")
    mode: SwarmMode = Field(description="Current swarm mode")
    settings: SwarmSettings = Field(description="Current settings")
    next_run_at: Optional[str] = Field(
        default=None, description="ISO 8601 UTC time of the next check, if planned"
    )
    last_run: Optional[SwarmRunInfo] = Field(
        default=None, description="Outcome of the last check"
    )
    memory: List[SwarmMemoryFact] = Field(
        default_factory=list, description="Long-term memory facts"
    )


SwarmServerEvent = Union[
    SwarmHistoryEvent,
    SwarmMessageEvent,
    SwarmTypingEvent,
    SwarmAgentsEvent,
    SwarmControlEvent,
]


# --- WebSocket events, client -> server ---


class SwarmUserMessageCommand(BaseModel):
    """User posts a message to the swarm chat"""

    type: Literal["user_message"] = Field("user_message", description="Command type")
    text: str = Field(
        max_length=SWARM_TEXT_MAX_LENGTH, description="Message text with @mentions"
    )


class SwarmToggleAgentCommand(BaseModel):
    """User wakes up or puts an agent to sleep"""

    type: Literal["toggle_agent"] = Field("toggle_agent", description="Command type")
    agent_id: str = Field(description="Agent ID")
    enabled: bool = Field(description="New enabled state")


class SwarmProposalDecisionCommand(BaseModel):
    """User approves or rejects a proposal"""

    type: Literal["approve", "reject"] = Field(description="Decision")
    proposal_id: str = Field(description="Proposal ID")


class SwarmModeCommand(BaseModel):
    """User presses Play, Pause or Stop"""

    type: Literal["set_mode"] = Field("set_mode", description="Command type")
    mode: SwarmMode = Field(description="New swarm mode")


class SwarmSettingsCommand(BaseModel):
    """User saves the swarm settings"""

    type: Literal["update_settings"] = Field(
        "update_settings", description="Command type"
    )
    settings: SwarmSettings = Field(description="New settings")


class SwarmForgetCommand(BaseModel):
    """User deletes a long-term memory fact"""

    type: Literal["forget"] = Field("forget", description="Command type")
    fact_id: str = Field(description="Fact ID")


SwarmClientCommand = Union[
    SwarmUserMessageCommand,
    SwarmToggleAgentCommand,
    SwarmProposalDecisionCommand,
    SwarmModeCommand,
    SwarmSettingsCommand,
    SwarmForgetCommand,
]
