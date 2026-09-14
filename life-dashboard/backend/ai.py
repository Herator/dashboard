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
from backend.grocery_sync import get_week_start, sync_meal_plan_to_groceries
from backend.models import MealPlanItem

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
    extra_instructions: str = "",
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
        items: List[Dict[str, Any]]

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
            "entries outside that scope." + scope_note + (" " + extra_instructions if extra_instructions else "")
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

        # parsed_output can be None in narrow cases (e.g. an empty content
        # list) that neither the refusal check nor ValidationError catches;
        # reading .items off None would be an unhandled 500.
        parsed_output = getattr(response, "parsed_output", None)
        if parsed_output is None:
            raise HTTPException(
                status_code=502, detail="AI returned no usable response."
            )

        return parsed_output.items

    def _reconcile(session: Session, existing, returned_items, commit: bool, message: Optional[str] = None):
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
            # Deletions are how the AI expresses "remove this", so a bad
            # response can quietly wipe rows. Leave a paper trail naming what
            # was deleted and which request caused it.
            if message is not None:
                logger.warning(
                    "AI-edit deleting %d row(s) from %s: ids=%s (user message: %r)",
                    len(stale_ids),
                    tag,
                    sorted(stale_ids),
                    message,
                )
            else:
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
            # exclude_unset: the AI-item schema legitimately allows optional
            # fields to be omitted from the model's JSON, and an omitted field
            # would otherwise come back as its default and overwrite whatever
            # was stored (e.g. wiping Workout.notes, or resetting Reminder.sent
            # back to False). Matches the PUT handler's semantics in crud.py.
            # On the create path, anything omitted here simply falls back to the
            # SQLModel field's own default at construction time.
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
        _, _, _, result_rows = _reconcile(
            session, existing, returned_items, commit=True, message=body.message
        )
        return result_rows

    @router.post("/ai-edit/preview", response_model=AiEditPreviewResponse)
    def ai_edit_preview(
        body: AiEditRequest,
        session: Session = Depends(get_session),
        client: anthropic.Anthropic = Depends(get_anthropic_client),
    ):
        existing, scope_note = _scoped_existing(body.date_from, body.date_to, session)
        returned_items = _ask_claude(client, body.message, existing, scope_note)
        created, updated, deleted, _ = _reconcile(session, existing, returned_items, commit=False)
        items = [
            item.model_dump(mode="json", exclude_unset=True) for item in returned_items
        ]
        return AiEditPreviewResponse(
            created=created, updated=updated, deleted=deleted, items=items
        )

    @router.post("/ai-edit/apply", response_model=List[model])
    def ai_edit_apply(
        body: ApplyRequest,
        session: Session = Depends(get_session),
    ):
        existing, _ = _scoped_existing(body.date_from, body.date_to, session)
        _, _, _, result_rows = _reconcile(session, existing, body.items, commit=True)
        if model is MealPlanItem:
            weeks = {get_week_start(row.date) for row in result_rows}
            for week in weeks:
                # The meal-plan mutation already committed in _reconcile; a
                # sync failure must not turn success into a 500 (the client
                # would retry and duplicate meals), so log and continue.
                try:
                    sync_meal_plan_to_groceries(session, week)
                except Exception:
                    logger.exception(
                        "grocery sync failed for week %s after meal-plan apply; continuing",
                        week,
                    )
            for row in result_rows:
                session.refresh(row)  # sync's commit expired the rows
        return result_rows

    return router
