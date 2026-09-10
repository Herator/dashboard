import os
from datetime import date

from fastapi import Depends, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from backend.ai import make_ai_edit_router
from backend.crud import make_crud_router
from backend.database import get_session, init_db
from backend.grocery_sync import get_week_start, sync_meal_plan_to_groceries
from backend.models import (
    Event,
    MealPlanItem,
    GroceryItem,
    Workout,
    Assignment,
    Exam,
    Reminder,
    Package,
    QuickLink,
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


app.include_router(make_crud_router(Event, "/api/events", "events"))
app.include_router(make_crud_router(MealPlanItem, "/api/meal-plan", "meal-plan"))
app.include_router(
    make_ai_edit_router(MealPlanItem, "/api/meal-plan", "meal-plan-ai", "meal plan", scope_field="date")
)
app.include_router(make_crud_router(GroceryItem, "/api/groceries", "groceries"))
app.include_router(make_crud_router(Workout, "/api/workouts", "workouts"))
app.include_router(
    make_ai_edit_router(Workout, "/api/workouts", "workouts-ai", "workout plan", scope_field="date")
)
app.include_router(make_crud_router(Assignment, "/api/assignments", "assignments"))
app.include_router(make_crud_router(Exam, "/api/exams", "exams"))
app.include_router(make_crud_router(Reminder, "/api/reminders", "reminders"))
app.include_router(
    make_ai_edit_router(Reminder, "/api/reminders", "reminders-ai", "reminders")
)
app.include_router(make_crud_router(Package, "/api/packages", "packages"))
app.include_router(make_crud_router(QuickLink, "/api/quick-links", "quick-links"))


@app.post("/api/groceries/sync-meal-plan")
def sync_meal_plan(
    week_of: date | None = Query(default=None),
    session: Session = Depends(get_session),
):
    week_start = get_week_start(week_of or date.today())
    added = sync_meal_plan_to_groceries(session, week_start)
    return {"added": added, "week_of": week_start}


@app.get("/health")
def health():
    return {"status": "ok"}
