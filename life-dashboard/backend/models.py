from datetime import date, datetime
from enum import Enum
from typing import List, Optional

from sqlmodel import SQLModel, Field, Column, JSON


class CalendarSource(str, Enum):
    self = "self"
    girlfriend = "girlfriend"
    school = "school"


class MealSlot(str, Enum):
    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    snack = "snack"


class AssignmentStatus(str, Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    done = "done"


class Event(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    source: CalendarSource
    title: str
    start: datetime
    end: datetime
    location: Optional[str] = None
    notes: Optional[str] = None


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
    id: Optional[int] = Field(default=None, primary_key=True)
    date: date
    plan_text: str
    notes: Optional[str] = None


class Assignment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    course: str
    due_date: date
    status: AssignmentStatus = AssignmentStatus.not_started
    notes: Optional[str] = None


class Exam(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    subject: str
    date: date
    notes: Optional[str] = None


class Reminder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    text: str
    trigger_time: datetime
    sent: bool = False


class Package(SQLModel, table=True):
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
