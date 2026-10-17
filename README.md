# Archie Web

[![CI](https://github.com/NikGor/archie-web/actions/workflows/ci.yml/badge.svg)](https://github.com/NikGor/archie-web/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11%2B-blue)](https://www.python.org/)

Django-based smart home dashboard — part of the Archie ecosystem. Light control (Yeelight), weather, cameras, AI assistant.

## Quick Start

### 1. Clone

```bash
git clone git@github.com:NikGor/archie-web.git archie-web
cd archie-web
```

### 2. Create `.env`

```bash
# Required
SECRET_KEY=your-secret-key-here
DEBUG=True

# Database (SQLite for development)
DATABASE_URL=sqlite:///db.sqlite3

# Or PostgreSQL for Docker/production:
# DATABASE_URL=postgresql://archie_web_user:change-me@host.docker.internal:5432/archie_web_db

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# AI Agent (required for chat functionality)
AI_AGENT_URL=http://localhost:8005

# Optional
OPENWEATHER_API_KEY=your-openweathermap-key
OPENAI_API_KEY=your-openai-key
PICOVOICE_ACCESS_KEY=your-picovoice-key
```

### 3. Local Installation

```bash
# Install Poetry
pip install poetry

# Install dependencies
poetry install

# Run migrations
poetry run python manage.py migrate

# Start server
poetry run python manage.py runserver
```

Or via Makefile:
```bash
make install && make migrate && make run
```

### 4. Docker Deployment

```bash
# Create shared network (once)
docker network create shared_network

# Create PostgreSQL database
sudo -u postgres psql -c "CREATE DATABASE archie_web_db;"
sudo -u postgres psql -c "CREATE USER archie_web_user WITH PASSWORD 'change-me';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE archie_web_db TO archie_web_user;"

# Set DATABASE_URL in .env to the host PostgreSQL connection above.
# Existing installations: retain COMPOSE_PROJECT_NAME and REDIS_DATA_VOLUME
# until the existing containers and Redis data have been migrated.

# Build and run
docker compose build
docker compose up -d
```

Application: http://localhost:8000

## AI Agent Connection

Archie Web proxies requests to external [archie-ai-agent](https://github.com/NikGor/archie-ai-agent).

```
[Archie Web :8000] ──proxy──▶ [AI Agent :8005]
     /ai-assistant/*                POST /chat
```

**`AI_AGENT_URL` configuration:**

| Scenario | Value |
|----------|-------|
| AI Agent on host | `http://localhost:8005` |
| AI Agent in Docker (same network) | `http://archie-ai-agent:8005` |
| AI Agent on another machine | `http://192.168.1.100:8005` |

Both containers must be in `shared_network`.

## Architecture

```
┌─────────────────┐     ┌─────────────────────┐
│ archie-frontend │────▶│ archie-web          │
│  (Next.js)      │     │   (Django :8000)    │
└─────────────────┘     └──────────┬──────────┘
                                   │
                       ┌───────────▼───────────┐
                       │   archie-ai-agent     │
                       │   (FastAPI :8005)     │
                       └───────────────────────┘
```

## Makefile Commands

| Command | Description |
|---------|-------------|
| `make run` | Start dev server |
| `make install` | Install dependencies |
| `make migrate` | Apply migrations |
| `make shell` | Django shell |
| `make superuser` | Create admin user |
| `make voice` | Start voice assistant |

## API Endpoints

**Light (Yeelight):**
- `POST /light/api/device/{id}/toggle/`
- `POST /light/api/device/{id}/brightness/`
- `POST /light/api/device/{id}/temperature/`
- `GET /light/api/devices/status/`

**AI Assistant:**
- `GET /ai-assistant/conversations/`
- `POST /ai-assistant/chat/`

## Tech Stack

- Python 3.11+, Django 5.2
- Poetry, Pydantic 2
- Redis, PostgreSQL
- Yeelight, OpenCV
- Docker Compose

## License

MIT
