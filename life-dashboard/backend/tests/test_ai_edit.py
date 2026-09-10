from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.database import get_session
from backend.main import app


def make_mock_anthropic_client(parsed_items, stop_reason="end_turn"):
    """Build a fake Anthropic client whose messages.parse() returns a
    canned parsed result, so tests never make a real network call."""
    mock_client = MagicMock()
    mock_response = SimpleNamespace(
        parsed_output=SimpleNamespace(items=parsed_items),
        stop_reason=stop_reason,
    )
    mock_client.messages.parse.return_value = mock_response
    return mock_client


def test_ai_edit_creates_a_new_meal_plan_item(client, session):
    from backend.ai import get_anthropic_client

    # ItemSchema instances are duck-typed here via SimpleNamespace with the
    # fields the endpoint reads: id, date, meal_slot, name, ingredients.
    new_item = SimpleNamespace(
        id=None,
        date=date(2026, 9, 10),
        meal_slot="dinner",
        name="Chicken stir fry",
        ingredients=["chicken", "soy sauce"],
        model_dump=lambda exclude=None: {
            "date": date(2026, 9, 10),
            "meal_slot": "dinner",
            "name": "Chicken stir fry",
            "ingredients": ["chicken", "soy sauce"],
        },
    )
    mock_client = make_mock_anthropic_client([new_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit",
        json={"message": "add chicken stir fry for dinner Thursday"},
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "Chicken stir fry"
    assert body[0]["id"] is not None

    # Verify the system prompt mentioned the scope and the raw request reached the mock
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    assert "meal plan" in call_kwargs["system"].lower()
    assert "add chicken stir fry for dinner Thursday" in call_kwargs["messages"][0]["content"]


def test_ai_edit_updates_an_existing_item_by_id(client, session):
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    existing = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.dinner, name="Old dinner", ingredients=[]
    )
    session.add(existing)
    session.commit()
    session.refresh(existing)

    updated_item = SimpleNamespace(
        id=existing.id,
        date=date(2026, 9, 10),
        meal_slot="dinner",
        name="Chicken stir fry",
        ingredients=["chicken"],
        model_dump=lambda exclude=None: {
            "date": date(2026, 9, 10),
            "meal_slot": "dinner",
            "name": "Chicken stir fry",
            "ingredients": ["chicken"],
        },
    )
    mock_client = make_mock_anthropic_client([updated_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit",
        json={"message": "swap Tuesday's old dinner for chicken stir fry"},
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["id"] == existing.id
    assert body[0]["name"] == "Chicken stir fry"


def test_ai_edit_deletes_items_omitted_from_the_response(client, session):
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    to_delete = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.lunch, name="Leftover soup", ingredients=[]
    )
    session.add(to_delete)
    session.commit()
    session.refresh(to_delete)

    mock_client = make_mock_anthropic_client([])  # AI returned an empty list: delete everything in scope
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit",
        json={"message": "remove Tuesday's lunch"},
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json() == []

    list_resp = client.get("/api/meal-plan/")
    assert list_resp.json() == []


def test_ai_edit_scopes_to_the_requested_date_range(client, session):
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    in_scope = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.dinner, name="In scope", ingredients=[]
    )
    out_of_scope = MealPlanItem(
        date=date(2026, 9, 20), meal_slot=MealSlot.dinner, name="Out of scope", ingredients=[]
    )
    session.add_all([in_scope, out_of_scope])
    session.commit()

    mock_client = make_mock_anthropic_client([])  # returning nothing in scope
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit",
        json={
            "message": "clear this week",
            "date_from": "2026-09-07",
            "date_to": "2026-09-13",
        },
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    # Only the in-scope item should have been visible to delete; the
    # out-of-scope item must survive untouched.
    remaining = client.get("/api/meal-plan/").json()
    assert len(remaining) == 1
    assert remaining[0]["name"] == "Out of scope"


def test_ai_edit_returns_502_on_anthropic_api_error(client, session):
    import anthropic

    from backend.ai import get_anthropic_client

    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = anthropic.APIConnectionError(request=MagicMock())
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit", json={"message": "anything"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 502
