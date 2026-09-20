import os
from datetime import date

from fastapi import Depends, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import Session

from backend.routers.ai import _local_today, make_ai_edit_router, make_meal_recipe_router
from backend.crud import make_crud_router
from backend.database import get_session, init_db
from backend.grocery_sync import (
    get_week_start,
    sync_meal_plan_to_groceries,
    sync_week_for_meal,
)
from backend.routers import weather
from backend.routers import calendar_feeds
from backend.routers import printer
from backend.routers import voice
from backend.models import (
    Event,
    MealPlanItem,
    MealPreferences,
    GroceryItem,
    Workout,
    WorkoutSchedule,
    Exam,
    Reminder,
    Package,
    QuickLink,
    FilamentSpool,
)

app = FastAPI(title="Life Dashboard API")

app.add_middleware(
    CORSMiddleware,
    # `or` rather than a `.get` default: an env var set to the empty string is
    # still "set", and allow_origins=[""] would block every real origin.
    allow_origins=[os.environ.get("FRONTEND_ORIGIN") or "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


class MealPreferencesPayload(BaseModel):
    likes: list[str] = []
    dislikes: list[str] = []


def _get_or_create_meal_preferences(session: Session) -> MealPreferences:
    prefs = session.get(MealPreferences, 1)
    if prefs is None:
        prefs = MealPreferences(id=1)
        session.add(prefs)
        session.commit()
        session.refresh(prefs)
    return prefs


# Registered before the meal-plan CRUD router below: both define a route
# shaped `/api/meal-plan/<single segment>`, and Starlette matches route
# patterns in registration order, not by specificity — placed after,
# `/api/meal-plan/{item_id}` (item_id: int) would claim `.../preferences`
# first and 422 rather than ever reaching these.
@app.get("/api/meal-plan/preferences", response_model=MealPreferences)
def get_meal_preferences(session: Session = Depends(get_session)):
    return _get_or_create_meal_preferences(session)


@app.put("/api/meal-plan/preferences", response_model=MealPreferences)
def update_meal_preferences(
    payload: MealPreferencesPayload, session: Session = Depends(get_session)
):
    prefs = _get_or_create_meal_preferences(session)
    prefs.likes = payload.likes
    prefs.dislikes = payload.dislikes
    session.add(prefs)
    session.commit()
    session.refresh(prefs)
    return prefs


app.include_router(make_crud_router(Event, "/api/events", "events"))
app.include_router(
    make_crud_router(
        MealPlanItem,
        "/api/meal-plan",
        "meal-plan",
        post_mutation_hook=sync_week_for_meal,
    )
)
app.include_router(make_ai_edit_router("meal-plan", "/api/meal-plan", "meal-plan-ai"))
app.include_router(make_meal_recipe_router())
app.include_router(make_crud_router(GroceryItem, "/api/groceries", "groceries"))
app.include_router(make_crud_router(Workout, "/api/workouts", "workouts"))
app.include_router(make_ai_edit_router("workouts", "/api/workouts", "workouts-ai"))
app.include_router(make_crud_router(WorkoutSchedule, "/api/workout-schedule", "workout-schedule"))
app.include_router(make_crud_router(Exam, "/api/exams", "exams"))
app.include_router(make_crud_router(Reminder, "/api/reminders", "reminders"))
app.include_router(make_ai_edit_router("reminders", "/api/reminders", "reminders-ai"))
app.include_router(make_ai_edit_router("calendar", "/api/events", "events-ai"))
app.include_router(make_ai_edit_router("groceries", "/api/groceries", "groceries-ai"))
app.include_router(make_ai_edit_router("filament", "/api/filament", "filament-ai"))
app.include_router(make_crud_router(Package, "/api/packages", "packages"))
app.include_router(make_crud_router(QuickLink, "/api/quick-links", "quick-links"))
app.include_router(make_crud_router(FilamentSpool, "/api/filament", "filament"))
app.include_router(weather.router)
app.include_router(calendar_feeds.crud_router)
app.include_router(calendar_feeds.events_router)
app.include_router(printer.router)
app.include_router(voice.router)


@app.post("/api/groceries/sync-meal-plan")
def sync_meal_plan(
    week_of: date | None = Query(default=None),
    session: Session = Depends(get_session),
):
    week_start = get_week_start(week_of or _local_today())
    added = sync_meal_plan_to_groceries(session, week_start)
    return {"added": added, "week_of": week_start}


@app.get("/health")
def health():
    return {"status": "ok"}
