from datetime import date, datetime, time
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel
from sqlalchemy.types import JSON as SAJSON, TypeDecorator
from sqlmodel import SQLModel, Field, Column, JSON


class Exercise(BaseModel):
    name: str
    sets: int
    reps: str
    # One bool per set, tracking whether that set's been done — always
    # `sets` long. The frontend pads/trims defensively rather than trusting
    # this stays in sync (e.g. if `sets` is edited after some were checked).
    completed: List[bool] = Field(default_factory=list)


class ExerciseListType(TypeDecorator):
    """Stores `List[Exercise]` as JSON.

    SQLAlchemy's plain JSON column calls `json.dumps` directly on whatever
    Python value is assigned, which fails on Pydantic model instances — this
    converts to/from plain dicts at the DB boundary so `Workout.exercises`
    can stay typed as `List[Exercise]` everywhere else (API schemas, AI
    structured output) without every read/write site doing that by hand.
    """

    impl = SAJSON
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        return [item.model_dump() if isinstance(item, BaseModel) else item for item in value]

    def process_result_value(self, value, dialect):
        if value is None:
            return []
        return [Exercise.model_validate(item) for item in value]


class DayOfWeek(str, Enum):
    mon = "mon"
    tue = "tue"
    wed = "wed"
    thu = "thu"
    fri = "fri"
    sat = "sat"
    sun = "sun"


class CalendarSource(str, Enum):
    self = "self"
    girlfriend = "girlfriend"
    school = "school"


class MealSlot(str, Enum):
    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    snack = "snack"


class Event(SQLModel, table=True):
    __tablename__ = "events"

    id: Optional[int] = Field(default=None, primary_key=True)
    source: CalendarSource
    title: str
    start: datetime
    end: datetime
    location: Optional[str] = None
    notes: Optional[str] = None
    color: Optional[str] = None


class CalendarFeed(SQLModel, table=True):
    __tablename__ = "calendar_feeds"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    url: str
    color: str = "#a55eea"


class MealPlanItem(SQLModel, table=True):
    __tablename__ = "meal_plan"

    id: Optional[int] = Field(default=None, primary_key=True)
    date: date
    meal_slot: MealSlot
    name: str
    ingredients: List[str] = Field(default_factory=list, sa_column=Column(JSON))


class GroceryItem(SQLModel, table=True):
    __tablename__ = "grocery_items"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    quantity: Optional[str] = None
    checked: bool = False
    week_of: date


class Workout(SQLModel, table=True):
    __tablename__ = "workouts"

    id: Optional[int] = Field(default=None, primary_key=True)
    date: date
    plan_text: str
    notes: Optional[str] = None
    exercises: List[Exercise] = Field(default_factory=list, sa_column=Column(ExerciseListType))


class WorkoutSchedule(SQLModel, table=True):
    """A recurring weekly training slot (e.g. "Mon 07:00, Strength").

    Deliberately not tied to specific dates: the calendar widget computes
    which days it lands on for whatever month is currently shown, the same
    way it treats subscribed external calendars, rather than materializing
    one-off Event rows that would need their own re-sync/cleanup logic.
    """

    __tablename__ = "workout_schedule"

    id: Optional[int] = Field(default=None, primary_key=True)
    day_of_week: DayOfWeek
    time: time
    label: str = "Workout"
    notes: Optional[str] = None


class Exam(SQLModel, table=True):
    __tablename__ = "exams"

    id: Optional[int] = Field(default=None, primary_key=True)
    subject: str
    date: date
    notes: Optional[str] = None


class Reminder(SQLModel, table=True):
    __tablename__ = "reminders"

    id: Optional[int] = Field(default=None, primary_key=True)
    text: str
    trigger_time: datetime
    sent: bool = False


class Package(SQLModel, table=True):
    __tablename__ = "packages"

    id: Optional[int] = Field(default=None, primary_key=True)
    tracking_number: str
    carrier: Optional[str] = None
    status: str = "unknown"
    last_updated: Optional[datetime] = None


class QuickLink(SQLModel, table=True):
    __tablename__ = "quick_links"

    id: Optional[int] = Field(default=None, primary_key=True)
    label: str
    url: str
