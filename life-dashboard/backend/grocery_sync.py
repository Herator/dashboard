import logging
from datetime import date, timedelta
from typing import List

from sqlmodel import Session, select

from backend.models import GroceryItem, MealPlanItem

logger = logging.getLogger(__name__)


def get_week_start(d: date) -> date:
    """Return the Monday of the week containing ``d``."""
    return d - timedelta(days=d.weekday())


def sync_week_for_meal(session: Session, meal) -> None:
    """Sync the groceries for the week of a single meal (CRUD post-mutation hook).

    The meal mutation has already been committed by the caller. A sync failure
    must not turn that success into a 500 (the client would retry and
    duplicate the meal), so it is logged and swallowed.
    """
    if meal is None or getattr(meal, "date", None) is None:
        return
    try:
        sync_meal_plan_to_groceries(session, get_week_start(meal.date))
    except Exception:
        logger.exception(
            "grocery sync failed for meal %r (id=%s); meal already committed, skipping",
            getattr(meal, "name", None),
            getattr(meal, "id", None),
        )


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
        for raw in (item.ingredients or []):
            ing = raw.strip()
            if not ing:
                continue
            key = ing.casefold()
            if key in seen:
                continue
            seen.add(key)
            ingredients.append(ing)

    existing = {
        g.name.strip().casefold(): g
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
