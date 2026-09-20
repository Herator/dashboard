import json
import logging
import os
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Type
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from pydantic import BaseModel, create_model
from sqlmodel import Session, SQLModel, select

from backend.crud import build_input_model
from backend.database import get_session
from backend.grocery_sync import get_week_start, sync_meal_plan_to_groceries
from backend.models import Event, FilamentSpool, GroceryItem, MealPlanItem, MealPreferences, Reminder, Workout

logger = logging.getLogger(__name__)

# `or` rather than a `.get` default: an env var set to the empty string (which
# is what copying .env.example verbatim used to produce) is still "set", so a
# plain default would leave the model id as "" and send that to the API.
AI_MODEL_ID = os.environ.get("AI_MODEL_ID") or "gemini-flash-lite-latest"

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


# The container runs with no TZ configured (Docker base images default to
# UTC), so bare date.today()/datetime.now() drift a day off Oslo's actual
# local date for a few hours around midnight (UTC+1/+2 depending on DST).
# Same fix weather.py already applies to MET's timestamps, applied here to
# "what day is it" instead.
LOCAL_TZ = ZoneInfo("Europe/Oslo")


def _local_today() -> date:
    return datetime.now(LOCAL_TZ).date()


def _current_week_bounds() -> tuple[date, date]:
    today = _local_today()
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
    "calendar": AiEditConfig(
        Event, "calendar event", scope_field="start", primary_field="title"
    ),
    "groceries": AiEditConfig(
        GroceryItem, "grocery list", scope_field="week_of", primary_field="name"
    ),
    "filament": AiEditConfig(FilamentSpool, "filament spool", primary_field="color_name"),
    # Singleton row (id=1, see MealPreferences docstring) — the generic
    # create/update/delete reconciliation still applies, just always against
    # that one row: the AI is shown it, must echo its `id` back to change it,
    # and an update is the only outcome the request should ever produce.
    "meal-preferences": AiEditConfig(MealPreferences, "food likes/dislikes", primary_field="likes"),
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
        # A datetime-typed scope column (e.g. Event.start) needs a half-open
        # upper bound one day later: comparing it against a bare `date`
        # (midnight of that day) would silently exclude the rest of the
        # last day, even though the scope note below promises it's included.
        # date-typed columns are untouched, so their query stays byte-identical.
        field_type = config.model.model_fields[config.scope_field].annotation
        if field_type is datetime:
            query = query.where(column >= resolved_from, column < resolved_to + timedelta(days=1))
        else:
            query = query.where(column >= resolved_from, column <= resolved_to)
        scope_note = (
            f" You are only shown, and may only update or delete, existing "
            f"entries with {config.scope_field} between {resolved_from.isoformat()} "
            f"and {resolved_to.isoformat()} inclusive — a new entry you create for "
            f"this request is not limited to that range; give it whatever "
            f"{config.scope_field} the request actually specifies."
        )
    return session.exec(query).all(), scope_note


def _meal_preference_note(session: Session) -> str:
    """Extra system-prompt text steering meal-plan suggestions around the
    user's stored likes/dislikes. Empty once nothing's been recorded."""
    prefs = session.get(MealPreferences, 1)
    if prefs is None or (not prefs.likes and not prefs.dislikes):
        return ""
    parts = []
    if prefs.likes:
        parts.append(f"likes: {', '.join(prefs.likes)}")
    if prefs.dislikes:
        parts.append(f"dislikes (avoid these): {', '.join(prefs.dislikes)}")
    return " The user's food preferences — " + "; ".join(parts) + " — should inform any meal you suggest or create."


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
    today = _local_today()
    system_prompt = (
        f"Today is {today.isoformat()} ({today.strftime('%A')}). Resolve relative "
        "dates/times in the request (\"tomorrow\", \"next Tuesday\", \"in 3 days\") "
        "against this date — never guess or use a different date.\n\n"
        f"You are the AI editing assistant for the {config.resource_label} feature of a "
        "personal life dashboard. You will be given the user's current entries as "
        "a JSON array (each has an `id`) and a natural-language request describing "
        "a change. Return the complete updated array of entries reflecting the "
        "request: keep entries unchanged (with their original `id`) unless the "
        "request modifies them, modify entries the request refers to (preserve "
        "their `id`), omit entries the request asks to delete, and add new "
        "entries with `id` set to null for anything new the request asks to "
        "create — a new entry's date/time is whatever the request specifies, "
        "not limited to the range described below (that range only bounds "
        "which *existing* entries you were shown and can update or delete). "
        "Never invent an existing entry (a real, non-null `id`) you weren't given."
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
        # Deletions are how the AI expresses "remove this", so a bad
        # response can quietly wipe rows. Leave a paper trail naming what
        # was deleted and which request caused it.
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
        client: genai.Client = Depends(get_ai_client),
    ):
        existing, scope_note = _scoped_existing(config, body.date_from, body.date_to, session)
        if resource_key == "meal-plan":
            scope_note += _meal_preference_note(session)
        returned_items = _ask_ai(client, config, body.message, existing, scope_note)
        _, _, _, result_rows = _reconcile(
            config, session, existing, returned_items, commit=True, message=body.message
        )
        return result_rows

    @router.post("/ai-edit/preview", response_model=AiEditPreviewResponse)
    def ai_edit_preview(
        body: AiEditRequest,
        session: Session = Depends(get_session),
        client: genai.Client = Depends(get_ai_client),
    ):
        existing, scope_note = _scoped_existing(config, body.date_from, body.date_to, session)
        if resource_key == "meal-plan":
            scope_note += _meal_preference_note(session)
        returned_items = _ask_ai(client, config, body.message, existing, scope_note)
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


class RecipeStepsResponse(BaseModel):
    steps: List[str]


def make_meal_recipe_router() -> APIRouter:
    """One-off endpoint (not part of RESOURCE_REGISTRY): generates cooking
    steps for a meal on demand. Steps aren't stored on MealPlanItem, so
    there's nothing to keep in sync — the client re-requests them each time
    a recipe dialog opens."""
    router = APIRouter(prefix="/api/meal-plan", tags=["meal-plan-ai"])

    @router.post("/{item_id}/recipe", response_model=RecipeStepsResponse)
    def recipe_steps(
        item_id: int,
        session: Session = Depends(get_session),
        client: genai.Client = Depends(get_ai_client),
    ):
        item = session.get(MealPlanItem, item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Meal not found.")
        ingredients_note = f" using {', '.join(item.ingredients)}" if item.ingredients else ""
        try:
            response = client.models.generate_content(
                model=AI_MODEL_ID,
                contents=(
                    f"Give concise numbered cooking steps for preparing "
                    f"'{item.name}'{ingredients_note}. 3-6 short steps."
                ),
                config=genai_types.GenerateContentConfig(
                    max_output_tokens=1024,
                    response_mime_type="application/json",
                    response_schema=RecipeStepsResponse,
                ),
            )
        except genai_errors.APIError as exc:
            raise HTTPException(status_code=502, detail=f"AI request failed: {exc}")

        parsed = getattr(response, "parsed", None)
        if parsed is None:
            raise HTTPException(status_code=502, detail="AI returned no usable response.")
        return parsed

    return router
