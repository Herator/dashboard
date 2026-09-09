# Life Dashboard — AI Editing Layer (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the natural-language editing pattern from spec section 5 — "swap Tuesday dinner for chicken", "add 10 minutes of cardio Friday", "remind me to text her when I leave practice" — for the three resources that don't depend on an external calendar integration: meal plan, workouts, and reminders. Calendar's AI editing is deferred until the Google Calendar integration plan (it needs cross-calendar conflict detection first). This is backend-only; the frontend AI input UI is a separate follow-on plan.

**Architecture:** A generic AI-edit router factory (`ai.py`), mirroring the generic CRUD factory from Phase 1a (`crud.py`) — one function builds a `POST /api/{resource}/ai-edit` endpoint from any SQLModel class, instead of hand-writing three near-identical endpoints. The endpoint fetches the resource's current data (scoped to a date range for meal-plan/workouts, unscoped for reminders), sends it plus the user's message to Claude using **structured outputs** (`client.messages.parse(..., output_format=<schema>)`), which guarantees a schema-valid JSON response — no manual JSON parsing/retry logic needed. The backend then reconciles the returned item list against the database: entries with a recognized `id` are updated, entries with no `id` are created, and entries that were in scope but are missing from the response are deleted (this is how the AI expresses "remove this").

**Tech Stack:** `anthropic` Python SDK (structured outputs via `client.messages.parse`), reusing Phase 1a's SQLModel/Pydantic schema-generation pattern.

**Spec:** `life-dashboard-spec.md` (repo root) — this plan implements section 5 (AI Interaction Pattern) for the meal-plan, workouts, and reminders resources from section 6.

## Global Constraints

- Default AI model: `claude-opus-5`, configurable via the `AI_MODEL_ID` environment variable — do not hardcode a different model.
- Meal-plan and workouts are scoped by date range (default: the current calendar week, Monday-Sunday) — never send a resource's entire history to the model. Reminders are unscoped (the dataset is small enough that the whole list is fine, and there's no natural date-range concept for them in the spec).
- If the AI's response can't be parsed or fails validation, the user must see an error, not a silent failure or a 500 (spec section 5, step 5). Structured outputs make parse failures rare, but a refused request, a network error, or an Anthropic API error must still surface as a clear HTTP error.
- Do not change any existing CRUD endpoint's behavior, path, or response shape — this plan only adds new endpoints and one backward-compatible helper-function refactor in `crud.py`.
- No API key exists in this development environment. All automated tests must mock the Anthropic client — never make a real network call in the test suite. A real Anthropic API key is required only at actual deployment time (a later plan's concern), and this phase's own verification is limited to mocked tests plus static/manual review — say so plainly in the final report rather than claiming live end-to-end verification that wasn't possible.

---

### Task 1: Anthropic SDK Setup and Shared Schema Builder for AI Items

**Files:**
- Modify: `life-dashboard/backend/requirements.txt`
- Modify: `life-dashboard/backend/crud.py`
- Create: `life-dashboard/backend/tests/test_crud_schema_builder.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `crud.py` renames its private `_input_model` helper to a public `build_input_model(model, suffix, partial, include_id=False)`. When `include_id=True`, the generated schema gains an `id: Optional[int] = None` field ahead of the model's own fields. Existing behavior for `include_id=False` (the default) is unchanged — `CreateSchema`/`UpdateSchema` in `make_crud_router` keep working exactly as before. Task 2 imports `build_input_model` from `backend.crud`.

- [ ] **Step 1: Add the `anthropic` SDK to requirements.txt**

Install it first to see what resolves, then pin the resolved version:

```bash
cd life-dashboard/backend
.venv/Scripts/pip install anthropic
.venv/Scripts/pip show anthropic
```

Add a line to `life-dashboard/backend/requirements.txt` pinning what actually installed, following the existing file's style (a `>=X.Y,<X.Y+1`-shaped range around the resolved version) — e.g. if `pip show` reports `Version: 0.42.0`, add `anthropic>=0.42,<0.43`. **Important:** this plan's endpoint (Task 2) needs `client.messages.parse(..., output_format=<pydantic model>)` (structured outputs) to exist on the installed version — before finalizing the version pin, confirm the method exists:

```bash
.venv/Scripts/python -c "import anthropic; c = anthropic.Anthropic.__init__; import inspect; from anthropic.resources.messages import Messages; print(hasattr(Messages, 'parse'))"
```

Expected: `True`. If `False`, install a newer version (`pip install --upgrade anthropic`) until it is, and pin that version instead — do not proceed to Task 2 against a version that lacks `messages.parse`.

- [ ] **Step 2: Write the failing test for the schema-builder refactor**

`life-dashboard/backend/tests/test_crud_schema_builder.py`:

```python
from typing import Optional

from backend.crud import build_input_model
from backend.models import QuickLink


def test_build_input_model_without_id_matches_prior_behavior():
    CreateSchema = build_input_model(QuickLink, "TestCreate", partial=False)
    instance = CreateSchema(label="Immich", url="https://photos.example.com")
    assert instance.label == "Immich"
    assert not hasattr(instance, "id")


def test_build_input_model_with_id_includes_optional_id_field():
    ItemSchema = build_input_model(QuickLink, "TestItem", partial=False, include_id=True)
    with_id = ItemSchema(id=5, label="Immich", url="https://photos.example.com")
    assert with_id.id == 5

    without_id = ItemSchema(label="Router", url="https://192.168.1.1")
    assert without_id.id is None
```

Run it to verify it fails:

```bash
.venv/Scripts/pytest tests/test_crud_schema_builder.py -v
```

Expected: FAIL — `ImportError: cannot import name 'build_input_model' from 'backend.crud'` (the function is currently named `_input_model` and has no `include_id` parameter).

- [ ] **Step 3: Rename `_input_model` to `build_input_model` and add `include_id`**

In `life-dashboard/backend/crud.py`:

1. Add `Optional` to the `typing` import on line 1: change `from typing import Any, Dict, List, Tuple, Type, TypeVar` to `from typing import Any, Dict, List, Optional, Tuple, Type, TypeVar`.
2. Rename the function and extend its signature and body:

```python
def build_input_model(
    model: Type[SQLModel], suffix: str, partial: bool, include_id: bool = False
) -> Type[BaseModel]:
    """Build a plain Pydantic model mirroring ``model``'s writable fields.

    SQLModel disables Pydantic validation on ``table=True`` classes, so using
    them directly as FastAPI request bodies means nothing is validated or
    coerced on the way in: bad enums and missing fields blow up as 500s deep in
    SQLAlchemy, and wrong-typed values get persisted verbatim and then break
    every subsequent read. These generated schemas restore validation for the
    request body while the table model still serves as the response model.

    ``partial=True`` (for PUT) gives every field a ``None`` default so it may be
    omitted, but deliberately keeps the *original* annotation rather than
    wrapping it in ``Optional``. Combined with ``exclude_unset=True`` in the
    handler that means: omitted fields are left untouched, an explicit ``null``
    is accepted only for columns that are genuinely nullable, and an explicit
    ``null`` for something like ``ingredients: List[str]`` is a 422 instead of a
    NULL written into a non-nullable column.

    ``include_id=True`` prepends an ``id: Optional[int] = None`` field, for
    callers (the AI-edit endpoints) that need the model to echo back which
    existing row an item refers to, with ``None``/omitted meaning "new row".
    """
    fields: Dict[str, Tuple[Any, Any]] = {}
    if include_id:
        fields["id"] = (Optional[int], None)
    for name, info in model.model_fields.items():
        if name == "id":
            continue
        annotation = info.annotation
        if partial:
            fields[name] = (annotation, None)
        elif info.default_factory is not None:
            fields[name] = (
                annotation,
                PydanticField(default_factory=info.default_factory),
            )
        elif info.is_required():
            fields[name] = (annotation, ...)
        else:
            fields[name] = (annotation, info.default)
    return create_model(f"{model.__name__}{suffix}", **fields)
```

3. Update the two call sites inside `make_crud_router` (currently `_input_model(model, "Create", partial=False)` and `_input_model(model, "Update", partial=True)`) to call `build_input_model` instead — same arguments, just the new name.

- [ ] **Step 4: Run the new test, then the full suite**

```bash
.venv/Scripts/pytest tests/test_crud_schema_builder.py -v
```

Expected: PASS (2 tests).

```bash
.venv/Scripts/pytest -v
```

Expected: all tests pass (30 existing + 2 new = 32), no regressions in `test_crud_factory.py` or `test_routers.py` — confirming the rename didn't break the existing CRUD endpoints.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/backend/requirements.txt life-dashboard/backend/crud.py \
  life-dashboard/backend/tests/test_crud_schema_builder.py
git commit -m "$(cat <<'EOF'
feat: add anthropic SDK, generalize schema builder for AI-edit items

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 2: Generic AI-Edit Router Factory, Proven with Meal Plan

**Files:**
- Create: `life-dashboard/backend/ai.py`
- Modify: `life-dashboard/backend/main.py`
- Create: `life-dashboard/backend/tests/test_ai_edit.py`

**Interfaces:**
- Consumes: `build_input_model` (Task 1); `get_session` from `database.py`.
- Produces: `ai.py` exposes `get_anthropic_client()` (a FastAPI dependency returning `anthropic.Anthropic()`, overridable in tests exactly like `get_session`) and `make_ai_edit_router(model, prefix, tag, resource_label, scope_field=None)`, which returns an `APIRouter` with one route: `POST {prefix}/ai-edit`. Task 3 imports `make_ai_edit_router` to wire up the remaining two resources.

**Before writing the router, inspect the actual shape of `client.messages.parse()`'s return value** — the exact attribute names for the parsed result and for detecting a refusal aren't nailed down by this brief, since they depend on the installed SDK version. Run:

```bash
cd life-dashboard/backend
.venv/Scripts/python -c "
import inspect
from anthropic.resources.messages import Messages
print(inspect.signature(Messages.parse))
print(inspect.getsource(Messages.parse))
"
```

Read the printed source to confirm: (a) the attribute name for the parsed, validated output (this brief assumes `response.parsed_output`, matching the skill documentation — adjust every reference below if the installed version names it differently, e.g. `.parsed`), and (b) whether `response.stop_reason` is present and set to `"refusal"` the same way as a plain `messages.create()` response, or whether refusals surface differently through `parse()` (e.g. raised as an exception). Write the refusal-handling code in Step 3 below to match what you actually find, not the assumption — and note in your report which it turned out to be.

- [ ] **Step 1: Write the failing test for the AI-edit endpoint**

`life-dashboard/backend/tests/test_ai_edit.py`:

```python
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.database import get_session
from backend.main import app


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


def test_ai_edit_creates_a_new_meal_plan_item(client, session):
    from backend.ai import get_anthropic_client

    # ItemSchema instances are duck-typed here via SimpleNamespace with the
    # fields the endpoint reads: id, date, meal_slot, name, ingredients.
    new_item = SimpleNamespace(
        id=None,
        date=date(2026, 9, 10),
        meal_slot="dinner",
        name="Chicken stir fry",
        ingredients=["chicken", "soy sauce"],
        model_dump=lambda exclude=None: {
            "date": date(2026, 9, 10),
            "meal_slot": "dinner",
            "name": "Chicken stir fry",
            "ingredients": ["chicken", "soy sauce"],
        },
    )
    mock_client = make_mock_anthropic_client([new_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit",
        json={"message": "add chicken stir fry for dinner Thursday"},
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "Chicken stir fry"
    assert body[0]["id"] is not None

    # Verify the system prompt mentioned the scope and the raw request reached the mock
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    assert "meal plan" in call_kwargs["system"].lower()
    assert "add chicken stir fry for dinner Thursday" in call_kwargs["messages"][0]["content"]


def test_ai_edit_updates_an_existing_item_by_id(client, session):
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    existing = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.dinner, name="Old dinner", ingredients=[]
    )
    session.add(existing)
    session.commit()
    session.refresh(existing)

    updated_item = SimpleNamespace(
        id=existing.id,
        date=date(2026, 9, 10),
        meal_slot="dinner",
        name="Chicken stir fry",
        ingredients=["chicken"],
        model_dump=lambda exclude=None: {
            "date": date(2026, 9, 10),
            "meal_slot": "dinner",
            "name": "Chicken stir fry",
            "ingredients": ["chicken"],
        },
    )
    mock_client = make_mock_anthropic_client([updated_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit",
        json={"message": "swap Tuesday's old dinner for chicken stir fry"},
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["id"] == existing.id
    assert body[0]["name"] == "Chicken stir fry"


def test_ai_edit_deletes_items_omitted_from_the_response(client, session):
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    to_delete = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.lunch, name="Leftover soup", ingredients=[]
    )
    session.add(to_delete)
    session.commit()
    session.refresh(to_delete)

    mock_client = make_mock_anthropic_client([])  # AI returned an empty list: delete everything in scope
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit",
        json={"message": "remove Tuesday's lunch"},
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json() == []

    list_resp = client.get("/api/meal-plan/")
    assert list_resp.json() == []


def test_ai_edit_scopes_to_the_requested_date_range(client, session):
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    in_scope = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.dinner, name="In scope", ingredients=[]
    )
    out_of_scope = MealPlanItem(
        date=date(2026, 9, 20), meal_slot=MealSlot.dinner, name="Out of scope", ingredients=[]
    )
    session.add_all([in_scope, out_of_scope])
    session.commit()

    mock_client = make_mock_anthropic_client([])  # returning nothing in scope
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit",
        json={
            "message": "clear this week",
            "date_from": "2026-09-07",
            "date_to": "2026-09-13",
        },
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    # Only the in-scope item should have been visible to delete; the
    # out-of-scope item must survive untouched.
    remaining = client.get("/api/meal-plan/").json()
    assert len(remaining) == 1
    assert remaining[0]["name"] == "Out of scope"


def test_ai_edit_returns_502_on_anthropic_api_error(client, session):
    import anthropic

    from backend.ai import get_anthropic_client

    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = anthropic.APIConnectionError(request=MagicMock())
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit", json={"message": "anything"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 502
```

Adjust the `anthropic.APIConnectionError(request=MagicMock())` construction if the installed SDK's exception requires different constructor arguments — check with `python -c "import anthropic, inspect; print(inspect.signature(anthropic.APIConnectionError.__init__))"` and adapt the test accordingly; the intent (simulate a network-level failure from the client) is what matters, not this exact call.

Run it to verify it fails:

```bash
.venv/Scripts/pytest tests/test_ai_edit.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'backend.ai'` (and `/api/meal-plan/ai-edit` doesn't exist yet).

- [ ] **Step 2: Write ai.py**

`life-dashboard/backend/ai.py` — write this using the pattern below, **adjusting the response-attribute names per what you found in the pre-step inspection above**:

```python
import json
import os
from datetime import date, timedelta
from typing import List, Optional, Type

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, create_model
from sqlmodel import Session, SQLModel, select

from backend.crud import build_input_model
from backend.database import get_session

AI_MODEL_ID = os.environ.get("AI_MODEL_ID", "claude-opus-5")


def get_anthropic_client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


def _current_week_bounds() -> tuple[date, date]:
    today = date.today()
    start = today - timedelta(days=today.weekday())
    return start, start + timedelta(days=6)


def make_ai_edit_router(
    model: Type[SQLModel],
    prefix: str,
    tag: str,
    resource_label: str,
    scope_field: Optional[str] = None,
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])

    ItemSchema = build_input_model(model, "AiItem", partial=False, include_id=True)
    ResultSchema = create_model("AiEditResult", items=(List[ItemSchema], ...))

    class AiEditRequest(BaseModel):
        message: str
        date_from: Optional[date] = None
        date_to: Optional[date] = None

    @router.post("/ai-edit", response_model=List[model])
    def ai_edit(
        body: AiEditRequest,
        session: Session = Depends(get_session),
        client: anthropic.Anthropic = Depends(get_anthropic_client),
    ):
        query = select(model)
        scope_note = ""
        if scope_field:
            default_start, default_end = _current_week_bounds()
            date_from = body.date_from or default_start
            date_to = body.date_to or default_end
            column = getattr(model, scope_field)
            query = query.where(column >= date_from, column <= date_to)
            scope_note = (
                f" You are only shown, and may only affect, entries with "
                f"{scope_field} between {date_from.isoformat()} and "
                f"{date_to.isoformat()} inclusive."
            )

        existing = session.exec(query).all()
        existing_ids = {item.id for item in existing}
        current_json = [item.model_dump(mode="json") for item in existing]

        system_prompt = (
            f"You are the AI editing assistant for the {resource_label} feature of a "
            "personal life dashboard. You will be given the user's current entries as "
            "a JSON array (each has an `id`) and a natural-language request describing "
            "a change. Return the complete updated array of entries reflecting the "
            "request: keep entries unchanged (with their original `id`) unless the "
            "request modifies them, modify entries the request refers to (preserve "
            "their `id`), omit entries the request asks to delete, and add new "
            "entries with `id` set to null for anything new the request asks to "
            "create. Only include entries within what you were given — never invent "
            "entries outside that scope." + scope_note
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
                            f"User request: {body.message}"
                        ),
                    }
                ],
                output_format=ResultSchema,
            )
        except anthropic.APIError as exc:
            raise HTTPException(status_code=502, detail=f"AI request failed: {exc}")

        if getattr(response, "stop_reason", None) == "refusal":
            raise HTTPException(
                status_code=422, detail="The AI declined to process this request."
            )

        returned_items = response.parsed_output.items
        returned_ids = {
            item.id
            for item in returned_items
            if item.id is not None and item.id in existing_ids
        }

        for stale_id in existing_ids - returned_ids:
            stale_row = session.get(model, stale_id)
            if stale_row:
                session.delete(stale_row)

        result_rows = []
        for item in returned_items:
            data = item.model_dump(exclude={"id"})
            if item.id is not None and item.id in existing_ids:
                row = session.get(model, item.id)
                for key, value in data.items():
                    setattr(row, key, value)
            else:
                row = model(**data)
                session.add(row)
            result_rows.append(row)

        session.commit()
        for row in result_rows:
            session.refresh(row)
        return result_rows

    return router
```

Note: any `id` the model returns that doesn't match an id from `existing_ids` is silently treated as a new row (its bogus id is dropped via `exclude={"id"}` and a fresh row is inserted) — this is a deliberate safety choice so a hallucinated or out-of-scope id can never cause an update to, or deletion of, a row outside what was actually shown to the model.

- [ ] **Step 3: Wire up the meal-plan AI-edit route in main.py**

Add the import and one line to `life-dashboard/backend/main.py`. Add `make_ai_edit_router` to the existing import from `backend.crud`... actually it lives in the new `backend.ai` module, so add a new import line:

```python
from backend.ai import make_ai_edit_router
```

Add this registration near the existing `MealPlanItem` CRUD router line:

```python
app.include_router(
    make_ai_edit_router(MealPlanItem, "/api/meal-plan", "meal-plan-ai", "meal plan", scope_field="date")
)
```

Place it directly after the line `app.include_router(make_crud_router(MealPlanItem, "/api/meal-plan", "meal-plan"))`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
.venv/Scripts/pytest tests/test_ai_edit.py -v
```

Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite to confirm no regressions**

```bash
.venv/Scripts/pytest -v
```

Expected: all tests pass, no regressions in any existing file.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/backend/ai.py life-dashboard/backend/main.py \
  life-dashboard/backend/tests/test_ai_edit.py
git commit -m "$(cat <<'EOF'
feat: add generic AI-edit router factory, prove it out with meal plan

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 3: Wire Up AI-Edit for Workouts and Reminders

**Files:**
- Modify: `life-dashboard/backend/main.py`
- Create: `life-dashboard/backend/tests/test_ai_edit_routers.py`

**Interfaces:**
- Consumes: `make_ai_edit_router` (Task 2).
- Produces: `POST /api/workouts/ai-edit` (scoped by `date`, like meal-plan) and `POST /api/reminders/ai-edit` (unscoped — `scope_field=None`).

- [ ] **Step 1: Write the failing test**

`life-dashboard/backend/tests/test_ai_edit_routers.py`:

```python
from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.ai import get_anthropic_client
from backend.main import app


def make_mock_client(parsed_items):
    mock_client = MagicMock()
    mock_client.messages.parse.return_value = SimpleNamespace(
        parsed_output=SimpleNamespace(items=parsed_items), stop_reason="end_turn"
    )
    return mock_client


def test_workouts_ai_edit_endpoint_exists_and_is_scoped(client, session):
    mock_client = make_mock_client([])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/workouts/ai-edit", json={"message": "make Thursday a rest day"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    assert "workout" in call_kwargs["system"].lower()
    assert "date" in call_kwargs["system"]  # scope_note should mention the date field


def test_reminders_ai_edit_endpoint_exists_and_is_unscoped(client, session):
    from datetime import datetime

    from backend.models import Reminder

    existing = Reminder(text="Old reminder", trigger_time=datetime(2026, 9, 10, 18, 0))
    session.add(existing)
    session.commit()
    session.refresh(existing)

    new_item = SimpleNamespace(
        id=None,
        text="Text girlfriend when I leave practice",
        trigger_time="2026-09-10T20:00:00",
        sent=False,
        model_dump=lambda exclude=None: {
            "text": "Text girlfriend when I leave practice",
            "trigger_time": "2026-09-10T20:00:00",
            "sent": False,
        },
    )
    mock_client = make_mock_client([new_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/reminders/ai-edit",
        json={"message": "remind me to text her when I leave practice"},
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["text"] == "Text girlfriend when I leave practice"
    # Unscoped: no date_from/date_to language expected in the system prompt
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    assert "between" not in call_kwargs["system"]
```

Run it to verify it fails:

```bash
.venv/Scripts/pytest tests/test_ai_edit_routers.py -v
```

Expected: FAIL — 404 on both endpoints (not wired up yet).

- [ ] **Step 2: Wire up the two routers in main.py**

Add these two lines to `life-dashboard/backend/main.py`, next to their respective CRUD router registrations:

```python
app.include_router(
    make_ai_edit_router(Workout, "/api/workouts", "workouts-ai", "workout plan", scope_field="date")
)
app.include_router(
    make_ai_edit_router(Reminder, "/api/reminders", "reminders-ai", "reminders")
)
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
.venv/Scripts/pytest tests/test_ai_edit_routers.py -v
```

Expected: PASS (2 tests).

- [ ] **Step 4: Run the full suite**

```bash
.venv/Scripts/pytest -v
```

Expected: all tests pass, no regressions.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/backend/main.py life-dashboard/backend/tests/test_ai_edit_routers.py
git commit -m "$(cat <<'EOF'
feat: wire up AI-edit endpoints for workouts and reminders

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 4: Environment Wiring and Documentation

**Files:**
- Create: `life-dashboard/.env.example`
- Modify: `life-dashboard/docker-compose.yml`

**Interfaces:**
- Consumes: nothing new.
- Produces: a documented list of environment variables the backend reads, and a compose file that passes them from a local `.env` (gitignored, created by whoever deploys this) into the backend container.

- [ ] **Step 1: Create .env.example**

`life-dashboard/.env.example`:

```
# Copy this file to .env and fill in real values. .env is gitignored —
# never commit real secrets.

# Required for the AI editing layer (meal plan, workouts, reminders).
# Get a key at https://console.anthropic.com/
ANTHROPIC_API_KEY=

# Optional: override the AI model used for editing (default: claude-opus-5)
AI_MODEL_ID=

# Optional: the frontend's origin, for CORS (default: http://localhost:5173)
FRONTEND_ORIGIN=
```

- [ ] **Step 2: Wire docker-compose.yml to pass these through to the backend service**

Read the current `life-dashboard/docker-compose.yml` first. Add an `env_file` entry to the existing `life-dashboard-backend` service (do not otherwise modify that service's `build`, `ports`, or `volumes`):

```yaml
services:
  life-dashboard-backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    env_file:
      - .env
    ports:
      - "8080:8000"
    volumes:
      - life-dashboard-data:/app/backend/data
    restart: unless-stopped
```

(Preserve whatever is actually in the file for the other services/volumes — only add the `env_file` key to the backend service.) Note: `env_file` pointing at a `.env` that doesn't exist on disk is not an error for Docker Compose as long as the file is present at deploy time — this repo's `.gitignore` already excludes `.env`, so nothing here needs to change there.

- [ ] **Step 3: Verify the full backend test suite still passes**

```bash
cd life-dashboard/backend
.venv/Scripts/pytest -v
```

Expected: all tests pass (unaffected by this task — it's config-only, no application code touched).

- [ ] **Step 4: Commit**

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/.env.example life-dashboard/docker-compose.yml
git commit -m "$(cat <<'EOF'
docs: document required env vars and wire them into docker-compose

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

## Note for whoever reviews this phase

**No live Anthropic API call was made anywhere in this plan** — there is no API key in this development environment. Every test mocks `get_anthropic_client`. This means the actual prompt quality, real-world JSON schema compliance under `output_format`, and true end-to-end behavior against the live API have not been verified — only the request-building, response-reconciliation, and error-handling logic around a *simulated* response. Before relying on this in practice, do one real manual test per endpoint (with a real `ANTHROPIC_API_KEY` set) and confirm the model's behavior matches expectations — particularly whether it respects the "only entries within scope" instruction and doesn't invent extraneous fields.

## Next Plans (not part of this plan)

1. **Frontend AI input UI** — an input box on the meal-plan, workouts, and reminders pages that POSTs to the new `ai-edit` endpoints and refreshes the list with the response.
2. **Calendar integration** — Google Calendar API, then extend this same AI-edit pattern to events once cross-calendar conflict detection exists.
3. **External integrations** — ntfy for reminder delivery, package tracking API.
4. **Deployment** — Cloudflare Tunnel + Access wiring; this is also where a real `ANTHROPIC_API_KEY` gets provisioned and the "Note for whoever reviews this phase" above gets closed out with a real manual test.
