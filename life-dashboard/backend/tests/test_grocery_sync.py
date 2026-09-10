from datetime import date, timedelta

from sqlmodel import Session, select

from backend.grocery_sync import get_week_start, sync_meal_plan_to_groceries
from backend.models import GroceryItem, MealPlanItem, MealSlot


def test_get_week_start():
    assert get_week_start(date(2026, 9, 7)) == date(2026, 9, 7)  # Monday
    assert get_week_start(date(2026, 9, 10)) == date(2026, 9, 7)  # mid-week
    assert get_week_start(date(2026, 9, 13)) == date(2026, 9, 7)  # Sunday


def test_sync_meal_plan_to_groceries_creates_missing_items(session: Session):
    week = date(2026, 9, 7)
    session.add_all(
        [
            MealPlanItem(
                date=date(2026, 9, 9),
                meal_slot=MealSlot.dinner,
                name="Stir fry",
                ingredients=[" chicken ", "soy sauce", ""],
            ),
            MealPlanItem(
                date=date(2026, 9, 11),
                meal_slot=MealSlot.lunch,
                name="Soup",
                ingredients=["chicken", "broccoli"],
            ),
        ]
    )
    session.commit()

    added = sync_meal_plan_to_groceries(session, week)

    names = {g.name for g in added}
    assert names == {"chicken", "soy sauce", "broccoli"}
    assert all(g.week_of == week and not g.checked and g.quantity is None for g in added)


def test_sync_meal_plan_preserves_existing_and_checked_items(session: Session):
    week = date(2026, 9, 14)
    session.add_all(
        [
            MealPlanItem(
                date=date(2026, 9, 16),
                meal_slot=MealSlot.dinner,
                name="Pasta",
                ingredients=["tomato", "pasta"],
            ),
            GroceryItem(name="Tomato", week_of=week, checked=True),
            GroceryItem(name="Manual add", week_of=week, checked=False),
        ]
    )
    session.commit()

    added = sync_meal_plan_to_groceries(session, week)

    assert [g.name for g in added] == ["pasta"]

    all_items = session.exec(
        select(GroceryItem).where(GroceryItem.week_of == week)
    ).all()
    assert len(all_items) == 3
    by_name = {g.name: g for g in all_items}
    assert by_name["Tomato"].checked is True
    assert by_name["Tomato"].quantity is None  # pre-existing item untouched
    assert by_name["Manual add"].name == "Manual add"


def test_sync_meal_plan_endpoint(client, session: Session):
    session.add(
        MealPlanItem(
            date=date(2026, 9, 8),
            meal_slot=MealSlot.dinner,
            name="Pasta",
            ingredients=["Noodles", "Marinara"],
        )
    )
    session.commit()

    response = client.post("/api/groceries/sync-meal-plan?week_of=2026-09-08")
    assert response.status_code == 200
    body = response.json()
    assert body["week_of"] == "2026-09-07"
    assert {item["name"] for item in body["added"]} == {"Noodles", "Marinara"}

    response = client.post("/api/groceries/sync-meal-plan")
    assert response.status_code == 200
    body = response.json()
    expected = date.today() - timedelta(days=date.today().weekday())
    assert body["week_of"] == expected.isoformat()


def test_create_meal_plan_auto_syncs_groceries(client, session: Session):
    resp = client.post(
        "/api/meal-plan/",
        json={
            "date": "2026-09-08",
            "meal_slot": "dinner",
            "name": "Burger",
            "ingredients": ["Patty", "Buns"],
        },
    )
    assert resp.status_code == 200  # existing CRUD create returns 200 with the row, not 201
    groceries = client.get("/api/groceries/").json()
    names = {g["name"] for g in groceries}
    assert "Patty" in names
    assert "Buns" in names


def test_update_meal_plan_auto_syncs_new_ingredients(client, session: Session):
    created = client.post(
        "/api/meal-plan/",
        json={
            "date": "2026-09-08",
            "meal_slot": "dinner",
            "name": "Burger",
            "ingredients": ["Patty"],
        },
    ).json()
    resp = client.put(
        f"/api/meal-plan/{created['id']}",
        json={"ingredients": ["Patty", "Cheese"]},
    )
    assert resp.status_code == 200
    groceries = client.get("/api/groceries/").json()
    names = {g["name"] for g in groceries}
    assert "Patty" in names
    assert "Cheese" in names


def test_ai_apply_meal_plan_auto_syncs_groceries(client, session: Session):
    resp = client.post(
        "/api/meal-plan/ai-edit/apply",
        json={
            "items": [
                {
                    "date": "2026-09-09",
                    "meal_slot": "dinner",
                    "name": "Pizza",
                    "ingredients": ["Dough", "Mozzarella"],
                }
            ]
        },
    )
    assert resp.status_code == 200
    groceries = client.get("/api/groceries/").json()
    names = {g["name"] for g in groceries}
    assert "Dough" in names
    assert "Mozzarella" in names