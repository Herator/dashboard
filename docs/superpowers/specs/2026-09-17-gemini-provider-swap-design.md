# Swap AI Provider: Anthropic → Google Gemini (Free Tier) — Design Specification

## 1. Overview

Replaces the life-dashboard's AI provider (Anthropic's Claude, paid per-token) with
Google's Gemini API, specifically a Flash-Lite model on Gemini's free tier, across
the entire AI-edit subsystem (`backend/routers/ai.py`) and the voice-command
endpoint (`backend/routers/voice.py`) built on top of it. Motivation: eliminate
ongoing per-token cost for a personal single-user dashboard. No behavior change
from the user's perspective — the same natural-language edit flow, the same
voice-command classify → edit → confirm flow, the same error-handling contract
(503/502/422/200 status codes) — only the backing model and its cost changes.

## 2. Provider & Model Choice

- **SDK:** `google-genai` (PyPI package `google-genai`, import path `google.genai`).
  Replaces the `anthropic` package in `requirements.txt`.
- **Model:** a Gemini Flash-Lite model, via `AI_MODEL_ID` (same env var name,
  repurposed — default becomes `gemini-flash-lite-latest` instead of
  `claude-opus-5`). Flash-Lite is the only free-tier option with a workable daily
  quota (500 requests/day) for a dashboard used across meal-plan, workouts,
  reminders, calendar, groceries, filament, and voice commands — regular Flash
  models are capped at ~20 free requests/day, which one day of normal use would
  exhaust. This trades some reasoning quality for a quota that actually holds up
  under real use; if that quality tradeoff turns out to be unacceptable in
  practice, the fix is changing `AI_MODEL_ID`, not further code changes.
- **Auth:** `GEMINI_API_KEY` env var (replaces `ANTHROPIC_API_KEY` in
  `.env.example` and `.env`), read explicitly in the `get_ai_client` dependency
  (not relying on the SDK's own auto-detection of a default env var name), so a
  missing key still fails fast with a clear 503 — same behavior as today's
  `get_anthropic_client`.

## 3. Verification Spike (do this first, before touching production code)

Before rewriting `ai.py`/`voice.py`/4 test files, run one throwaway script against
a real Gemini free-tier API key to confirm three things the design depends on,
since they come from documentation/search rather than hands-on verification in
this repo:

1. `client.models.generate_content(model=..., contents=..., config=types.GenerateContentConfig(system_instruction=..., response_mime_type="application/json", response_schema=SomePydanticModel))` returns a response whose `.parsed` attribute is a validated instance of `SomePydanticModel` (the equivalent of Anthropic's `response.parsed_output`).
2. What happens when the model's output doesn't match the schema — does `.parsed` raise `pydantic.ValidationError`, return `None`, or something else? (Determines the exact `except` clause needed, mirroring today's `_ask_ai`'s `ValidationError` catch.)
3. What `response.candidates[0].finish_reason` (or equivalent) looks like for a normal completion (expect `STOP`) versus a safety-blocked one — confirms the refusal-detection check (today's `response.stop_reason == "refusal"` equivalent).

If any of these don't match this design's assumptions, the design gets amended
before implementation — not discovered mid-rewrite across 6 files.

## 4. Code Changes

### 4.1 `backend/routers/ai.py`

- `get_anthropic_client` → `get_ai_client`: same shape (FastAPI dependency,
  raises `HTTPException(503, ...)` if `GEMINI_API_KEY` unset), constructs
  `genai.Client(api_key=...)` instead of `anthropic.Anthropic()`.
- `_ask_claude` → `_ask_ai`: same signature
  (`client, config, message, existing, scope_note`), same return contract
  (the parsed `items` list). Internals swap to the `generate_content` call shape
  from §3, using `config.result_schema` as `response_schema`. The `system_prompt`
  string-building logic (resource label, scope note, extra instructions) is
  unchanged — only where it's passed changes (`system_instruction=` in
  `GenerateContentConfig` instead of Anthropic's `system=`).
- Error mapping stays 1:1 with today's behavior:
  - `google.genai.errors.APIError` → `HTTPException(502, ...)` (was
    `anthropic.APIError`).
  - Schema-validation failure (exact exception confirmed by the spike) →
    `HTTPException(502, ...)` (was `pydantic.ValidationError`).
  - Non-`STOP` finish reason → `HTTPException(422, ...)` (was
    `stop_reason == "refusal"`).
  - `parsed` is `None`/missing → `HTTPException(502, ...)` (unchanged condition,
    same as today's `parsed_output is None` check).
- `AI_MODEL_ID` default changes; `RESOURCE_REGISTRY`, `AiEditConfig`,
  `_scoped_existing`, `_reconcile`, `make_ai_edit_router` are **untouched** —
  none of them reference the Anthropic SDK directly, only `_ask_ai`'s internals
  and the client dependency change.

### 4.2 `backend/routers/voice.py`

- `_classify_resource`: same swap as `_ask_ai` — `generate_content` with
  `_ClassifyResult` as `response_schema`, same error handling (any provider
  error, schema-validation failure, or non-`STOP` finish reason → `None`,
  exactly as today's behavior collapses every failure mode to the same "not
  sure what you meant" outcome).
- Import updates: pulls `get_ai_client` instead of `get_anthropic_client` from
  `ai.py`; `AI_MODEL_ID`, `RESOURCE_REGISTRY`, `_ask_ai`, `_reconcile`,
  `_scoped_existing` references renamed to match §4.1.
- `_describe_change`, `voice_command`'s overall control flow: **untouched** —
  they don't reference the Anthropic SDK.

### 4.3 Configuration

- `requirements.txt`: remove `anthropic`, add `google-genai`.
- `.env.example`: replace `ANTHROPIC_API_KEY` with `GEMINI_API_KEY` (same
  "required for the AI editing layer" comment); `AI_MODEL_ID`'s comment updates
  to reference the new default and Flash-Lite framing from §2.
- No `docker-compose.yml` changes needed — env vars already flow through the
  existing `env_file: .env` mechanism generically.

### 4.4 Tests

All 4 files currently mocking the Anthropic client need their mocks rebuilt
around the Gemini response shape (a `SimpleNamespace`/`MagicMock` with `.parsed`
and finish-reason fields instead of `.parsed_output` and `.stop_reason`), and
their imports/patches updated from `anthropic.APIError`/`get_anthropic_client` to
the Gemini equivalents:
- `tests/test_ai_edit.py`
- `tests/test_ai_edit_preview.py`
- `tests/test_ai_edit_routers.py`
- `tests/test_voice_command.py`

Test *behavior* (what's asserted) does not change — same create/update/delete
scenarios, same error-status-code scenarios, same scope-note assertions (the
scope-note text itself doesn't depend on the provider). Only the mock's shape
and the exception types constructed change. The exact mock shape gets finalized
once the spike (§3) confirms the real response object's attributes.

## 5. Out of scope

- No provider-abstraction layer (§ approach rationale already covered in
  brainstorming — rejected as unused complexity for a single-provider app).
- No dual-provider fallback (e.g. "try Gemini, fall back to Claude on quota
  exhaustion") — not requested, and would reintroduce the cost this change is
  meant to eliminate.
- No change to `AI_MODEL_ID`'s existence/purpose as a knob — same override
  mechanism, just a different default and different valid values.
- No change to any non-AI code path (CRUD routers, calendar feeds, printer,
  weather, grocery sync) — this is scoped entirely to the two files in §4.1-4.2
  plus configuration and tests.
