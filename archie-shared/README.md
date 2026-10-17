# Archie Shared

Shared Pydantic models and utilities for the Archie ecosystem.

## Overview

This package contains common data models and utilities used across different Archie services:

- Chat models for AI assistant communication
- UI models for rich interface components
- Shared utilities and helpers

## Versioning

This package follows semantic versioning (SemVer). When using in production, it's recommended to pin to a specific version tag to ensure stability.

**Current version:** `v0.1.0`

### Creating new versions

#### Option 1: Using Makefile (recommended)

```bash
make bump-archie-shared VERSION=0.1.1
git push origin main
```

#### Option 2: Manual process

1. Update the version in `pyproject.toml`
2. Commit and push your changes:

```bash
git add archie-shared/pyproject.toml
git commit -m "bump archie-shared version to v0.1.1"
git push origin main
```

**The git tag and GitHub release will be created automatically** when you push changes to `archie-shared/pyproject.toml` on the main branch.

### Manual tagging (if needed)

If you need to create a tag manually:

```bash
git tag v0.1.1
git push origin v0.1.1
```

## Usage

### For external repositories (from GitHub):

Add to your `pyproject.toml`:

```toml
[tool.poetry.dependencies]
# Latest version from main branch
archie-shared = {git = "https://github.com/NikGor/archie-web.git", subdirectory = "archie-shared"}

# Specific version (recommended for production)
archie-shared = {git = "https://github.com/NikGor/archie-web.git", subdirectory = "archie-shared", tag = "v0.1.0"}

# Specific branch
archie-shared = {git = "https://github.com/NikGor/archie-web.git", subdirectory = "archie-shared", branch = "main"}

# Specific commit
archie-shared = {git = "https://github.com/NikGor/archie-web.git", subdirectory = "archie-shared", rev = "abc123def"}
```

Then run:

```bash
poetry install
```

Alternatively, you can add it via command line:

```bash
# Latest version
poetry add git+https://github.com/NikGor/archie-web.git#subdirectory=archie-shared

# Specific tag/version
poetry add "git+https://github.com/NikGor/archie-web.git@v0.1.0#subdirectory=archie-shared"

# Specific branch
poetry add "git+https://github.com/NikGor/archie-web.git@main#subdirectory=archie-shared"

# Specific commit
poetry add "git+https://github.com/NikGor/archie-web.git@abc123def#subdirectory=archie-shared"
```

### For local development in this repository:

```bash
poetry add archie-shared --path ./archie-shared
```

Then import the models you need:

```python
from archie_shared.chat.models import ChatMessage, ConversationModel
from archie_shared.ui.models import UIElements, Card
```
