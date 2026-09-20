import logging
from datetime import date, timedelta
from typing import List, Optional, Tuple

from sqlmodel import Session, select

from backend.models import GroceryItem, MealPlanItem

logger = logging.getLogger(__name__)


def get_week_start(d: date) -> date:
    """Return the Monday of the week containing ``d``."""
    return d - timedelta(days=d.weekday())


# Mirrors the keyword map in GroceryPage.jsx's client-side `categorize()`,
# used there for manual adds. Kept here too since meal-plan-synced items are
# created server-side, with no client step to categorize them.
CATEGORY_KEYWORDS = [
    (["spinat", "tomat", "salat", "løk", "hvitløk", "paprika", "gulrot", "potet", "eple", "banan", "agurk"], "Grønt"),
    (["melk", "ost", "yoghurt", "smør", "egg", "fløte"], "Meieri"),
    (["kylling", "biff", "svin", "kalkun", "bacon", "pølse", "laks", "reker"], "Kjøtt"),
    (["brød", "bagel", "lompe"], "Bakevarer"),
    (["ris", "pasta", "bønner", "mel", "sukker", "olje", "saus", "frokostblanding", "havregryn", "buljong"], "Tørrvarer"),
    (["frossen", "frossent", "is", "pizza"], "Frossent"),
]


def categorize(name: str) -> str:
    n = name.lower()
    for words, cat in CATEGORY_KEYWORDS:
        if any(w in n for w in words):
            return cat
    return "Annet"


def _last_known_price_weight(session: Session, name: str) -> Tuple[Optional[str], Optional[str]]:
    """Most recent price/weight logged for an item of this name, if any."""
    key = name.strip().casefold()
    if not key:
        return None, None
    matches = [
        g
        for g in session.exec(select(GroceryItem)).all()
        if g.name.strip().casefold() == key and (g.price or g.weight)
    ]
    if not matches:
        return None, None
    best = max(matches, key=lambda g: (g.week_of, g.id))
    return best.price, best.weight


def apply_known_price_weight(session: Session, item: GroceryItem) -> bool:
    """Fill ``item.price``/``item.weight`` from the last time this item was
    bought, when the field is still empty. Returns whether anything changed
    — the caller commits, this only mutates the in-memory row.
    """
    if item.price and item.weight:
        return False
    price, weight = _last_known_price_weight(session, item.name)
    changed = False
    if not item.price and price:
        item.price = price
        changed = True
    if not item.weight and weight:
        item.weight = weight
        changed = True
    return changed


def fill_price_weight_hook(session: Session, item: GroceryItem) -> None:
    """CRUD post_mutation_hook: auto-fill price/weight on create/update.

    Guards against the delete case (the hook still fires with the
    now-deleted row) by checking the row still exists before writing to it.
    """
    if session.get(GroceryItem, item.id) is None:
        return
    if apply_known_price_weight(session, item):
        session.add(item)
        session.commit()
        session.refresh(item)


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
        item = GroceryItem(name=ing, week_of=week_start, checked=False, quantity=None, category=categorize(ing))
        apply_known_price_weight(session, item)
        session.add(item)
        added.append(item)

    session.commit()
    for item in added:
        session.refresh(item)
    return added
