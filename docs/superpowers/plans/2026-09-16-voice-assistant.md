# Voice Assistant (Siri Shortcut) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user speak a request to Siri on their iPhone and have it applied to the life-dashboard (calendar, meal plan, workouts, reminders, groceries, or filament), with a spoken confirmation back.

**Architecture:** A new `POST /api/voice-command` endpoint does classify → edit → confirm: a small Claude call picks which resource the message is about, the existing AI-edit reconciliation logic (refactored from per-resource closures into resource-generic module-level functions) applies the change, and a deterministic sentence-builder composes the spoken confirmation. Three resources (calendar, groceries, filament) get AI-edit routers added along the way, since only meal-plan/workouts/reminders have them today.

**Tech Stack:** FastAPI, SQLModel, `anthropic` Python SDK (already in use — no new dependencies), pytest with the existing `client`/`session` fixtures in `backend/tests/conftest.py`.

**Spec:** `docs/superpowers/specs/2026-09-16-voice-assistant-design.md`

## Global Constraints

- No frontend changes — this bypasses the browser entirely (per spec §2, §7).
- The three existing AI-edit resources' HTTP contract (`/api/meal-plan/ai-edit*`, `/api/workouts/ai-edit*`, `/api/reminders/ai-edit*`) must not change — same request/response shapes, same behavior. Task 1 is a pure refactor verified by the existing test suite staying green.
- Backend tests run from `life-dashboard/backend/` via `.venv/Scripts/python.exe -m pytest -q` (the project's existing venv).
- No new pip dependencies — everything needed (`anthropic`, `pydantic`, `dataclasses` from stdlib) is already installed.
- Voice-command classification/edit calls carry no `date_from`/`date_to` — date-scoped resources always use the current-week default (spec §4.3's noted limitation: voice can't create/change entries outside the current week for date-scoped resources).
- `/api/voice-command` always returns HTTP 200 with a `speech` field for recognized failure modes (unclear request, AI/API error) — only a genuinely unexpected exception should surface as a 500 (spec §5).
- **Working directory:** all commands and commits in this plan run from this worktree's repo root (`C:\Users\herma\Documents\Home-server\.claude\worktrees\voice-assistant`) — never `cd` to `C:\Users\herma\Documents\Home-server` (the original checkout/main branch); that directory is off-limits to this plan's execution.

---

## File Structure

- Modify: `life-dashboard/backend/routers/ai.py` — extract `AiEditConfig` dataclass, module-level `_scoped_existing`/`_ask_claude`/`_reconcile`, and `RESOURCE_REGISTRY`; `make_ai_edit_router` becomes a thin wrapper reading from the registry.
- Modify: `life-dashboard/backend/main.py` — update the 3 existing `make_ai_edit_router` call sites to the new signature, add 3 new ones, register the new voice router.
- Create: `life-dashboard/backend/routers/voice.py` — `POST /api/voice-command` (classify → edit → confirm).
- Modify: `life-dashboard/backend/tests/test_ai_edit_routers.py` — add tests for the 3 new resource routers.
- Create: `life-dashboard/backend/tests/test_voice_command.py` — tests for the new endpoint and its helpers.

---

### Task 1: Refactor `ai.py` into a resource-driven registry (no new behavior)

**Files:**
- Modify: `life-dashboard/backend/routers/ai.py` (full rewrite of its internals — see below)
- Modify: `life-dashboard/backend/main.py:8, 58-60, 63-94, 98-100`

**Interfaces:**
- Produces: `AiEditConfig` (dataclass: `model`, `resource_label`, `scope_field`, `extra_instructions`, `primary_field`, plus computed `item_schema`/`result_schema`), `RESOURCE_REGISTRY: Dict[str, AiEditConfig]` (keys: `"meal-plan"`, `"workouts"`, `"reminders"`), module-level `_scoped_existing(config, date_from, date_to, session)`, `_ask_claude(client, config, message, existing, scope_note)`, `_reconcile(config, session, existing, returned_items, commit, message=None)`, and `make_ai_edit_router(resource_key: str, prefix: str, tag: str) -> APIRouter` (new signature — no longer takes `model`/`resource_label`/`scope_field`/`extra_instructions` directly).
- Consumes: nothing new — same `backend.crud.build_input_model`, `backend.database.get_session`, `backend.grocery_sync`, `backend.models` imports as before.

- [ ] **Step 1: Run the existing test suite to record the baseline**

Run (from the worktree repo root): `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest -q`
Expected: `90 passed, 8 failed` (the 8 failures are pre-existing cross-test state leakage in `test_ai_edit*.py`/`test_ai_edit_routers.py`, unrelated to this change — confirmed via `git stash` before this plan was written). Note the exact passed/failed test names if they differ from this — that's your baseline to match after Step 3.

- [ ] **Step 2: Rewrite `life-dashboard/backend/routers/ai.py`**

Replace the entire file with:

```python
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Type

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError, create_model
from sqlmodel import Session, SQLModel, select

from backend.crud import build_input_model
from backend.database import get_session
from backend.grocery_sync import get_week_start, sync_meal_plan_to_groceries
from backend.models import MealPlanItem, Reminder, Workout

logger = logging.getLogger(__name__)

# `or` rather than a `.get` default: an env var set to the empty string (which
# is what copying .env.example verbatim used to produce) is still "set", so a
# plain default would leave the model id as "" and send that to the API.
AI_MODEL_ID = os.environ.get("AI_MODEL_ID") or "claude-opus-5"

WORKOUT_EXTRA_INSTRUCTIONS = (
    "When asked for a workout for a given training split (e.g. Push Day, "
    "Pull Day, Leg Day, Chest Day, Back Day, Shoulder Day, Arm Day, Full "
    "Body, Cardio), populate `exercises` as a concrete, ordered list "
    "appropriate to that split — not vague advice. Each exercise needs "
    "`name`, `sets` (an integer), `reps` (a short string like '8' or "
    "'8-10' or 'AMRAP'), `muscle` (the primary muscle group it targets, "
    "e.g. 'Chest'), and `cue` (a short one-sentence form tip). Leave "
    "`weight` and `actual_reps` as empty lists, and set `completed` to a "
    "list of `sets` `false` values (the user checks these off during "
    "the workout — never mark any as already done). Default to 5-6 "
    "compound-first exercises in a sensible order (compounds before "
    "isolation) unless asked for more or fewer. Also set `plan_text` to "
    "a short one-line summary (e.g. 'Push Day: Chest, Shoulders, "
    "Triceps') — it's shown in the log list, so keep it brief rather "
    "than listing exercises there too. When the request states or "
    "implies a goal (strength/hypertrophy/endurance/cardio), duration "
    "in minutes, experience level, available equipment, or target "
    "muscle groups, set the matching `goal`, `duration_min`, `level`, "
    "`equipment` (list of strings) and `muscles` (list of strings) "
    "fields — leave any you can't infer as null/empty. Set `generated` "
    "to true for any workout you create or substantially rewrite here."
)


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


def _current_week_bounds() -> tuple[date, date]:
    today = date.today()
    start = today - timedelta(days=today.weekday())
    return start, start + timedelta(days=6)


@dataclass
class AiEditConfig:
    """Everything the AI-edit machinery needs to know about one resource.

    ``item_schema``/``result_schema`` are built once here (not per-request)
    since they're pure functions of ``model`` — matches the original
    closure-based routers, which built them once at router-construction
    time and reused them for every request that router handled.
    """

    model: Type[SQLModel]
    resource_label: str
    scope_field: Optional[str] = None
    extra_instructions: str = ""
    primary_field: str = "name"
    item_schema: Type[BaseModel] = field(init=False)
    result_schema: Type[BaseModel] = field(init=False)

    def __post_init__(self) -> None:
        self.item_schema = build_input_model(
            self.model, "AiItem", partial=False, include_id=True
        )
        self.result_schema = create_model(
            f"{self.model.__name__}AiEditResult", items=(List[self.item_schema], ...)
        )


RESOURCE_REGISTRY: Dict[str, AiEditConfig] = {
    "meal-plan": AiEditConfig(
        MealPlanItem, "meal plan", scope_field="date", primary_field="name"
    ),
    "workouts": AiEditConfig(
        Workout,
        "workout plan",
        scope_field="date",
        extra_instructions=WORKOUT_EXTRA_INSTRUCTIONS,
        primary_field="plan_text",
    ),
    "reminders": AiEditConfig(Reminder, "reminders", primary_field="text"),
}


def _scoped_existing(
    config: AiEditConfig,
    date_from: Optional[date],
    date_to: Optional[date],
    session: Session,
):
    """Query the rows this request may see/affect, plus the prompt text
    describing that scope (empty string when the resource is unscoped)."""
    query = select(config.model)
    scope_note = ""
    if config.scope_field:
        default_start, default_end = _current_week_bounds()
        resolved_from = date_from or default_start
        resolved_to = date_to or default_end
        column = getattr(config.model, config.scope_field)
        query = query.where(column >= resolved_from, column <= resolved_to)
        scope_note = (
            f" You are only shown, and may only affect, entries with "
            f"{config.scope_field} between {resolved_from.isoformat()} and "
            f"{resolved_to.isoformat()} inclusive."
        )
    return session.exec(query).all(), scope_note


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

    parsed_output = getattr(response, "parsed_output", None)
    if parsed_output is None:
        raise HTTPException(
            status_code=502, detail="AI returned no usable response."
        )

    return parsed_output.items


def _reconcile(
    config: AiEditConfig,
    session: Session,
    existing,
    returned_items,
    commit: bool,
    message: Optional[str] = None,
):
    """Shared create/update/delete reconciliation.

    ``commit=False`` (preview) computes exactly the same result but never
    persists it: creates are never added to the session, deletes are
    never issued, and updates mutate already-tracked ORM objects only in
    memory before the session is rolled back. The before/after/created/
    deleted values returned are plain dict snapshots taken before that
    rollback, so they are unaffected by it.
    """
    existing_by_id = {item.id: item for item in existing}
    existing_ids = set(existing_by_id)
    returned_ids = {
        item.id
        for item in returned_items
        if item.id is not None and item.id in existing_ids
    }
    stale_ids = existing_ids - returned_ids

    if stale_ids:
        if message is not None:
            logger.warning(
                "AI-edit deleting %d row(s) from %s: ids=%s (user message: %r)",
                len(stale_ids),
                config.resource_label,
                sorted(stale_ids),
                message,
            )
        else:
            logger.warning(
                "AI-edit %s %d row(s) from %s: ids=%s",
                "deleting" if commit else "would delete",
                len(stale_ids),
                config.resource_label,
                sorted(stale_ids),
            )

    deleted = [existing_by_id[i].model_dump(mode="json") for i in stale_ids]
    if commit:
        for stale_id in stale_ids:
            session.delete(existing_by_id[stale_id])

    created: List[Dict[str, Any]] = []
    updated: List[Dict[str, Any]] = []
    result_rows = []

    for item in returned_items:
        data = item.model_dump(exclude={"id"}, exclude_unset=True)
        if item.id is not None and item.id in existing_ids:
            row = existing_by_id[item.id]
            before = row.model_dump(mode="json")
            for key, value in data.items():
                setattr(row, key, value)
            after = row.model_dump(mode="json")
            if before != after:
                updated.append({"before": before, "after": after})
            result_rows.append(row)
        else:
            row = config.model(**data)
            if commit:
                session.add(row)
            created.append(row.model_dump(mode="json"))
            result_rows.append(row)

    if commit:
        session.commit()
        for row in result_rows:
            session.refresh(row)
    else:
        session.rollback()

    return created, updated, deleted, result_rows


def make_ai_edit_router(resource_key: str, prefix: str, tag: str) -> APIRouter:
    """Build the three HTTP AI-edit routes for one `RESOURCE_REGISTRY` entry."""
    config = RESOURCE_REGISTRY[resource_key]
    router = APIRouter(prefix=prefix, tags=[tag])
    ItemSchema = config.item_schema

    class AiEditRequest(BaseModel):
        message: str
        date_from: Optional[date] = None
        date_to: Optional[date] = None

    class ApplyRequest(BaseModel):
        items: List[ItemSchema]
        date_from: Optional[date] = None
        date_to: Optional[date] = None

    class AiEditPreviewResponse(BaseModel):
        created: List[Dict[str, Any]]
        updated: List[Dict[str, Any]]
        deleted: List[Dict[str, Any]]
        items: List[Dict[str, Any]]

    @router.post("/ai-edit", response_model=List[config.model])
    def ai_edit(
        body: AiEditRequest,
        session: Session = Depends(get_session),
        client: anthropic.Anthropic = Depends(get_anthropic_client),
    ):
        existing, scope_note = _scoped_existing(config, body.date_from, body.date_to, session)
        returned_items = _ask_claude(client, config, body.message, existing, scope_note)
        _, _, _, result_rows = _reconcile(
            config, session, existing, returned_items, commit=True, message=body.message
        )
        return result_rows

    @router.post("/ai-edit/preview", response_model=AiEditPreviewResponse)
    def ai_edit_preview(
        body: AiEditRequest,
        session: Session = Depends(get_session),
        client: anthropic.Anthropic = Depends(get_anthropic_client),
    ):
        existing, scope_note = _scoped_existing(config, body.date_from, body.date_to, session)
        returned_items = _ask_claude(client, config, body.message, existing, scope_note)
        created, updated, deleted, _ = _reconcile(config, session, existing, returned_items, commit=False)
        items = [
            item.model_dump(mode="json", exclude_unset=True) for item in returned_items
        ]
        return AiEditPreviewResponse(
            created=created, updated=updated, deleted=deleted, items=items
        )

    @router.post("/ai-edit/apply", response_model=List[config.model])
    def ai_edit_apply(
        body: ApplyRequest,
        session: Session = Depends(get_session),
    ):
        existing, _ = _scoped_existing(config, body.date_from, body.date_to, session)
        _, _, _, result_rows = _reconcile(config, session, existing, body.items, commit=True)
        if config.model is MealPlanItem:
            weeks = {get_week_start(row.date) for row in result_rows}
            for week in weeks:
                try:
                    sync_meal_plan_to_groceries(session, week)
                except Exception:
                    logger.exception(
                        "grocery sync failed for week %s after meal-plan apply; continuing",
                        week,
                    )
            for row in result_rows:
                session.refresh(row)
        return result_rows

    return router
```

- [ ] **Step 3: Update `life-dashboard/backend/main.py`'s 3 existing call sites**

Change lines 8, 58-60, and 63-94:

```python
from backend.routers.ai import make_ai_edit_router
```
stays the same (import path unchanged — only the function's own signature changed).

Replace:
```python
app.include_router(
    make_ai_edit_router(MealPlanItem, "/api/meal-plan", "meal-plan-ai", "meal plan", scope_field="date")
)
```
with:
```python
app.include_router(make_ai_edit_router("meal-plan", "/api/meal-plan", "meal-plan-ai"))
```

Replace the whole `Workout` `make_ai_edit_router(...)` call (with its long `extra_instructions=` string) with:
```python
app.include_router(make_ai_edit_router("workouts", "/api/workouts", "workouts-ai"))
```

Replace:
```python
app.include_router(
    make_ai_edit_router(Reminder, "/api/reminders", "reminders-ai", "reminders")
)
```
with:
```python
app.include_router(make_ai_edit_router("reminders", "/api/reminders", "reminders-ai"))
```

`MealPlanItem`, `Workout`, `Reminder` are still imported in `main.py` for their `make_crud_router(...)` calls — leave those imports as-is.

- [ ] **Step 4: Run the test suite again and diff against the Step 1 baseline**

Run (from the worktree repo root): `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest -q`
Expected: identical pass/fail counts and identical failing test names to Step 1's baseline. If anything new fails, the refactor introduced a behavior change — find and fix it before proceeding (do not proceed with a new failure).

- [ ] **Step 5: Commit**

Run from the worktree repo root (do NOT `cd` anywhere else — see Global Constraints):
```bash
git add life-dashboard/backend/routers/ai.py life-dashboard/backend/main.py
git commit -m "refactor: extract ai-edit logic into a resource-driven registry"
```

---

### Task 2: Add AI-edit routers for calendar, groceries, and filament

**Files:**
- Modify: `life-dashboard/backend/routers/ai.py` (imports + `RESOURCE_REGISTRY`)
- Modify: `life-dashboard/backend/main.py` (3 new `make_ai_edit_router` calls)
- Test: `life-dashboard/backend/tests/test_ai_edit_routers.py` (append new tests)

**Interfaces:**
- Consumes: `AiEditConfig`, `RESOURCE_REGISTRY`, `make_ai_edit_router` from Task 1 (signature: `make_ai_edit_router(resource_key: str, prefix: str, tag: str) -> APIRouter`).
- Produces: `RESOURCE_REGISTRY` gains keys `"calendar"` (model `Event`, scoped by `start`), `"groceries"` (model `GroceryItem`, scoped by `week_of`), `"filament"` (model `FilamentSpool`, unscoped).

- [ ] **Step 1: Write the failing tests**

Append to `life-dashboard/backend/tests/test_ai_edit_routers.py`:

```python
def test_calendar_ai_edit_endpoint_exists_and_is_scoped(client, session):
    mock_client = make_mock_client([])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/events/ai-edit", json={"message": "add a tee time Saturday at 9am"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    assert "calendar event" in call_kwargs["system"].lower()
    assert "entries with start between" in call_kwargs["system"]


def test_filament_ai_edit_endpoint_exists_and_is_unscoped(client, session):
    mock_client = make_mock_client([])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/filament/ai-edit", json={"message": "I bought a new spool of black PLA"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    assert "filament spool" in call_kwargs["system"].lower()
    assert "between" not in call_kwargs["system"]


def test_groceries_ai_edit_creates_a_new_item(client, session):
    new_item = SimpleNamespace(
        id=None,
        model_dump=lambda **kwargs: {
            "name": "Milk",
            "quantity": "1 gallon",
            "checked": False,
            "week_of": date(2026, 9, 14),
        },
    )
    mock_client = make_mock_client([new_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/groceries/ai-edit", json={"message": "add a gallon of milk"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "Milk"
    assert body[0]["checked"] is False
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run (from the worktree repo root): `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest -q tests/test_ai_edit_routers.py -k "calendar_ai_edit or filament_ai_edit or groceries_ai_edit"`
Expected: FAIL — `404 Not Found` (routes don't exist yet) or `KeyError: 'calendar'` (registry key doesn't exist yet).

- [ ] **Step 3: Add the 3 resources to `RESOURCE_REGISTRY`**

In `life-dashboard/backend/routers/ai.py`, change the import line:

```python
from backend.models import Event, FilamentSpool, GroceryItem, MealPlanItem, Reminder, Workout
```

and extend `RESOURCE_REGISTRY`:

```python
RESOURCE_REGISTRY: Dict[str, AiEditConfig] = {
    "meal-plan": AiEditConfig(
        MealPlanItem, "meal plan", scope_field="date", primary_field="name"
    ),
    "workouts": AiEditConfig(
        Workout,
        "workout plan",
        scope_field="date",
        extra_instructions=WORKOUT_EXTRA_INSTRUCTIONS,
        primary_field="plan_text",
    ),
    "reminders": AiEditConfig(Reminder, "reminders", primary_field="text"),
    "calendar": AiEditConfig(
        Event, "calendar event", scope_field="start", primary_field="title"
    ),
    "groceries": AiEditConfig(
        GroceryItem, "grocery list", scope_field="week_of", primary_field="name"
    ),
    "filament": AiEditConfig(FilamentSpool, "filament spool", primary_field="color_name"),
}
```

- [ ] **Step 4: Wire the 3 new routers in `main.py`**

Add after the existing `app.include_router(make_ai_edit_router("reminders", "/api/reminders", "reminders-ai"))` line:

```python
app.include_router(make_ai_edit_router("calendar", "/api/events", "events-ai"))
app.include_router(make_ai_edit_router("groceries", "/api/groceries", "groceries-ai"))
app.include_router(make_ai_edit_router("filament", "/api/filament", "filament-ai"))
```

- [ ] **Step 5: Run the new tests again to verify they pass**

Run (from the worktree repo root): `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest -q tests/test_ai_edit_routers.py`
Expected: all tests in this file PASS (the 3 new ones plus the pre-existing ones).

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run (from the worktree repo root): `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest -q`
Expected: same baseline as Task 1 Step 4, plus the 3 new tests passing (93 passed, 8 pre-existing failures).

- [ ] **Step 7: Commit**

Run from the worktree repo root (do NOT `cd` anywhere else — see Global Constraints):
```bash
git add life-dashboard/backend/routers/ai.py life-dashboard/backend/main.py life-dashboard/backend/tests/test_ai_edit_routers.py
git commit -m "feat: add AI-edit routers for calendar, groceries, and filament"
```

---

### Task 3: `POST /api/voice-command` — classify, edit, confirm

**Files:**
- Create: `life-dashboard/backend/routers/voice.py`
- Modify: `life-dashboard/backend/main.py` (register the router)
- Test: `life-dashboard/backend/tests/test_voice_command.py`

**Interfaces:**
- Consumes: `RESOURCE_REGISTRY`, `AI_MODEL_ID`, `get_anthropic_client`, `_scoped_existing`, `_ask_claude`, `_reconcile` from `backend.routers.ai` (Tasks 1-2).
- Produces: `POST /api/voice-command` — request `{"message": str}`, response `{"speech": str}`, always HTTP 200 except for a genuinely unexpected server error.

- [ ] **Step 1: Write the failing tests**

Create `life-dashboard/backend/tests/test_voice_command.py`:

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


def test_voice_command_routes_to_groceries_and_creates_item(client, session):
    new_item = SimpleNamespace(
        id=None,
        model_dump=lambda **kwargs: {
            "name": "Milk",
            "quantity": None,
            "checked": False,
            "week_of": date(2026, 9, 14),
        },
    )
    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = [
        _classify_response("groceries"),
        _edit_response([new_item]),
    ]
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/voice-command", json={"message": "add milk to the grocery list"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json() == {"speech": "Added Milk to grocery list."}

    list_resp = client.get("/api/groceries/")
    assert len(list_resp.json()) == 1
    assert list_resp.json()[0]["name"] == "Milk"


def test_voice_command_speaks_apology_when_classification_is_unclear(client, session):
    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = [_classify_response(None)]
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/voice-command", json={"message": "what's the weather like"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json() == {"speech": "I'm not sure what you meant — try rephrasing."}
    assert mock_client.messages.parse.call_count == 1  # never attempted an edit


def test_voice_command_speaks_apology_when_classification_key_is_unknown(client, session):
    """The classifier returning a string that isn't a real registry key
    (a hallucinated or stale key) must be treated the same as `None`."""
    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = [_classify_response("not-a-real-resource")]
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/voice-command", json={"message": "do something"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json() == {"speech": "I'm not sure what you meant — try rephrasing."}


def test_voice_command_speaks_apology_when_edit_step_fails(client, session):
    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = [
        _classify_response("filament"),
        anthropic.APIConnectionError(request=MagicMock()),
    ]
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/voice-command", json={"message": "I bought black PLA"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json() == {"speech": "Something went wrong updating that — try again in a bit."}


def test_voice_command_reports_updates_and_deletions(client, session):
    from backend.models import Reminder
    from datetime import datetime

    existing = Reminder(text="Old reminder", trigger_time=datetime(2026, 9, 10, 18, 0))
    session.add(existing)
    session.commit()
    session.refresh(existing)

    updated_item = SimpleNamespace(
        id=existing.id,
        model_dump=lambda exclude=None, exclude_unset=False, **kwargs: (
            {"text": "Updated reminder"}
            if exclude_unset
            else {"id": existing.id, "text": "Updated reminder", "trigger_time": datetime(2026, 9, 10, 18, 0), "sent": False}
        ),
    )
    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = [
        _classify_response("reminders"),
        _edit_response([updated_item]),
    ]
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/voice-command", json={"message": "change my reminder text"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json() == {"speech": "Updated 1 item in reminders."}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from the worktree repo root): `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest -q tests/test_voice_command.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.routers.voice'` (or a 404, once the module exists but isn't registered).

- [ ] **Step 3: Create `life-dashboard/backend/routers/voice.py`**

```python
import logging
from typing import Any, Dict, List, Optional

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
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

logger = logging.getLogger(__name__)

router = APIRouter(tags=["voice"])

_ClassifyResult = create_model("ClassifyResult", resource_key=(Optional[str], None))


class VoiceCommandRequest(BaseModel):
    message: str


class VoiceCommandResponse(BaseModel):
    speech: str


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
    except anthropic.APIError:
        return None

    if getattr(response, "stop_reason", None) == "refusal":
        return None

    parsed_output = getattr(response, "parsed_output", None)
    if parsed_output is None:
        return None

    resource_key = parsed_output.resource_key
    return resource_key if resource_key in RESOURCE_REGISTRY else None


def _describe_change(
    config: AiEditConfig,
    created: List[Dict[str, Any]],
    updated: List[Dict[str, Any]],
    deleted: List[Dict[str, Any]],
) -> str:
    """Build a short spoken confirmation from what `_reconcile` changed."""
    parts = []
    if created:
        names = ", ".join(str(item.get(config.primary_field, "an item")) for item in created)
        parts.append(f"Added {names} to {config.resource_label}.")
    if updated:
        count = len(updated)
        parts.append(f"Updated {count} item{'s' if count != 1 else ''} in {config.resource_label}.")
    if deleted:
        names = ", ".join(str(item.get(config.primary_field, "an item")) for item in deleted)
        parts.append(f"Removed {names} from {config.resource_label}.")
    if not parts:
        return f"No changes made to {config.resource_label}."
    return " ".join(parts)


@router.post("/api/voice-command", response_model=VoiceCommandResponse)
def voice_command(
    body: VoiceCommandRequest,
    session: Session = Depends(get_session),
    client: anthropic.Anthropic = Depends(get_anthropic_client),
):
    resource_key = _classify_resource(client, body.message)
    if resource_key is None:
        return VoiceCommandResponse(speech="I'm not sure what you meant — try rephrasing.")

    config = RESOURCE_REGISTRY[resource_key]
    existing, scope_note = _scoped_existing(config, None, None, session)
    try:
        returned_items = _ask_claude(client, config, body.message, existing, scope_note)
    except HTTPException:
        return VoiceCommandResponse(
            speech="Something went wrong updating that — try again in a bit."
        )

    created, updated, deleted, _ = _reconcile(
        config, session, existing, returned_items, commit=True, message=body.message
    )
    return VoiceCommandResponse(speech=_describe_change(config, created, updated, deleted))
```

- [ ] **Step 4: Register the router in `main.py`**

Add the import near the other router imports:

```python
from backend.routers import voice
```

Add the registration next to the other `app.include_router(...)` calls (after the `printer` one):

```python
app.include_router(voice.router)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from the worktree repo root): `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest -q tests/test_voice_command.py`
Expected: all 5 tests PASS.

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run (from the worktree repo root): `cd life-dashboard/backend && .venv/Scripts/python.exe -m pytest -q`
Expected: Task 2's passed count + 5, same 8 pre-existing failures (98 passed, 8 failed).

- [ ] **Step 7: Commit**

Run from the worktree repo root (do NOT `cd` anywhere else — see Global Constraints):
```bash
git add life-dashboard/backend/routers/voice.py life-dashboard/backend/main.py life-dashboard/backend/tests/test_voice_command.py
git commit -m "feat: add POST /api/voice-command for Siri Shortcut voice edits"
```

---

### Task 4: Cloudflare Access + iOS Shortcut setup (manual — not for the coding agent)

**This task has no code.** It's infrastructure/device configuration only the
user can do (Cloudflare account access, their own iPhone). If you're an
agent executing this plan, stop here and hand this checklist back to the
user rather than attempting to automate it.

- [ ] **Step 1: Create a Cloudflare Access Service Token**

In the Cloudflare Zero Trust dashboard: **Access → Service Auth → Service
Tokens** → create a token (e.g. named `voice-shortcut`). Cloudflare shows a
**Client ID** and **Client Secret** exactly once on creation — save both
somewhere safe (a password manager), they can't be viewed again.

- [ ] **Step 2: Add a scoped bypass policy**

**Access → Applications** → open the life-dashboard Access application →
add a new policy (above/alongside the existing login-required one):
- Action: **Service Auth**
- Include rule: the Service Token from Step 1
- Scope this policy to the `/api/voice-command` path only (not the whole
  app) — check the application's path-matching options; if the app is
  defined as a single hostname with no path rules yet, this may require
  splitting `/api/voice-command` into its own Access application sharing
  the same hostname, or using a path-based policy rule if the plan
  supports it. The existing login-required policy must remain covering
  everything else — verify by trying to load the dashboard in a normal
  browser afterward and confirming it still asks you to log in.

- [ ] **Step 3: Create the iOS Shortcut**

In the Shortcuts app on the iPhone, new Shortcut:
1. **Dictate Text** action.
2. **Get Contents of URL**:
   - URL: `https://<your-dashboard-hostname>/api/voice-command`
   - Method: `POST`
   - Headers: `CF-Access-Client-Id` = (Client ID from Step 1),
     `CF-Access-Client-Secret` = (Client Secret from Step 1),
     `Content-Type` = `application/json`
   - Request Body: JSON, one field `message` = the Dictate Text result.
3. **Get Dictionary Value** from the response, key `speech`.
4. **Speak Text** with that value.
5. Add an **If** branch on the "Get Contents of URL" step's failure (or on
   the dictionary lookup failing) → **Speak Text**: "Couldn't reach the
   dashboard."

- [ ] **Step 4: Make it Siri-invocable**

Name the Shortcut something natural to say (e.g. "tell the dashboard").
Settings → Siri & Search → confirm it's listed under "All Shortcuts," or
record a custom phrase for it directly in the Shortcut's settings (tap the
"..." menu → Details → "Add to Siri").

- [ ] **Step 5: End-to-end check**

With `ANTHROPIC_API_KEY` set on the deployed backend, say the Shortcut's
phrase and test one request per resource (e.g. "add milk to groceries,"
"log a rest day today for my workout," "remind me to call the dentist,"
"add a tee time Saturday at 9am," "I bought a spool of red PLA") plus one
deliberately unrelated request ("what's the weather") to confirm the
apology path. Confirm each spoken confirmation matches what actually
changed in the dashboard.

---

## Self-Review Notes

- **Spec coverage:** §3 flow → Task 3 + Task 4 Steps 3-4. §4.1 refactor →
  Task 1. §4.2 new routers → Task 2. §4.3 endpoint (classify/edit/confirm,
  error table) → Task 3. §4.4 Cloudflare → Task 4 Steps 1-2. §4.5 Shortcut
  → Task 4 Steps 3-4. §6 testing → Tasks 1-3's test steps. §7 non-goals →
  deliberately not addressed by any task (compound requests, Android,
  wake-word, on-screen AI box for the 3 new resources).
- **Type/name consistency checked:** `AiEditConfig`, `RESOURCE_REGISTRY`,
  `_scoped_existing`, `_ask_claude`, `_reconcile`, `make_ai_edit_router`
  signatures are identical across Tasks 1-3 wherever reused.
- **Known limitation carried over from the spec** (not a plan gap): voice
  requests have no `date_from`/`date_to`, so date-scoped resources
  (meal-plan, workouts, calendar, groceries) only see/affect the current
  week — see Global Constraints and spec §4.3.
