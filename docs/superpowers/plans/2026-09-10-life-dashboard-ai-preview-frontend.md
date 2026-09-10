# Life Dashboard — AI Preview/Confirm Backend + Frontend Input UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI editing layer (meal plan, workouts, reminders) an actual UI, and close a real risk the Phase 2a final review flagged: today, one ambiguous message (e.g. "clear this week") commits a delete-by-omission edit immediately, with no confirmation and no undo. This plan splits the backend into a **preview** step (compute what would change — created/updated/deleted — without saving) and an **apply** step (commit exactly that previewed result), and builds a frontend input box that shows the preview and requires a click to apply.

**Architecture:** `ai.py`'s single `/ai-edit` handler is refactored into three shared helpers (`_scoped_existing`, `_ask_claude`, `_reconcile`) so the existing `/ai-edit` endpoint's behavior is byte-for-byte unchanged (all 49 existing backend tests must keep passing untouched), while two new routes — `/ai-edit/preview` (calls Claude, computes the diff, rolls back) and `/ai-edit/apply` (takes the exact item list a preview already returned, skips calling Claude again, commits) — reuse the same reconciliation logic. Because `main.py` already registers one `make_ai_edit_router(...)` per resource, the new routes appear automatically for meal-plan, workouts, and reminders with no `main.py` changes. On the frontend, a new generic `AiEditBox` component (config-driven, like `ResourcePage`) renders an input + "Suggest" button, shows the preview as a plain-language summary, and only calls apply after the user clicks "Apply".

**Tech Stack:** Same as Phase 2a (FastAPI, SQLModel, Anthropic structured outputs) plus, on the frontend, the existing React/Vitest/RTL stack.

**Spec:** `life-dashboard-spec.md` (repo root) — this plan implements the UI half of section 5 (AI Interaction Pattern), specifically the "Conflicts should be flagged back to the user, not silently ignored" principle extended to non-calendar deletions.

## Global Constraints

- `POST /api/{resource}/ai-edit` (the existing Phase 2a endpoint) must not change behavior, response shape, or any existing test's outcome. It stays as a direct-commit option; nothing in this plan removes it.
- `/ai-edit/preview` must never write to the database under any circumstances — verify this with a test that calls preview and then confirms via a normal `GET` that nothing changed.
- `/ai-edit/apply` must never call the Anthropic API — it operates purely on the item list the frontend echoes back from a prior preview response.
- The `exclude_unset` semantics that protect optional fields from being wiped on update (Phase 2a's fix) must survive the preview→apply round trip: a field the AI didn't mention must stay omitted through the JSON response and the JSON request that echoes it back, not silently reappear with a default value.
- No `ANTHROPIC_API_KEY` exists in this environment. All backend tests mock the Anthropic client. The frontend AI-input UI cannot be exercised against a live model in this environment either — say so plainly rather than claiming an end-to-end AI verification that wasn't possible.
- No AI editing anywhere for calendar/events, groceries, assignments, exams, or packages — this plan touches only meal-plan, workouts, and reminders, matching Phase 2a's scope.

---

### Task 1: Backend Refactor and `/ai-edit/preview`, Proven with Meal Plan

**Files:**
- Modify: `life-dashboard/backend/ai.py`
- Create: `life-dashboard/backend/tests/test_ai_edit_preview.py`

**Interfaces:**
- Consumes: nothing new (same `build_input_model`, `get_session` as before).
- Produces: `ai.py`'s `make_ai_edit_router` now also registers `POST {prefix}/ai-edit/preview`, returning `{created: [...], updated: [{before, after}, ...], deleted: [...], items: [...]}` (each of `created`/`deleted` a plain dict of the item's fields; `items` is the raw resolved item list from Claude, with `exclude_unset` semantics preserved, for Task 2's `/ai-edit/apply` to consume verbatim).

- [ ] **Step 1: Write the failing tests for the preview endpoint**

`life-dashboard/backend/tests/test_ai_edit_preview.py`:

```python
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.database import get_session
from backend.main import app


def make_mock_anthropic_client(parsed_items, stop_reason="end_turn"):
    mock_client = MagicMock()
    mock_client.messages.parse.return_value = SimpleNamespace(
        parsed_output=SimpleNamespace(items=parsed_items), stop_reason=stop_reason
    )
    return mock_client


def make_parsed_item(item_id, set_fields, unset_defaults=None):
    """SimpleNamespace stand-in for a generated ItemSchema instance whose
    model_dump mirrors Pydantic's real exclude_unset semantics — see
    test_ai_edit.py for the original version of this helper (duplicated
    here to keep this file self-contained; do not import across test files)."""
    unset_defaults = unset_defaults or {}

    def model_dump(exclude=None, exclude_unset=False, **kwargs):
        data = dict(set_fields)
        if not exclude_unset:
            data.update(unset_defaults)
        for key in exclude or ():
            data.pop(key, None)
        return data

    return SimpleNamespace(id=item_id, model_dump=model_dump, **set_fields)


def test_preview_creates_show_up_in_created_and_nothing_is_persisted(client, session):
    from backend.ai import get_anthropic_client

    new_item = make_parsed_item(
        None, {"date": date(2026, 9, 10), "meal_slot": "dinner", "name": "Chicken stir fry"},
        unset_defaults={"ingredients": []},
    )
    mock_client = make_mock_anthropic_client([new_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit/preview",
        json={"message": "add chicken stir fry for dinner"},
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["created"]) == 1
    assert body["created"][0]["name"] == "Chicken stir fry"
    assert body["updated"] == []
    assert body["deleted"] == []

    # Nothing was actually written.
    assert client.get("/api/meal-plan/").json() == []


def test_preview_updates_show_before_and_after_without_persisting(client, session):
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    existing = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.dinner, name="Old dinner", ingredients=["rice"]
    )
    session.add(existing)
    session.commit()
    session.refresh(existing)

    updated_item = make_parsed_item(
        existing.id,
        {"date": date(2026, 9, 10), "meal_slot": "dinner", "name": "Chicken stir fry"},
        unset_defaults={"ingredients": ["rice"]},
    )
    mock_client = make_mock_anthropic_client([updated_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit/preview", json={"message": "swap for chicken stir fry"}
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["updated"]) == 1
    assert body["updated"][0]["before"]["name"] == "Old dinner"
    assert body["updated"][0]["after"]["name"] == "Chicken stir fry"
    # The AI omitted ingredients — the round-trip item it returns to us must
    # not claim a value for it.
    assert "ingredients" not in body["items"][0]

    # Nothing was actually written — the row is still "Old dinner".
    still_there = client.get("/api/meal-plan/").json()
    assert len(still_there) == 1
    assert still_there[0]["name"] == "Old dinner"
    assert still_there[0]["ingredients"] == ["rice"]


def test_preview_deletions_show_up_without_persisting(client, session):
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    existing = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.lunch, name="Leftover soup", ingredients=[]
    )
    session.add(existing)
    session.commit()

    mock_client = make_mock_anthropic_client([])  # AI returned nothing: delete everything in scope
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit/preview", json={"message": "remove lunch"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["deleted"]) == 1
    assert body["deleted"][0]["name"] == "Leftover soup"

    # Nothing was actually deleted.
    still_there = client.get("/api/meal-plan/").json()
    assert len(still_there) == 1


def test_preview_no_op_change_is_not_reported_as_updated(client, session):
    """If the AI echoes an item back completely unchanged, it shouldn't show
    up in `updated` — that list is for genuinely different before/after."""
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    existing = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.dinner, name="Same dinner", ingredients=["rice"]
    )
    session.add(existing)
    session.commit()
    session.refresh(existing)

    same_item = make_parsed_item(
        existing.id,
        {"date": date(2026, 9, 10), "meal_slot": "dinner", "name": "Same dinner", "ingredients": ["rice"]},
    )
    mock_client = make_mock_anthropic_client([same_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit/preview", json={"message": "no real change"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json()["updated"] == []


def test_preview_passes_through_refusal_and_api_error_like_ai_edit(client, session):
    from backend.ai import get_anthropic_client

    mock_client = make_mock_anthropic_client([], stop_reason="refusal")
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit/preview", json={"message": "do something bad"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 422
```

Run it to verify it fails:

```bash
cd life-dashboard/backend
.venv/Scripts/pytest tests/test_ai_edit_preview.py -v
```

Expected: FAIL — 404 on `/api/meal-plan/ai-edit/preview` (route doesn't exist yet).

- [ ] **Step 2: Rewrite ai.py**

Replace the full contents of `life-dashboard/backend/ai.py` with:

```python
import json
import logging
import os
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Type

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError, create_model
from sqlmodel import Session, SQLModel, select

from backend.crud import build_input_model
from backend.database import get_session

logger = logging.getLogger(__name__)

# `or` rather than a `.get` default: an env var set to the empty string (which
# is what copying .env.example verbatim used to produce) is still "set", so a
# plain default would leave the model id as "" and send that to the API.
AI_MODEL_ID = os.environ.get("AI_MODEL_ID") or "claude-opus-5"


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

    class ApplyRequest(BaseModel):
        items: List[ItemSchema]
        date_from: Optional[date] = None
        date_to: Optional[date] = None

    class AiEditPreviewResponse(BaseModel):
        created: List[Dict[str, Any]]
        updated: List[Dict[str, Any]]
        deleted: List[Dict[str, Any]]
        items: List[ItemSchema]

    def _scoped_existing(date_from: Optional[date], date_to: Optional[date], session: Session):
        """Query the rows this request may see/affect, plus the prompt text
        describing that scope (empty string when the resource is unscoped)."""
        query = select(model)
        scope_note = ""
        if scope_field:
            default_start, default_end = _current_week_bounds()
            resolved_from = date_from or default_start
            resolved_to = date_to or default_end
            column = getattr(model, scope_field)
            query = query.where(column >= resolved_from, column <= resolved_to)
            scope_note = (
                f" You are only shown, and may only affect, entries with "
                f"{scope_field} between {resolved_from.isoformat()} and "
                f"{resolved_to.isoformat()} inclusive."
            )
        return session.exec(query).all(), scope_note

    def _ask_claude(client: anthropic.Anthropic, message: str, existing, scope_note: str):
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
                            f"User request: {message}"
                        ),
                    }
                ],
                output_format=ResultSchema,
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

    def _reconcile(session: Session, existing, returned_items, commit: bool):
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
            logger.warning(
                "AI-edit %s %d row(s) from %s: ids=%s",
                "deleting" if commit else "would delete",
                len(stale_ids),
                tag,
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
                row = model(**data)
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

    @router.post("/ai-edit", response_model=List[model])
    def ai_edit(
        body: AiEditRequest,
        session: Session = Depends(get_session),
        client: anthropic.Anthropic = Depends(get_anthropic_client),
    ):
        existing, scope_note = _scoped_existing(body.date_from, body.date_to, session)
        returned_items = _ask_claude(client, body.message, existing, scope_note)
        _, _, _, result_rows = _reconcile(session, existing, returned_items, commit=True)
        return result_rows

    @router.post(
        "/ai-edit/preview",
        response_model=AiEditPreviewResponse,
        response_model_exclude_unset=True,
    )
    def ai_edit_preview(
        body: AiEditRequest,
        session: Session = Depends(get_session),
        client: anthropic.Anthropic = Depends(get_anthropic_client),
    ):
        existing, scope_note = _scoped_existing(body.date_from, body.date_to, session)
        returned_items = _ask_claude(client, body.message, existing, scope_note)
        created, updated, deleted, _ = _reconcile(session, existing, returned_items, commit=False)
        return AiEditPreviewResponse(
            created=created, updated=updated, deleted=deleted, items=returned_items
        )

    @router.post("/ai-edit/apply", response_model=List[model])
    def ai_edit_apply(
        body: ApplyRequest,
        session: Session = Depends(get_session),
    ):
        existing, _ = _scoped_existing(body.date_from, body.date_to, session)
        _, _, _, result_rows = _reconcile(session, existing, body.items, commit=True)
        return result_rows

    return router
```

**Before running tests, verify the `response_model_exclude_unset=True` mechanism actually preserves per-item unset fields through the nested `items: List[ItemSchema]` field** — this is the one part of this rewrite not proven by an existing pattern in the codebase. Run the new preview tests (next step) and specifically check `test_preview_updates_show_before_and_after_without_persisting`'s assertion that `"ingredients" not in body["items"][0]`. If that assertion fails because FastAPI/Pydantic doesn't propagate `exclude_unset` into the nested list the way expected, do not force it — instead, build the `items` field manually as a list of dicts via `[item.model_dump(mode="json", exclude_unset=True) for item in returned_items]` (changing `AiEditPreviewResponse.items` to `List[Dict[str, Any]]` instead of `List[ItemSchema]`, and removing `response_model_exclude_unset=True` since it would no longer be needed). Either approach is fine — the requirement is that the assertion passes for the right reason, not the specific mechanism.

- [ ] **Step 3: Run the new tests to verify they pass**

```bash
.venv/Scripts/pytest tests/test_ai_edit_preview.py -v
```

Expected: PASS (5 tests).

- [ ] **Step 4: Run the full existing suite to confirm `/ai-edit` is unchanged**

```bash
.venv/Scripts/pytest -v
```

Expected: all 49 previously-existing tests still pass, plus the 5 new ones (54 total). Pay particular attention to `test_ai_edit.py` and `test_ai_edit_routers.py` — every one of those tests must pass with *zero* changes to their own code, proving the refactor didn't alter `/ai-edit`'s behavior.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/backend/ai.py life-dashboard/backend/tests/test_ai_edit_preview.py
git commit -m "$(cat <<'EOF'
feat: refactor ai-edit into shared helpers, add preview endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 2: `/ai-edit/apply` and the Preview→Apply Round Trip

**Files:**
- No changes to `ai.py` — `/ai-edit/apply` was already written in Task 1's rewrite. This task is entirely about proving it works.
- Modify: `life-dashboard/backend/tests/test_ai_edit_preview.py` — append these tests to the file Task 1 already created (it already defines `make_mock_anthropic_client`/`make_parsed_item`; reuse them, don't redefine).

**Interfaces:**
- Consumes: `AiEditPreviewResponse`'s `items` field (Task 1) — this task's tests feed a preview response's `items` value directly into an apply request, exactly as the frontend will.

**Note (ponytail simplification, applied while executing this plan):** the plan originally called for a separate `test_ai_edit_apply.py` file with its own copies of the mock helpers. Since Task 1's `test_ai_edit_preview.py` already has them and this task's tests need the exact same doubles, appending here is the same coverage for less duplication. If you're reading this brief before Task 1 has actually landed those helpers, fall back to defining them locally instead of blocking.

- [ ] **Step 1: Write the failing tests**

Append to `life-dashboard/backend/tests/test_ai_edit_preview.py`:

```python
def test_apply_does_not_call_the_ai(client, session):
    """apply must be pure DB reconciliation — it should work with no
    Anthropic client override at all, proving it never calls messages.parse."""
    resp = client.post(
        "/api/meal-plan/ai-edit/apply",
        json={"items": [{"date": "2026-09-10", "meal_slot": "dinner", "name": "Tacos"}]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "Tacos"


def test_preview_then_apply_round_trip_creates_correctly(client, session):
    from backend.ai import get_anthropic_client

    new_item = make_parsed_item(
        None, {"date": date(2026, 9, 10), "meal_slot": "dinner", "name": "Chicken stir fry"},
        unset_defaults={"ingredients": []},
    )
    mock_client = make_mock_anthropic_client([new_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    preview = client.post(
        "/api/meal-plan/ai-edit/preview", json={"message": "add chicken stir fry"}
    ).json()

    app.dependency_overrides.pop(get_anthropic_client, None)

    apply_resp = client.post("/api/meal-plan/ai-edit/apply", json={"items": preview["items"]})

    assert apply_resp.status_code == 200
    body = apply_resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "Chicken stir fry"
    assert body[0]["ingredients"] == []  # SQLModel's own default_factory applied


def test_preview_then_apply_round_trip_preserves_omitted_optional_fields(client, session):
    """The exact regression this plan exists to protect: an update that omits
    an optional field must not wipe it, all the way through preview -> apply."""
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    existing = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.dinner, name="Old dinner", ingredients=["rice"]
    )
    session.add(existing)
    session.commit()
    session.refresh(existing)

    updated_item = make_parsed_item(
        existing.id,
        {"date": date(2026, 9, 10), "meal_slot": "dinner", "name": "Chicken stir fry"},
        unset_defaults={"ingredients": ["rice"]},
    )
    mock_client = make_mock_anthropic_client([updated_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    preview = client.post(
        "/api/meal-plan/ai-edit/preview", json={"message": "swap for chicken stir fry"}
    ).json()

    app.dependency_overrides.pop(get_anthropic_client, None)

    # Confirm the round trip actually dropped the unset field before we even
    # get to apply — this is what makes the test meaningful rather than
    # trivially passing regardless of whether exclude_unset survived.
    assert "ingredients" not in preview["items"][0]

    apply_resp = client.post("/api/meal-plan/ai-edit/apply", json={"items": preview["items"]})

    assert apply_resp.status_code == 200
    body = apply_resp.json()
    assert body[0]["id"] == existing.id
    assert body[0]["name"] == "Chicken stir fry"
    assert body[0]["ingredients"] == ["rice"]  # untouched, survived preview -> apply


def test_preview_then_apply_round_trip_deletes_correctly(client, session):
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    existing = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.lunch, name="Leftover soup", ingredients=[]
    )
    session.add(existing)
    session.commit()

    mock_client = make_mock_anthropic_client([])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    preview = client.post(
        "/api/meal-plan/ai-edit/preview", json={"message": "remove lunch"}
    ).json()

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert len(preview["deleted"]) == 1

    apply_resp = client.post("/api/meal-plan/ai-edit/apply", json={"items": preview["items"]})

    assert apply_resp.status_code == 200
    assert apply_resp.json() == []
    assert client.get("/api/meal-plan/").json() == []
```

Run it to verify it fails only where expected:

```bash
.venv/Scripts/pytest tests/test_ai_edit_apply.py -v
```

Expected: since `/ai-edit/apply` was already written in Task 1, these should mostly PASS already — this step is really a verification step, not a RED step. If any test fails, that's a genuine bug in Task 1's `/ai-edit/apply` implementation (most likely the `exclude_unset` round-trip in `AiEditPreviewResponse`) — fix it in `ai.py` per Task 1 Step 2's fallback guidance before proceeding, and note the fix in this task's report even though the file changed belongs to Task 1's commit conceptually.

- [ ] **Step 2: Run the full suite**

```bash
.venv/Scripts/pytest -v
```

Expected: all tests pass (54 + 4 new = 58).

- [ ] **Step 3: Commit**

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/backend/tests/test_ai_edit_preview.py
git commit -m "$(cat <<'EOF'
test: prove the preview-then-apply round trip for meal-plan

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 3: Prove Preview/Apply Work for Workouts and Reminders Too

**Files:**
- Modify: `life-dashboard/backend/tests/test_ai_edit_routers.py`

**Interfaces:**
- Consumes: nothing new. `main.py` already calls `make_ai_edit_router(...)` once each for `Workout` and `Reminder` (from Phase 2a) — since Task 1 added the `preview`/`apply` routes *inside* the shared factory, they are already live for both resources with zero `main.py` changes. This task is pure test coverage, proving that claim rather than assuming it.

- [ ] **Step 1: Write the failing tests**

Append to `life-dashboard/backend/tests/test_ai_edit_routers.py` (the file already has `make_mock_client` defined near the top — reuse it, don't redefine):

```python
def test_workouts_ai_edit_preview_and_apply_round_trip(client, session):
    from backend.models import Workout

    existing = Workout(date=date(2026, 9, 10), plan_text="5k easy", notes="stretch first")
    session.add(existing)
    session.commit()
    session.refresh(existing)

    updated_item = SimpleNamespace(
        id=existing.id,
        model_dump=lambda exclude=None, exclude_unset=False, **kwargs: (
            {"date": date(2026, 9, 10), "plan_text": "5k tempo"}
            if exclude_unset
            else {"date": date(2026, 9, 10), "plan_text": "5k tempo", "notes": "stretch first"}
        ),
    )
    mock_client = make_mock_client([updated_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    preview = client.post(
        "/api/workouts/ai-edit/preview", json={"message": "make it a tempo run"}
    ).json()

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert len(preview["updated"]) == 1
    assert "notes" not in preview["items"][0]

    apply_resp = client.post("/api/workouts/ai-edit/apply", json={"items": preview["items"]})
    assert apply_resp.status_code == 200
    body = apply_resp.json()
    assert body[0]["plan_text"] == "5k tempo"
    assert body[0]["notes"] == "stretch first"


def test_reminders_ai_edit_preview_and_apply_round_trip(client, session):
    new_item = SimpleNamespace(
        id=None,
        model_dump=lambda exclude=None, exclude_unset=False, **kwargs: {
            "text": "Text her when I leave practice",
            "trigger_time": "2026-09-10T20:00:00",
        },
    )
    mock_client = make_mock_client([new_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    preview = client.post(
        "/api/reminders/ai-edit/preview",
        json={"message": "remind me to text her when I leave practice"},
    ).json()

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert len(preview["created"]) == 1

    apply_resp = client.post("/api/reminders/ai-edit/apply", json={"items": preview["items"]})
    assert apply_resp.status_code == 200
    body = apply_resp.json()
    assert body[0]["text"] == "Text her when I leave practice"
    assert body[0]["sent"] is False  # model default applied
```

Check the top of `test_ai_edit_routers.py` for its existing imports (`date`, `SimpleNamespace`, `get_anthropic_client`, `app`) — add any that these two new tests need but the file doesn't already import.

Run it to verify it passes (should already work, per Task 1's design — same caveat as Task 2 Step 1 applies: a failure here is a real bug to fix, not an expected RED):

```bash
.venv/Scripts/pytest tests/test_ai_edit_routers.py -v
```

Expected: PASS (all tests in the file, including the 2 new ones).

- [ ] **Step 2: Run the full suite**

```bash
.venv/Scripts/pytest -v
```

Expected: all tests pass (58 + 2 new = 60).

- [ ] **Step 3: Commit**

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/backend/tests/test_ai_edit_routers.py
git commit -m "$(cat <<'EOF'
test: prove preview/apply generalize to workouts and reminders

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 4: Frontend API Client Additions and the AiEditBox Component

**Files:**
- Modify: `life-dashboard/frontend/src/api.js`
- Create: `life-dashboard/frontend/src/components/AiEditBox.jsx`
- Create: `life-dashboard/frontend/src/components/AiEditBox.test.jsx`

**Interfaces:**
- Produces: `api.js` gains `previewAiEdit(resource, payload)` and `applyAiEdit(resource, payload)`. `AiEditBox.jsx` exports a default component `AiEditBox({ resourceKey, primaryField, onApplied })` — Task 5 wires it into `ResourcePage`.

- [ ] **Step 1: Add the two API functions**

Add to `life-dashboard/frontend/src/api.js`, after the existing `deleteItem` export:

```js
export function previewAiEdit(resource, payload) {
  return request(`/api/${resource}/ai-edit/preview`, { method: "POST", body: JSON.stringify(payload) });
}

export function applyAiEdit(resource, payload) {
  return request(`/api/${resource}/ai-edit/apply`, { method: "POST", body: JSON.stringify(payload) });
}
```

- [ ] **Step 2: Write the failing test for AiEditBox**

`life-dashboard/frontend/src/components/AiEditBox.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AiEditBox from "./AiEditBox";
import * as api from "../api";

describe("AiEditBox", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a preview summary after Suggest, without applying anything yet", async () => {
    vi.spyOn(api, "previewAiEdit").mockResolvedValue({
      created: [{ name: "Chicken stir fry" }],
      updated: [],
      deleted: [],
      items: [{ date: "2026-09-10", meal_slot: "dinner", name: "Chicken stir fry" }],
    });
    const applySpy = vi.spyOn(api, "applyAiEdit");
    const onApplied = vi.fn();

    render(<AiEditBox resourceKey="meal-plan" primaryField="name" onApplied={onApplied} />);

    await userEvent.type(
      screen.getByPlaceholderText(/tell the ai/i),
      "add chicken stir fry for dinner"
    );
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));

    expect(await screen.findByText(/create 1/i)).toBeInTheDocument();
    expect(screen.getByText(/chicken stir fry/i)).toBeInTheDocument();
    expect(applySpy).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("calls applyAiEdit with the previewed items when Apply is clicked, then calls onApplied", async () => {
    const previewItems = [{ date: "2026-09-10", meal_slot: "dinner", name: "Chicken stir fry" }];
    vi.spyOn(api, "previewAiEdit").mockResolvedValue({
      created: [{ name: "Chicken stir fry" }],
      updated: [],
      deleted: [],
      items: previewItems,
    });
    const applySpy = vi.spyOn(api, "applyAiEdit").mockResolvedValue([{ id: 1, name: "Chicken stir fry" }]);
    const onApplied = vi.fn().mockResolvedValue(undefined);

    render(<AiEditBox resourceKey="meal-plan" primaryField="name" onApplied={onApplied} />);

    await userEvent.type(screen.getByPlaceholderText(/tell the ai/i), "add chicken stir fry");
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));
    await screen.findByText(/create 1/i);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(applySpy).toHaveBeenCalledWith("meal-plan", { items: previewItems })
    );
    await waitFor(() => expect(onApplied).toHaveBeenCalled());

    // The preview panel should be gone and the message input cleared after apply.
    expect(screen.queryByText(/create 1/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/tell the ai/i)).toHaveValue("");
  });

  it("discards the preview without calling applyAiEdit when Cancel is clicked", async () => {
    vi.spyOn(api, "previewAiEdit").mockResolvedValue({
      created: [],
      updated: [],
      deleted: [{ name: "Leftover soup" }],
      items: [],
    });
    const applySpy = vi.spyOn(api, "applyAiEdit");

    render(<AiEditBox resourceKey="meal-plan" primaryField="name" onApplied={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/tell the ai/i), "remove lunch");
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));
    await screen.findByText(/delete 1/i);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/delete 1/i)).not.toBeInTheDocument();
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("shows an error message when preview fails", async () => {
    vi.spyOn(api, "previewAiEdit").mockRejectedValue(
      new Error("AI editing is not configured: ANTHROPIC_API_KEY is not set.")
    );

    render(<AiEditBox resourceKey="meal-plan" primaryField="name" onApplied={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/tell the ai/i), "anything");
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ANTHROPIC_API_KEY");
  });

  it("shows 'No changes' when the preview is empty on all three counts", async () => {
    vi.spyOn(api, "previewAiEdit").mockResolvedValue({
      created: [], updated: [], deleted: [], items: [],
    });

    render(<AiEditBox resourceKey="meal-plan" primaryField="name" onApplied={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/tell the ai/i), "nothing to do here");
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));

    expect(await screen.findByText(/no changes/i)).toBeInTheDocument();
  });
});
```

Run it to verify it fails:

```bash
cd life-dashboard/frontend
npm test -- src/components/AiEditBox.test.jsx
```

Expected: FAIL — `Failed to resolve import "./AiEditBox"` (file doesn't exist yet).

- [ ] **Step 3: Write AiEditBox.jsx**

`life-dashboard/frontend/src/components/AiEditBox.jsx`:

```jsx
import { useState } from "react";
import { previewAiEdit, applyAiEdit } from "../api";

function describe(item, primaryField) {
  if (!item) return "";
  return item[primaryField] ?? `#${item.id ?? "?"}`;
}

export default function AiEditBox({ resourceKey, primaryField, onApplied }) {
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSuggest(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await previewAiEdit(resourceKey, { message });
      setPreview(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    setError(null);
    setLoading(true);
    try {
      await applyAiEdit(resourceKey, { items: preview.items });
      setPreview(null);
      setMessage("");
      await onApplied();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setPreview(null);
  }

  const hasNoChanges =
    preview && preview.created.length === 0 && preview.updated.length === 0 && preview.deleted.length === 0;

  return (
    <div className="ai-edit-box">
      <form onSubmit={handleSuggest} className="ai-edit-form">
        <input
          placeholder="Tell the AI what to change… e.g. swap Tuesday dinner for chicken"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={loading || !!preview}
        />
        <button type="submit" disabled={loading || !message || !!preview}>
          Suggest
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {preview && (
        <div className="ai-edit-preview">
          <h3>AI Preview</h3>
          {hasNoChanges && <p>No changes.</p>}
          {preview.created.length > 0 && (
            <p>
              ➕ Create {preview.created.length}: {preview.created.map((i) => describe(i, primaryField)).join(", ")}
            </p>
          )}
          {preview.updated.length > 0 && (
            <p>
              ✏️ Update {preview.updated.length}: {preview.updated.map((u) => describe(u.after, primaryField)).join(", ")}
            </p>
          )}
          {preview.deleted.length > 0 && (
            <p>
              🗑 Delete {preview.deleted.length}: {preview.deleted.map((i) => describe(i, primaryField)).join(", ")}
            </p>
          )}
          <div className="ai-edit-actions">
            <button type="button" onClick={handleCancel} disabled={loading}>
              Cancel
            </button>
            <button type="button" onClick={handleApply} disabled={loading}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- src/components/AiEditBox.test.jsx
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/frontend/src/api.js life-dashboard/frontend/src/components/AiEditBox.jsx \
  life-dashboard/frontend/src/components/AiEditBox.test.jsx
git commit -m "$(cat <<'EOF'
feat: add previewAiEdit/applyAiEdit API client and AiEditBox component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 5: Wire AiEditBox into the Meal Plan, Workout, and Reminder Pages

**Files:**
- Modify: `life-dashboard/frontend/src/resourceConfigs.js`
- Modify: `life-dashboard/frontend/src/components/ResourcePage.jsx`
- Modify: `life-dashboard/frontend/src/components/ResourcePage.test.jsx`
- Modify: `life-dashboard/frontend/src/App.jsx`
- Modify: `life-dashboard/frontend/src/App.css`

**Interfaces:**
- Consumes: `AiEditBox` (Task 4).
- Produces: the meal-plan, workouts, and reminders pages each render an `AiEditBox` above the manual form; the other 5 resource pages are unaffected.

- [ ] **Step 1: Add `aiEditable`/`primaryField` to the three AI-editable resources**

In `life-dashboard/frontend/src/resourceConfigs.js`, add two keys to the `meal-plan`, `workouts`, and `reminders` entries (leave every other entry and every `fields` array exactly as-is):

```js
  {
    key: "meal-plan",
    label: "Meal Plan",
    aiEditable: true,
    primaryField: "name",
    fields: [
      // ...unchanged...
    ],
  },
```

```js
  {
    key: "workouts",
    label: "Workouts",
    aiEditable: true,
    primaryField: "plan_text",
    fields: [
      // ...unchanged...
    ],
  },
```

```js
  {
    key: "reminders",
    label: "Reminders",
    aiEditable: true,
    primaryField: "text",
    fields: [
      // ...unchanged...
    ],
  },
```

- [ ] **Step 2: Write the failing test for ResourcePage's conditional AiEditBox rendering**

Add to `life-dashboard/frontend/src/components/ResourcePage.test.jsx` (the file already imports `render`, `screen`, `vi`, `api`, etc. — reuse those, don't re-import):

```jsx
it("renders AiEditBox when aiEditable is true", async () => {
  vi.spyOn(api, "listItems").mockResolvedValue([]);
  render(
    <ResourcePage
      resourceKey="meal-plan"
      label="Meal Plan"
      fields={fields}
      aiEditable={true}
      primaryField="name"
    />
  );
  expect(await screen.findByPlaceholderText(/tell the ai/i)).toBeInTheDocument();
});

it("does not render AiEditBox when aiEditable is not set", async () => {
  vi.spyOn(api, "listItems").mockResolvedValue([]);
  render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);
  await screen.findByText("Groceries");
  expect(screen.queryByPlaceholderText(/tell the ai/i)).not.toBeInTheDocument();
});
```

Run it to verify it fails:

```bash
cd life-dashboard/frontend
npm test -- src/components/ResourcePage.test.jsx
```

Expected: FAIL — the first new test can't find the placeholder text (AiEditBox isn't rendered yet).

- [ ] **Step 3: Wire AiEditBox into ResourcePage**

In `life-dashboard/frontend/src/components/ResourcePage.jsx`:

Add the import at the top:

```jsx
import AiEditBox from "./AiEditBox";
```

Change the function signature:

```jsx
export default function ResourcePage({ resourceKey, label, fields, aiEditable, primaryField }) {
```

Add the box right after the `<h1>{label}</h1>` line and before the `{error && (...)}` block:

```jsx
      {aiEditable && (
        <AiEditBox resourceKey={resourceKey} primaryField={primaryField} onApplied={refresh} />
      )}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- src/components/ResourcePage.test.jsx
```

Expected: PASS (all tests in the file, including the 2 new ones).

- [ ] **Step 5: Pass the new props through App.jsx**

In `life-dashboard/frontend/src/App.jsx`, change the `<ResourcePage ... />` element to also pass the two new fields:

```jsx
          <ResourcePage
            key={resource.key}
            resourceKey={resource.key}
            label={resource.label}
            fields={resource.fields}
            aiEditable={resource.aiEditable}
            primaryField={resource.primaryField}
          />
```

- [ ] **Step 6: Add CSS for the AI edit box**

Add to `life-dashboard/frontend/src/App.css`:

```css
.ai-edit-box {
  background: #f0f4ff;
  border: 1px solid #c7d6ff;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.ai-edit-form {
  display: flex;
  gap: 0.5rem;
}

.ai-edit-form input {
  flex: 1;
  padding: 0.5rem;
  font-size: 1rem;
}

.ai-edit-preview {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid #c7d6ff;
}

.ai-edit-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
```

- [ ] **Step 7: Run the full frontend test suite**

```bash
npm test
```

Expected: all tests pass across every file (api, App, Home, ResourcePage, AiEditBox).

- [ ] **Step 8: Run the full backend test suite too, to confirm this frontend-only task caused no backend drift**

```bash
cd ../backend
.venv/Scripts/pytest -v
```

Expected: all 60 tests pass, unaffected.

- [ ] **Step 9: Commit**

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/frontend/src/resourceConfigs.js life-dashboard/frontend/src/components/ResourcePage.jsx \
  life-dashboard/frontend/src/components/ResourcePage.test.jsx life-dashboard/frontend/src/App.jsx \
  life-dashboard/frontend/src/App.css
git commit -m "$(cat <<'EOF'
feat: wire the AI preview/confirm input into meal-plan, workouts, and reminders

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

## Note for whoever reviews this phase

No live Anthropic API call was made anywhere in this plan — same limitation as Phase 2a. Every backend test mocks `get_anthropic_client`, and the frontend tests mock `previewAiEdit`/`applyAiEdit` entirely, so the actual UX of typing a real message and getting a real preview back has not been exercised end-to-end. Before relying on this, do one real manual test with a real `ANTHROPIC_API_KEY` set: open the Meal Plan page, type something like "add chicken stir fry for Thursday dinner", confirm the preview looks right, click Apply, and confirm it actually saved.

## Next Plans (not part of this plan)

1. **Calendar integration** — Google Calendar API, then extend the AI-edit pattern (including preview/confirm) to events once cross-calendar conflict detection exists.
2. **External integrations** — ntfy for reminder delivery, package tracking API.
3. **Deployment** — Cloudflare Tunnel + Access wiring.
