# Gemini Provider Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the life-dashboard AI-edit subsystem's backing provider from Anthropic Claude to Google Gemini (free tier, Flash-Lite), with no behavior change visible to callers.

**Architecture:** Swap `anthropic.Anthropic` for `google.genai.Client` inside `_ask_ai` (formerly `_ask_claude`) and `_classify_resource`, preserving every existing function name/signature/error-status-code contract elsewhere. Only `backend/routers/ai.py`, `backend/routers/voice.py`, their 4 test files, and configuration change.

**Tech Stack:** FastAPI, SQLModel, `google-genai` SDK (replaces `anthropic`), pytest.

**Spec:** `docs/superpowers/specs/2026-09-17-gemini-provider-swap-design.md`

## Global Constraints

- No provider-abstraction layer, no dual-provider fallback (spec §5 — out of scope).
- `AI_MODEL_ID` env var keeps its name and override mechanism; only its default value changes.
- Test *behavior* (what's asserted — status codes, scope notes, create/update/delete outcomes) does not change; only mock shape and exception types do.
- Error-status contract stays 1:1: provider/API error → 502, safety-block/refusal → 422, unusable response → 502, missing key → 503.

## Amendment to the design spec (from source-level verification)

The spec (§3) called for a live-key spike before implementation. No `GEMINI_API_KEY` is available in this environment, so the three open questions were answered instead by reading the installed `google-genai==2.24.0` SDK source directly (`google/genai/types.py` `GenerateContentResponse._from_response`, `google/genai/errors.py`). Findings, and where they change spec §4:

1. **`.parsed` on schema mismatch does NOT raise.** The SDK's `_from_response` wraps `response_schema.model_validate_json(...)` in `try/except pydantic.ValidationError: pass` / `except json.decoder.JSONDecodeError: pass` internally, leaving `response.parsed` at its default of `None`. There is **no separate exception to catch** for "schema-validation failure" — it is the exact same signal as "no usable response" (`parsed is None`). Spec §4.1's two separate bullets ("Schema-validation failure → 502" and "`parsed` is `None`/missing → 502") collapse into **one check**.
2. **Refusal analog is `finish_reason`, not a raised exception.** `Candidate.finish_reason` is a `FinishReason(str, enum.Enum)` (so it compares equal to plain strings). Normal completion is `"STOP"`. The closest 1:1 analog to Anthropic's narrow `stop_reason == "refusal"` check is `finish_reason == "SAFETY"` — not "any non-STOP value" as spec §4.1 loosely put it (that would wrongly turn e.g. a `MAX_TOKENS` truncation into a 422 "declined" instead of falling through to the existing 502 "no usable response" path, since `.parsed` is `None` there too). This plan uses the narrow `"SAFETY"` check to preserve today's exact behavior for non-refusal stop reasons.
3. **`google.genai.errors.APIError`** is the base class of both `ClientError` (4xx) and `ServerError` (5xx) — one `except` clause catches both, exactly as spec assumed.

Confirmed call shape: `client.models.generate_content(model=str, contents=..., config=types.GenerateContentConfig(system_instruction=..., max_output_tokens=..., response_mime_type="application/json", response_schema=SomePydanticModel))`.

---

## File Structure

- Modify `life-dashboard/backend/routers/ai.py` — provider client + `_ask_ai` (rename of `_ask_claude`) + new `_finish_reason` helper.
- Modify `life-dashboard/backend/routers/voice.py` — imports + `_classify_resource`.
- Modify `life-dashboard/backend/requirements.txt`, `life-dashboard/.env.example` — dependency/config swap.
- Modify `life-dashboard/backend/tests/test_ai_edit.py`, `test_ai_edit_preview.py`, `test_ai_edit_routers.py`, `test_voice_command.py` — mocks rebuilt around the Gemini response shape.

**Test runner:** `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest tests/<file> -v` (existing venv at `life-dashboard/backend/.venv`, already has `anthropic==1.4.0` matching current `requirements.txt`; `pytest.ini` sets `pythonpath = ..` so `backend.*` imports resolve).

---

### Task 1: Dependency & configuration swap

**Files:**
- Modify: `life-dashboard/backend/requirements.txt`
- Modify: `life-dashboard/.env.example`

**Interfaces:**
- Produces: `google-genai` importable as `google.genai` in the backend venv, for Task 2 onward.

- [ ] **Step 1: Update `requirements.txt`**

In `life-dashboard/backend/requirements.txt`, replace:
```
anthropic>=1.4,<1.5
```
with:
```
google-genai>=2.24,<2.25
```

- [ ] **Step 2: Update `.env.example`**

In `life-dashboard/.env.example`, replace:
```
# Required for the AI editing layer (meal plan, workouts, reminders).
# Get a key at https://console.anthropic.com/
ANTHROPIC_API_KEY=

# Optional: override the AI model used for editing (default: claude-opus-5).
# Leave commented out to use the default — an explicitly blank value is still
# "set" and would be used verbatim.
# AI_MODEL_ID=
```
with:
```
# Required for the AI editing layer (meal plan, workouts, reminders).
# Get a free-tier key at https://aistudio.google.com/apikey
GEMINI_API_KEY=

# Optional: override the AI model used for editing (default:
# gemini-flash-lite-latest — the only free-tier model with a daily quota
# that holds up under real dashboard use; regular Flash models cap out at
# ~20 free requests/day). Leave commented out to use the default — an
# explicitly blank value is still "set" and would be used verbatim.
# AI_MODEL_ID=
```

- [ ] **Step 3: Install into the backend venv**

Run:
```
cd life-dashboard/backend
.venv/Scripts/python.exe -m pip uninstall -y anthropic
.venv/Scripts/python.exe -m pip install "google-genai>=2.24,<2.25"
```
Expected: `google-genai` installs cleanly; `.venv/Scripts/python.exe -c "from google import genai; from google.genai import errors, types"` exits 0.

- [ ] **Step 4: Commit**

```bash
git add life-dashboard/backend/requirements.txt life-dashboard/.env.example
git commit -m "build: swap anthropic dependency for google-genai"
```

---

### Task 2: `backend/routers/ai.py` core swap + `tests/test_ai_edit.py`

**Files:**
- Modify: `life-dashboard/backend/routers/ai.py`
- Modify: `life-dashboard/backend/tests/test_ai_edit.py`

**Interfaces:**
- Consumes: `google.genai.Client`, `google.genai.errors.APIError`, `google.genai.types.GenerateContentConfig` (Task 1's install).
- Produces: `get_ai_client() -> genai.Client`, `_ask_ai(client, config, message, existing, scope_note) -> list` (same return contract as old `_ask_claude`), `_finish_reason(response) -> Optional[str]` — all consumed by Task 5's `voice.py` rewrite. `AI_MODEL_ID` default becomes `"gemini-flash-lite-latest"`.

- [ ] **Step 1: Update imports and `AI_MODEL_ID`**

In `life-dashboard/backend/routers/ai.py`, replace:
```python
import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError, create_model
```
with:
```python
from fastapi import APIRouter, Depends, HTTPException
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from pydantic import BaseModel, create_model
```
(`ValidationError` is no longer imported — nothing in this file raises or catches it anymore; see the Amendment section above.)

Replace:
```python
AI_MODEL_ID = os.environ.get("AI_MODEL_ID") or "claude-opus-5"
```
with:
```python
AI_MODEL_ID = os.environ.get("AI_MODEL_ID") or "gemini-flash-lite-latest"
```

- [ ] **Step 2: Replace `get_anthropic_client` with `get_ai_client`**

Replace:
```python
def get_anthropic_client() -> anthropic.Anthropic:
    """FastAPI dependency yielding an Anthropic client.

    Fails fast with a clear 503 when no API key is configured. Without this,
    the SDK resolves a missing *or blank* ANTHROPIC_API_KEY to ``None`` and
    then raises a bare ``TypeError`` from ``_validate_headers`` on the first
    request — a ``TypeError`` is not an ``anthropic.APIError``, so it would
    slip past the handler's error handling and surface as an opaque 500.
    """
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(
            status_code=503,
            detail="AI editing is not configured: ANTHROPIC_API_KEY is not set.",
        )
    return anthropic.Anthropic()
```
with:
```python
def get_ai_client() -> genai.Client:
    """FastAPI dependency yielding a Gemini client.

    Fails fast with a clear 503 when no API key is configured — read
    explicitly rather than relying on the SDK's own env-var auto-detection,
    so a missing or blank GEMINI_API_KEY can't slip past into some other,
    less clear error.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="AI editing is not configured: GEMINI_API_KEY is not set.",
        )
    return genai.Client(api_key=api_key)
```

- [ ] **Step 3: Replace `_ask_claude` with `_finish_reason` + `_ask_ai`**

Replace the entire `_ask_claude` function body:
```python
def _ask_claude(
    client: anthropic.Anthropic,
    config: AiEditConfig,
    message: str,
    existing,
    scope_note: str,
):
    current_json = [item.model_dump(mode="json") for item in existing]
    system_prompt = (
        f"You are the AI editing assistant for the {config.resource_label} feature of a "
        "personal life dashboard. You will be given the user's current entries as "
        "a JSON array (each has an `id`) and a natural-language request describing "
        "a change. Return the complete updated array of entries reflecting the "
        "request: keep entries unchanged (with their original `id`) unless the "
        "request modifies them, modify entries the request refers to (preserve "
        "their `id`), omit entries the request asks to delete, and add new "
        "entries with `id` set to null for anything new the request asks to "
        "create. Only include entries within what you were given — never invent "
        "entries outside that scope."
        + scope_note
        + (" " + config.extra_instructions if config.extra_instructions else "")
    )
    try:
        response = client.messages.parse(
            model=AI_MODEL_ID,
            max_tokens=4096,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Current data: {json.dumps(current_json)}\n\n"
                        f"User request: {message}"
                    ),
                }
            ],
            output_format=config.result_schema,
        )
    except anthropic.APIError as exc:
        raise HTTPException(status_code=502, detail=f"AI request failed: {exc}")
    except ValidationError:
        raise HTTPException(
            status_code=502,
            detail="AI response did not match the expected schema.",
        )

    if getattr(response, "stop_reason", None) == "refusal":
        raise HTTPException(
            status_code=422, detail="The AI declined to process this request."
        )

    # parsed_output can be None in narrow cases (e.g. an empty content
    # list) that neither the refusal check nor ValidationError catches;
    # reading .items off None would be an unhandled 500.
    parsed_output = getattr(response, "parsed_output", None)
    if parsed_output is None:
        raise HTTPException(
            status_code=502, detail="AI returned no usable response."
        )

    return parsed_output.items
```
with:
```python
def _finish_reason(response: genai_types.GenerateContentResponse) -> Optional[str]:
    candidates = getattr(response, "candidates", None)
    if not candidates:
        return None
    return candidates[0].finish_reason


def _ask_ai(
    client: genai.Client,
    config: AiEditConfig,
    message: str,
    existing,
    scope_note: str,
):
    current_json = [item.model_dump(mode="json") for item in existing]
    system_prompt = (
        f"You are the AI editing assistant for the {config.resource_label} feature of a "
        "personal life dashboard. You will be given the user's current entries as "
        "a JSON array (each has an `id`) and a natural-language request describing "
        "a change. Return the complete updated array of entries reflecting the "
        "request: keep entries unchanged (with their original `id`) unless the "
        "request modifies them, modify entries the request refers to (preserve "
        "their `id`), omit entries the request asks to delete, and add new "
        "entries with `id` set to null for anything new the request asks to "
        "create. Only include entries within what you were given — never invent "
        "entries outside that scope."
        + scope_note
        + (" " + config.extra_instructions if config.extra_instructions else "")
    )
    try:
        response = client.models.generate_content(
            model=AI_MODEL_ID,
            contents=(
                f"Current data: {json.dumps(current_json)}\n\n"
                f"User request: {message}"
            ),
            config=genai_types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=4096,
                response_mime_type="application/json",
                response_schema=config.result_schema,
            ),
        )
    except genai_errors.APIError as exc:
        raise HTTPException(status_code=502, detail=f"AI request failed: {exc}")

    if _finish_reason(response) == "SAFETY":
        raise HTTPException(
            status_code=422, detail="The AI declined to process this request."
        )

    # .parsed is None both for a truly empty response and for one whose JSON
    # didn't match config.result_schema — the SDK validates internally and
    # swallows pydantic.ValidationError/JSONDecodeError itself
    # (GenerateContentResponse._from_response), leaving .parsed at its
    # default of None rather than raising. There is no separate
    # schema-mismatch exception to catch here.
    parsed = getattr(response, "parsed", None)
    if parsed is None:
        raise HTTPException(
            status_code=502, detail="AI returned no usable response."
        )

    return parsed.items
```

- [ ] **Step 4: Update the three router functions**

In `make_ai_edit_router`, replace all three occurrences of:
```python
        client: anthropic.Anthropic = Depends(get_anthropic_client),
```
with:
```python
        client: genai.Client = Depends(get_ai_client),
```
(only `ai_edit` and `ai_edit_preview` have this parameter — `ai_edit_apply` does not call the AI and is unchanged.)

Replace both occurrences of:
```python
        returned_items = _ask_claude(client, config, body.message, existing, scope_note)
```
with:
```python
        returned_items = _ask_ai(client, config, body.message, existing, scope_note)
```

- [ ] **Step 5: Run a quick import/syntax check**

Run: `cd life-dashboard/backend && .venv/Scripts/python.exe -c "import backend.routers.ai"`
Expected: exits 0, no `ImportError`/`AttributeError`.

- [ ] **Step 6: Rewrite `tests/test_ai_edit.py`**

Replace the helper block:
```python
def make_mock_anthropic_client(parsed_items, stop_reason="end_turn"):
    """Build a fake Anthropic client whose messages.parse() returns a
    canned parsed result, so tests never make a real network call."""
    mock_client = MagicMock()
    mock_response = SimpleNamespace(
        parsed_output=SimpleNamespace(items=parsed_items),
        stop_reason=stop_reason,
    )
    mock_client.messages.parse.return_value = mock_response
    return mock_client
```
with:
```python
def make_mock_gemini_client(parsed_items, finish_reason="STOP"):
    """Build a fake Gemini client whose generate_content() returns a canned
    parsed result, so tests never make a real network call."""
    mock_client = MagicMock()
    mock_response = SimpleNamespace(
        parsed=SimpleNamespace(items=parsed_items),
        candidates=[SimpleNamespace(finish_reason=finish_reason)],
    )
    mock_client.models.generate_content.return_value = mock_response
    return mock_client
```
`make_parsed_item` is provider-agnostic (only deals in `model_dump`) — leave it unchanged.

Apply this substitution to **every** test in the file (mechanical rename, same for all of them):
| Old | New |
|---|---|
| `from backend.routers.ai import get_anthropic_client` | `from backend.routers.ai import get_ai_client` |
| `make_mock_anthropic_client(...)` | `make_mock_gemini_client(...)` |
| `app.dependency_overrides[get_anthropic_client]` | `app.dependency_overrides[get_ai_client]` |
| `app.dependency_overrides.pop(get_anthropic_client, None)` | `app.dependency_overrides.pop(get_ai_client, None)` |

Then these tests need call-site/assertion changes beyond the mechanical rename — replace their bodies fully:

`test_ai_edit_creates_a_new_meal_plan_item` — replace the assertion block at the end:
```python
    # Verify the system prompt mentioned the scope and the raw request reached the mock
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    assert "meal plan" in call_kwargs["system"].lower()
    assert "add chicken stir fry for dinner Thursday" in call_kwargs["messages"][0]["content"]
```
with:
```python
    # Verify the system prompt mentioned the scope and the raw request reached the mock
    call_kwargs = mock_client.models.generate_content.call_args.kwargs
    assert "meal plan" in call_kwargs["config"].system_instruction.lower()
    assert "add chicken stir fry for dinner Thursday" in call_kwargs["contents"]
```

Delete `test_ai_edit_returns_502_on_anthropic_api_error` entirely and replace it with:
```python
def test_ai_edit_returns_502_on_gemini_api_error(client, session):
    from google.genai import errors as genai_errors

    from backend.routers.ai import get_ai_client

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = genai_errors.APIError(
        code=503, response_json={"message": "model unavailable"}
    )
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit", json={"message": "anything"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 502
```

Delete `test_ai_edit_returns_502_on_schema_invalid_ai_response` entirely (see Amendment §1 — the Gemini SDK doesn't raise a separate exception for this; it's now indistinguishable from `parsed is None`, covered by the next test).

Replace `test_ai_edit_returns_502_when_parsed_output_is_none` with:
```python
def test_ai_edit_returns_502_when_parsed_is_none(client, session):
    """.parsed is None both for a truly empty response and for one whose JSON
    didn't match the schema — the SDK validates internally and swallows the
    mismatch (see backend/routers/ai.py's _ask_ai). Reading .items off None
    would otherwise be an unhandled 500."""
    from backend.routers.ai import get_ai_client

    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(
        parsed=None, candidates=[SimpleNamespace(finish_reason="STOP")]
    )
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit", json={"message": "anything"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 502
    assert "no usable response" in resp.json()["detail"].lower()
```

Replace `test_ai_edit_returns_422_when_the_ai_refuses` with:
```python
def test_ai_edit_returns_422_when_the_ai_refuses(client, session):
    from backend.routers.ai import get_ai_client

    mock_client = make_mock_gemini_client([], finish_reason="SAFETY")
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit", json={"message": "do something bad"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 422
    assert "declined" in resp.json()["detail"].lower()
```

Replace `test_ai_edit_returns_503_when_no_api_key_is_configured` with:
```python
def test_ai_edit_returns_503_when_no_api_key_is_configured(client, session, monkeypatch):
    """The real get_ai_client must run here — no dependency override — so a
    missing key surfaces as a clear 503."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from backend.routers.ai import get_ai_client

    assert get_ai_client not in app.dependency_overrides

    resp = client.post("/api/meal-plan/ai-edit", json={"message": "anything"})

    assert resp.status_code == 503
    assert "GEMINI_API_KEY" in resp.json()["detail"]
```

Replace `test_ai_edit_returns_503_when_api_key_is_blank` with:
```python
def test_ai_edit_returns_503_when_api_key_is_blank(client, session, monkeypatch):
    """A blank GEMINI_API_KEY must give the same clear 503 as an unset one."""
    monkeypatch.setenv("GEMINI_API_KEY", "")
    from backend.routers.ai import get_ai_client

    assert get_ai_client not in app.dependency_overrides

    resp = client.post("/api/workouts/ai-edit", json={"message": "anything"})

    assert resp.status_code == 503
```

Replace `test_ai_model_id_falls_back_when_env_var_is_blank` with:
```python
def test_ai_model_id_falls_back_when_env_var_is_blank(monkeypatch):
    """os.environ.get(key, default) would return "" for an explicitly blank
    var; the `or` form must fall back to the default instead."""
    import importlib.util

    import backend.routers.ai

    def load_fresh():
        # Execute a fresh copy of ai.py without replacing sys.modules'
        # backend.routers.ai (which would break other tests' dependency overrides).
        spec = importlib.util.spec_from_file_location(
            "_ai_model_id_probe", backend.routers.ai.__file__
        )
        probe = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(probe)
        return probe

    monkeypatch.setenv("AI_MODEL_ID", "")
    assert load_fresh().AI_MODEL_ID == "gemini-flash-lite-latest"

    monkeypatch.delenv("AI_MODEL_ID", raising=False)
    assert load_fresh().AI_MODEL_ID == "gemini-flash-lite-latest"

    monkeypatch.setenv("AI_MODEL_ID", "gemini-some-other-model")
    assert load_fresh().AI_MODEL_ID == "gemini-some-other-model"
```

The remaining tests (`test_ai_edit_updates_an_existing_item_by_id`, `test_ai_edit_deletes_items_omitted_from_the_response`, `test_ai_edit_scopes_to_the_requested_date_range`, `test_ai_edit_does_not_wipe_optional_fields_the_ai_omitted`, `test_ai_edit_create_still_applies_model_defaults_for_omitted_fields`, `test_ai_edit_does_not_reset_a_sent_reminder_the_ai_omitted`, `test_ai_edit_logs_a_warning_when_rows_are_deleted`) need only the mechanical rename table above — no other logic changes, since none of them inspect `call_kwargs` or construct a raw response object.

- [ ] **Step 7: Run the test file**

Run: `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest tests/test_ai_edit.py -v`
Expected: all tests pass (16 tests: 17 original minus 1 deleted-as-redundant).

- [ ] **Step 8: Commit**

```bash
git add life-dashboard/backend/routers/ai.py life-dashboard/backend/tests/test_ai_edit.py
git commit -m "feat: swap ai.py's AI provider from Anthropic to Gemini"
```

---

### Task 3: `tests/test_ai_edit_preview.py`

**Files:**
- Modify: `life-dashboard/backend/tests/test_ai_edit_preview.py`

**Interfaces:**
- Consumes: `get_ai_client` from Task 2 (no other new interfaces — this file only exercises `/ai-edit/preview` and `/ai-edit/apply`, which don't touch `_finish_reason` directly).

- [ ] **Step 1: Rewrite the helper**

Replace:
```python
def make_mock_anthropic_client(parsed_items, stop_reason="end_turn"):
    mock_client = MagicMock()
    mock_client.messages.parse.return_value = SimpleNamespace(
        parsed_output=SimpleNamespace(items=parsed_items), stop_reason=stop_reason
    )
    return mock_client
```
with:
```python
def make_mock_gemini_client(parsed_items, finish_reason="STOP"):
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(
        parsed=SimpleNamespace(items=parsed_items),
        candidates=[SimpleNamespace(finish_reason=finish_reason)],
    )
    return mock_client
```

- [ ] **Step 2: Apply the mechanical rename across the whole file**

| Old | New |
|---|---|
| `from backend.routers.ai import get_anthropic_client` | `from backend.routers.ai import get_ai_client` |
| `make_mock_anthropic_client(...)` | `make_mock_gemini_client(...)` |
| `app.dependency_overrides[get_anthropic_client]` | `app.dependency_overrides[get_ai_client]` |
| `app.dependency_overrides.pop(get_anthropic_client, None)` | `app.dependency_overrides.pop(get_ai_client, None)` |

This covers every test in the file (`test_preview_creates_show_up_in_created_and_nothing_is_persisted`, `test_preview_updates_show_before_and_after_without_persisting`, `test_preview_deletions_show_up_without_persisting`, `test_preview_no_op_change_is_not_reported_as_updated`, `test_apply_does_not_call_the_ai`, `test_preview_then_apply_round_trip_creates_correctly`, `test_preview_then_apply_round_trip_preserves_omitted_optional_fields`, `test_preview_then_apply_round_trip_deletes_correctly`) — none of them inspect `call_kwargs`.

- [ ] **Step 3: Update the refusal test**

Replace `test_preview_passes_through_refusal_and_api_error_like_ai_edit`:
```python
def test_preview_passes_through_refusal_and_api_error_like_ai_edit(client, session):
    from backend.routers.ai import get_anthropic_client

    mock_client = make_mock_anthropic_client([], stop_reason="refusal")
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit/preview", json={"message": "do something bad"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 422
```
with:
```python
def test_preview_passes_through_refusal_and_api_error_like_ai_edit(client, session):
    from backend.routers.ai import get_ai_client

    mock_client = make_mock_gemini_client([], finish_reason="SAFETY")
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit/preview", json={"message": "do something bad"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 422
```

- [ ] **Step 4: Run the test file**

Run: `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest tests/test_ai_edit_preview.py -v`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add life-dashboard/backend/tests/test_ai_edit_preview.py
git commit -m "test: rebuild ai-edit preview mocks around Gemini response shape"
```

---

### Task 4: `tests/test_ai_edit_routers.py`

**Files:**
- Modify: `life-dashboard/backend/tests/test_ai_edit_routers.py`

**Interfaces:**
- Consumes: `get_ai_client` from Task 2.

- [ ] **Step 1: Rewrite the helper and imports**

Replace:
```python
from backend.routers.ai import _current_week_bounds, get_anthropic_client
from backend.main import app


def make_mock_client(parsed_items):
    mock_client = MagicMock()
    mock_client.messages.parse.return_value = SimpleNamespace(
        parsed_output=SimpleNamespace(items=parsed_items), stop_reason="end_turn"
    )
    return mock_client
```
with:
```python
from backend.routers.ai import _current_week_bounds, get_ai_client
from backend.main import app


def make_mock_client(parsed_items):
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(
        parsed=SimpleNamespace(items=parsed_items),
        candidates=[SimpleNamespace(finish_reason="STOP")],
    )
    return mock_client
```

- [ ] **Step 2: Apply the mechanical rename across the whole file**

| Old | New |
|---|---|
| `app.dependency_overrides[get_anthropic_client]` | `app.dependency_overrides[get_ai_client]` |
| `app.dependency_overrides.pop(get_anthropic_client, None)` | `app.dependency_overrides.pop(get_ai_client, None)` |

This covers `test_workouts_ai_edit_endpoint_exists_and_is_scoped`, `test_reminders_ai_edit_endpoint_exists_and_is_unscoped`, `test_workouts_ai_edit_preview_and_apply_round_trip`, `test_reminders_ai_edit_preview_and_apply_round_trip`, `test_calendar_ai_edit_endpoint_exists_and_is_scoped`, `test_calendar_ai_edit_includes_events_late_on_the_last_scoped_day`, `test_filament_ai_edit_endpoint_exists_and_is_unscoped`, `test_groceries_ai_edit_creates_a_new_item`.

- [ ] **Step 3: Update `call_kwargs` assertions**

In `test_workouts_ai_edit_endpoint_exists_and_is_scoped`, replace:
```python
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    assert "workout" in call_kwargs["system"].lower()
    # scope_note is only generated when scope_field is active; assert on its unique text
    assert "entries with date between" in call_kwargs["system"]
    # extra_instructions steers the AI toward concrete exercises for a split,
    # not vague advice — assert it actually reaches the system prompt.
    assert "Push Day" in call_kwargs["system"]
    assert "exercises" in call_kwargs["system"]
    assert "completed" in call_kwargs["system"]
```
with:
```python
    call_kwargs = mock_client.models.generate_content.call_args.kwargs
    system_instruction = call_kwargs["config"].system_instruction
    assert "workout" in system_instruction.lower()
    # scope_note is only generated when scope_field is active; assert on its unique text
    assert "entries with date between" in system_instruction
    # extra_instructions steers the AI toward concrete exercises for a split,
    # not vague advice — assert it actually reaches the system prompt.
    assert "Push Day" in system_instruction
    assert "exercises" in system_instruction
    assert "completed" in system_instruction
```

In `test_reminders_ai_edit_endpoint_exists_and_is_unscoped`, replace:
```python
    # Unscoped: no date_from/date_to language expected in the system prompt
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    assert "between" not in call_kwargs["system"]
```
with:
```python
    # Unscoped: no date_from/date_to language expected in the system prompt
    call_kwargs = mock_client.models.generate_content.call_args.kwargs
    assert "between" not in call_kwargs["config"].system_instruction
```

In `test_calendar_ai_edit_endpoint_exists_and_is_scoped`, replace:
```python
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    assert "calendar event" in call_kwargs["system"].lower()
    assert "entries with start between" in call_kwargs["system"]
```
with:
```python
    call_kwargs = mock_client.models.generate_content.call_args.kwargs
    system_instruction = call_kwargs["config"].system_instruction
    assert "calendar event" in system_instruction.lower()
    assert "entries with start between" in system_instruction
```

In `test_calendar_ai_edit_includes_events_late_on_the_last_scoped_day`, replace:
```python
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    current_json = json.loads(
        call_kwargs["messages"][0]["content"]
        .split("Current data: ", 1)[1]
        .split("\n\nUser request:", 1)[0]
    )
```
with:
```python
    call_kwargs = mock_client.models.generate_content.call_args.kwargs
    current_json = json.loads(
        call_kwargs["contents"]
        .split("Current data: ", 1)[1]
        .split("\n\nUser request:", 1)[0]
    )
```

In `test_filament_ai_edit_endpoint_exists_and_is_unscoped`, replace:
```python
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    assert "filament spool" in call_kwargs["system"].lower()
    assert "between" not in call_kwargs["system"]
```
with:
```python
    call_kwargs = mock_client.models.generate_content.call_args.kwargs
    system_instruction = call_kwargs["config"].system_instruction
    assert "filament spool" in system_instruction.lower()
    assert "between" not in system_instruction
```

- [ ] **Step 4: Run the test file**

Run: `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest tests/test_ai_edit_routers.py -v`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add life-dashboard/backend/tests/test_ai_edit_routers.py
git commit -m "test: rebuild resource-router ai-edit mocks around Gemini response shape"
```

---

### Task 5: `backend/routers/voice.py` swap + `tests/test_voice_command.py`

**Files:**
- Modify: `life-dashboard/backend/routers/voice.py`
- Modify: `life-dashboard/backend/tests/test_voice_command.py`

**Interfaces:**
- Consumes: `AI_MODEL_ID`, `RESOURCE_REGISTRY`, `AiEditConfig`, `_ask_ai`, `_finish_reason`, `_reconcile`, `_scoped_existing`, `get_ai_client` from Task 2's `ai.py`.

- [ ] **Step 1: Update imports**

Replace:
```python
import logging
from typing import Any, Dict, List, Optional

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError, create_model
from sqlmodel import Session

from backend.database import get_session
from backend.routers.ai import (
    AI_MODEL_ID,
    RESOURCE_REGISTRY,
    AiEditConfig,
    _ask_claude,
    _reconcile,
    _scoped_existing,
    get_anthropic_client,
)
```
with:
```python
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from pydantic import BaseModel, create_model
from sqlmodel import Session

from backend.database import get_session
from backend.routers.ai import (
    AI_MODEL_ID,
    RESOURCE_REGISTRY,
    AiEditConfig,
    _ask_ai,
    _finish_reason,
    _reconcile,
    _scoped_existing,
    get_ai_client,
)
```

- [ ] **Step 2: Rewrite `_classify_resource`**

Replace:
```python
def _classify_resource(client: anthropic.Anthropic, message: str) -> Optional[str]:
    """Ask Claude which RESOURCE_REGISTRY key the message is about.

    Never raises — API errors, refusals, "doesn't match any resource", and a
    hallucinated key that isn't in the registry are all indistinguishable to
    the caller, which reports the same "not sure what you meant" speech for
    all of them.
    """
    options = "\n".join(
        f"- {key}: {config.resource_label}" for key, config in RESOURCE_REGISTRY.items()
    )
    system_prompt = (
        "You route spoken requests for a personal life dashboard to the resource "
        "they're about. Given the user's request, reply with the single "
        "best-matching resource key from this list, or null if none confidently "
        "fit:\n" + options
    )
    try:
        response = client.messages.parse(
            model=AI_MODEL_ID,
            max_tokens=64,
            system=system_prompt,
            messages=[{"role": "user", "content": message}],
            output_format=_ClassifyResult,
        )
    except (anthropic.APIError, ValidationError):
        return None

    if getattr(response, "stop_reason", None) == "refusal":
        return None

    parsed_output = getattr(response, "parsed_output", None)
    if parsed_output is None:
        return None

    resource_key = parsed_output.resource_key
    return resource_key if resource_key in RESOURCE_REGISTRY else None
```
with:
```python
def _classify_resource(client: genai.Client, message: str) -> Optional[str]:
    """Ask Gemini which RESOURCE_REGISTRY key the message is about.

    Never raises — API errors, refusals, "doesn't match any resource", and a
    hallucinated key that isn't in the registry are all indistinguishable to
    the caller, which reports the same "not sure what you meant" speech for
    all of them.
    """
    options = "\n".join(
        f"- {key}: {config.resource_label}" for key, config in RESOURCE_REGISTRY.items()
    )
    system_prompt = (
        "You route spoken requests for a personal life dashboard to the resource "
        "they're about. Given the user's request, reply with the single "
        "best-matching resource key from this list, or null if none confidently "
        "fit:\n" + options
    )
    try:
        response = client.models.generate_content(
            model=AI_MODEL_ID,
            contents=message,
            config=genai_types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=64,
                response_mime_type="application/json",
                response_schema=_ClassifyResult,
            ),
        )
    except genai_errors.APIError:
        return None

    if _finish_reason(response) == "SAFETY":
        return None

    parsed = getattr(response, "parsed", None)
    if parsed is None:
        return None

    resource_key = parsed.resource_key
    return resource_key if resource_key in RESOURCE_REGISTRY else None
```

- [ ] **Step 3: Update `voice_command`'s dependency and `_ask_claude` call**

Replace:
```python
def voice_command(
    body: VoiceCommandRequest,
    session: Session = Depends(get_session),
    client: anthropic.Anthropic = Depends(get_anthropic_client),
):
    resource_key = _classify_resource(client, body.message)
```
with:
```python
def voice_command(
    body: VoiceCommandRequest,
    session: Session = Depends(get_session),
    client: genai.Client = Depends(get_ai_client),
):
    resource_key = _classify_resource(client, body.message)
```

Replace:
```python
        returned_items = _ask_claude(client, config, body.message, existing, scope_note)
```
with:
```python
        returned_items = _ask_ai(client, config, body.message, existing, scope_note)
```

`_describe_change` and everything else in the file is untouched.

- [ ] **Step 4: Run a quick import check**

Run: `cd life-dashboard/backend && .venv/Scripts/python.exe -c "import backend.routers.voice"`
Expected: exits 0.

- [ ] **Step 5: Rewrite `tests/test_voice_command.py`**

Replace:
```python
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

import anthropic

from backend.routers.ai import get_anthropic_client
from backend.main import app


def _classify_response(resource_key):
    return SimpleNamespace(
        parsed_output=SimpleNamespace(resource_key=resource_key), stop_reason="end_turn"
    )


def _edit_response(items):
    return SimpleNamespace(parsed_output=SimpleNamespace(items=items), stop_reason="end_turn")
```
with:
```python
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

from google.genai import errors as genai_errors

from backend.routers.ai import get_ai_client
from backend.main import app


def _classify_response(resource_key):
    return SimpleNamespace(
        parsed=SimpleNamespace(resource_key=resource_key),
        candidates=[SimpleNamespace(finish_reason="STOP")],
    )


def _edit_response(items):
    return SimpleNamespace(
        parsed=SimpleNamespace(items=items),
        candidates=[SimpleNamespace(finish_reason="STOP")],
    )
```

Apply this mechanical rename across the whole file (covers all 6 tests):

| Old | New |
|---|---|
| `app.dependency_overrides[get_anthropic_client]` | `app.dependency_overrides[get_ai_client]` |
| `app.dependency_overrides.pop(get_anthropic_client, None)` | `app.dependency_overrides.pop(get_ai_client, None)` |
| `mock_client.messages.parse.side_effect` | `mock_client.models.generate_content.side_effect` |

Then, in `test_voice_command_speaks_apology_when_edit_step_fails`, replace:
```python
    mock_client.messages.parse.side_effect = [
        _classify_response("filament"),
        anthropic.APIConnectionError(request=MagicMock()),
    ]
```
with:
```python
    mock_client.models.generate_content.side_effect = [
        _classify_response("filament"),
        genai_errors.APIError(code=503, response_json={"message": "unavailable"}),
    ]
```
(the mechanical rename above already updates the `mock_client.messages.parse.side_effect = [_classify_response(...), _edit_response(...)]` list-assignment lines that appear elsewhere in the file — only this one also constructs the second list element itself and needs its own edit.)

- [ ] **Step 6: Run the test file**

Run: `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest tests/test_voice_command.py -v`
Expected: all 6 tests pass.

- [ ] **Step 7: Commit**

```bash
git add life-dashboard/backend/routers/voice.py life-dashboard/backend/tests/test_voice_command.py
git commit -m "feat: swap voice.py's AI provider from Anthropic to Gemini"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the entire backend test suite**

Run: `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest -v`
Expected: all tests pass, including tests outside the AI subsystem (proving nothing else broke) and the 4 rewritten AI-edit/voice files.

- [ ] **Step 2: Grep for any remaining Anthropic references**

Run: `grep -rn "anthropic\|ANTHROPIC_API_KEY\|claude-opus" life-dashboard/backend --include=*.py`
Expected: no matches outside `.venv/` (the venv's own installed packages, if `pip uninstall` left residue, don't count).

- [ ] **Step 3: Confirm `docker-compose.yml` needs no change**

Run: `grep -n "ANTHROPIC\|GEMINI" life-dashboard/docker-compose.yml`
Expected: no matches — env vars flow through `env_file: .env` generically, per spec §4.3. If this turns up a hardcoded `ANTHROPIC_API_KEY` reference the spec didn't anticipate, stop and amend the plan rather than pushing a silent fix.

- [ ] **Step 4: No commit needed** — this task is verification-only; Task 5's commit already covers all code changes.
