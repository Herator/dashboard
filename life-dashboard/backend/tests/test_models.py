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
    Exam,
    Reminder,
    Package,
    QuickLink,
)


# Table names are pinned by the spec (life-dashboard-spec.md section 6). They are
# not derivable from the class names, so an explicit __tablename__ is required on
# every model and must not drift.
EXPECTED_TABLE_NAMES = {
    Event: "events",
    MealPlanItem: "meal_plan",
    GroceryItem: "grocery_items",
    Workout: "workouts",
    Exam: "exams",
    Reminder: "reminders",
    Package: "packages",
    QuickLink: "quick_links",
}


def test_table_names_match_the_spec():
    actual = {model.__name__: model.__tablename__ for model in EXPECTED_TABLE_NAMES}
    expected = {model.__name__: name for model, name in EXPECTED_TABLE_NAMES.items()}
    assert actual == expected


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
        exam = Exam(subject="Calculus", date=date(2026, 10, 1))
        reminder = Reminder(text="Text girlfriend", trigger_time=datetime(2026, 9, 10, 18, 0))
        package = Package(tracking_number="1Z999AA10123456784", carrier="ups")
        link = QuickLink(label="Immich", url="https://photos.example.com")

        session.add_all(
            [event, meal, grocery, workout, exam, reminder, package, link]
        )
        session.commit()

        for obj in (event, meal, grocery, workout, exam, reminder, package, link):
            session.refresh(obj)
            assert obj.id is not None

        assert meal.ingredients == ["chicken", "soy sauce", "broccoli"]
