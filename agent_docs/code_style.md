# Code Style

## Python

- **Python 3.11+**, PEP8, type annotations on all function signatures
- `|` union syntax (`str | None`, not `Optional[str]`)
- f-strings for formatting; `"""` for docstrings, `"` for single-line strings
- Multi-parameter function definitions and calls: each parameter on its own line
- Run `make format` after writing code

## Pydantic Models

- `BaseModel` for all data structures; avoid `Any`, `None`, `Dict` types
- Access fields directly — don't guard with `hasattr` or `.get()`
- Use `model_dump()` / `model_validate()`, not deprecated `.dict()` / `.parse_obj()`

## Architecture Rules

- One responsibility per function/class
- No global variables for state; use config, env vars, or constants
- Prefer dict dispatch over long `if/elif` chains
- No `print()` — use `logger` only
- No hardcoded values — use settings or env vars
- No wildcard imports (`from x import *`)
- No code in `__init__.py`
- No imports inside functions or methods

## Import Order

```python
import os                                           # 1. stdlib
from django.db import models                        # 2. third-party
from archie_web.light.models import LightDevice  # 3. local
```

## Naming

- Functions: `get_`, `create_`, `update_`, `execute_`, `parse_` prefixes
- Modules: `*_tool.py`, `*_service.py`, `*_utils.py`, `*_controller.py`
- No abbreviations in names

## What NOT to Do

- Don't use `print()` for logging
- Don't hardcode values — use settings or env vars
- Don't catch bare `except Exception` without logging the specific error
- Don't divide code with blank lines into visual "sections" inside functions
- Don't use imports inside functions or methods
- Don't create documentation files
