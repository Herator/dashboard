from datetime import date, datetime

from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

from backend.models import (
    Event,
    CalendarSource,
    MealPlanItem,
    MealSlot,
    GroceryItem,
    Workout,
    Assignment,
    AssignmentStatus,
    Exam,
    Reminder,
    Package,
    QuickLink,
)


def make_test_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_all_models_round_trip_through_sqlite():
    engine = make_test_engine()
    with Session(engine) as session:
        event = Event(
            source=CalendarSource.self,
            title="Golf",
            start=datetime(2026, 9, 10, 11, 50),
            end=datetime(2026, 9, 10, 13, 0),
        )
        meal = MealPlanItem(
            date=date(2026, 9, 10),
            meal_slot=MealSlot.dinner,
            name="Chicken stir fry",
            ingredients=["chicken", "soy sauce", "broccoli"],
        )
        grocery = GroceryItem(name="Chicken", quantity="2 lb", week_of=date(2026, 9, 8))
        workout = Workout(date=date(2026, 9, 10), plan_text="Rest day")
        assignment = Assignment(
            title="Essay 1",
            course="ENG101",
            due_date=date(2026, 9, 20),
            status=AssignmentStatus.not_started,
        )
        exam = Exam(subject="Calculus", date=date(2026, 10, 1))
        reminder = Reminder(text="Text girlfriend", trigger_time=datetime(2026, 9, 10, 18, 0))
        package = Package(tracking_number="1Z999AA10123456784", carrier="ups")
        link = QuickLink(label="Immich", url="https://photos.example.com")

        session.add_all(
            [event, meal, grocery, workout, assignment, exam, reminder, package, link]
        )
        session.commit()

        for obj in (event, meal, grocery, workout, assignment, exam, reminder, package, link):
            session.refresh(obj)
            assert obj.id is not None

        assert meal.ingredients == ["chicken", "soy sauce", "broccoli"]
