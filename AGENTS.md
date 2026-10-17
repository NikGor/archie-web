# Archie Web

## Architecture

Modular Django 5.2 smart home dashboard. `webapp` is the central hub; specialized apps handle specific functionality.

**Dual model pattern** — Pydantic models (API/validation) + Django models (persistence), bridged via `to_*()`. See `homeassistant/ai_assistant/models.py`.
**API proxy pattern** — AI assistant proxies to external AI Agent via `requests.post(f'{AI_AGENT_URL}/chat', json=data)`.
**Device controller pattern** — `light/light_controller.py` manages connection pooling, thread-safety, auto-discovery.

| Prefix | App | Key details |
|--------|-----|-------------|
| `/` | webapp | Dashboard |
| `/light/` | light | Yeelight; `LightDevice`, `LightState`, `LightGroup`, `LightSchedule` |
| `/ai-assistant/` | ai_assistant | Proxy to external AI; `UIElements`, `Card`, `NavigationCard`; `LllmTrace` |
| `/weather/` | weather | OpenWeatherMap API, 10-min caching, `WeatherService` |
| `/camera/` | camera | — |
| `/api/` | api | — |
| `/chat-monitoring/` | chat_monitoring | LLM-judge grades of assistant turns (`MonitorRun`, `TurnEvaluation`); the agent runs the judge, UI tab «Мониторинг чатов» |
| — | ha_mcp | `HomeAssistantMCPClient` — Home Assistant MCP server client, feeds real device state to `climate`/`light` dashboard tiles |

---

## Environment Variables

```
SECRET_KEY
DEBUG
DATABASE_URL          # sqlite:///db.sqlite3 or Postgres
OPENWEATHER_API_KEY
BACKEND_API_URL       # http://archie-backend:8002
AI_AGENT_URL          # http://archie-ai-agent:8005
HOMEASSISTANT_MCP_URL    # http://homeassistant.local:8123/api/mcp
HOMEASSISTANT_MCP_TOKEN  # HA long-lived access token
```

---

## Task Workflow

Use `/workflow` for the full checklist. Steps:

1. Analyze — explore codebase, define acceptance criteria
2. JIRA → find or create task
3. Implement — code + tests
4. Review → 
5. Test → 
6. Git → 
7. JIRA update → 

JIRA project: **ARCHIE** on `badich.atlassian.net`. Details: `/task`.

---

## Development

```bash
make run                                    # Dev server
poetry run python manage.py migrate         # Apply migrations
poetry run python manage.py makemigrations  # After model changes
```

See `agent_docs/` for code style and logging conventions.

---

## Skills & Agents

| Skill | When to invoke |
|-------|----------------|
| `backend-developer` | Use for any Django change — models, views, services, URLs, migrations, tests, Redis |
| `frontend-developer` | Use for any UI change — templates, static JS/CSS, URL routing |
| `archie-shared` | Use when adding or editing shared Pydantic models: chat protocol types, UI components (cards, widgets, response levels), UserState |
| `ai-agent` | Use when building or editing UI that consumes AI agent responses — rendering response levels, WebSocket streaming, button discriminator (AssistantButton vs FrontendButton) |
| `db-explorer` | Use to query and inspect records in the PostgreSQL database — check tables, debug data, explore model records |
| `log-analyzer` | Use to investigate errors, exceptions, and unexpected behavior — always check Docker logs before drawing conclusions |
