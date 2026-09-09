from fastapi import FastAPI

from backend.crud import make_crud_router
from backend.database import init_db
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


@app.on_event("startup")
def on_startup():
    init_db()


app.include_router(make_crud_router(Event, "/api/events", "events"))
app.include_router(make_crud_router(MealPlanItem, "/api/meal-plan", "meal-plan"))
app.include_router(make_crud_router(GroceryItem, "/api/groceries", "groceries"))
app.include_router(make_crud_router(Workout, "/api/workouts", "workouts"))
app.include_router(make_crud_router(Assignment, "/api/assignments", "assignments"))
app.include_router(make_crud_router(Exam, "/api/exams", "exams"))
app.include_router(make_crud_router(Reminder, "/api/reminders", "reminders"))
app.include_router(make_crud_router(Package, "/api/packages", "packages"))
app.include_router(make_crud_router(QuickLink, "/api/quick-links", "quick-links"))


@app.get("/health")
def health():
    return {"status": "ok"}
