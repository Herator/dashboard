from datetime import date, timedelta
from typing import List

from sqlmodel import Session, select

from backend.models import GroceryItem, MealPlanItem


def get_week_start(d: date) -> date:
    """Return the Monday of the week containing ``d``."""
    return d - timedelta(days=d.weekday())


def sync_meal_plan_to_groceries(session: Session, week_start: date) -> List[GroceryItem]:
    """Create GroceryItem rows for meal-plan ingredients missing for ``week_start``'s week.

    Returns the newly added GroceryItem objects. Existing manual and checked
    items for the week are left untouched.
    """
    week_end = week_start + timedelta(days=6)
    meal_items = session.exec(
        select(MealPlanItem).where(
            MealPlanItem.date >= week_start, MealPlanItem.date <= week_end
        )
    ).all()

    ingredients: List[str] = []
    seen: set = set()
    for item in meal_items:
        for raw in item.ingredients:
            ing = raw.strip()
            if not ing:
                continue
            key = ing.casefold()
            if key in seen:
                continue
            seen.add(key)
            ingredients.append(ing)

    existing = {
        g.name.casefold(): g
        for g in session.exec(
            select(GroceryItem).where(GroceryItem.week_of == week_start)
        ).all()
    }

    added: List[GroceryItem] = []
    for ing in ingredients:
        if ing.casefold() in existing:
            continue
        item = GroceryItem(name=ing, week_of=week_start, checked=False, quantity=None)
        session.add(item)
        added.append(item)

    session.commit()
    for item in added:
        session.refresh(item)
    return added