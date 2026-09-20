from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.models import MealPlanItem, MealSlot
from backend.routers.ai import get_ai_client
from backend.main import app


def make_mock_client(parsed):
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(
        parsed=parsed,
        candidates=[SimpleNamespace(finish_reason="STOP")],
    )
    return mock_client


def test_get_meal_preferences_defaults_to_empty(client, session):
    resp = client.get("/api/meal-plan/preferences")

    assert resp.status_code == 200
    assert resp.json() == {"id": 1, "likes": [], "dislikes": []}


def test_put_meal_preferences_persists(client, session):
    resp = client.put(
        "/api/meal-plan/preferences",
        json={"likes": ["salmon"], "dislikes": ["mushrooms"]},
    )

    assert resp.status_code == 200
    assert resp.json() == {"id": 1, "likes": ["salmon"], "dislikes": ["mushrooms"]}

    # A later GET sees the same row rather than creating a second one.
    again = client.get("/api/meal-plan/preferences")
    assert again.json() == {"id": 1, "likes": ["salmon"], "dislikes": ["mushrooms"]}


def test_meal_plan_ai_edit_preview_includes_preference_note(client, session):
    client.put("/api/meal-plan/preferences", json={"likes": ["salmon"], "dislikes": ["mushrooms"]})
    mock_client = make_mock_client(SimpleNamespace(items=[]))
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit/preview", json={"message": "plan Tuesday dinner"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    system_instruction = mock_client.models.generate_content.call_args.kwargs["config"].system_instruction
    assert "salmon" in system_instruction
    assert "mushrooms" in system_instruction


def test_meal_plan_ai_edit_omits_preference_note_when_none_set(client, session):
    mock_client = make_mock_client(SimpleNamespace(items=[]))
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit/preview", json={"message": "plan Tuesday dinner"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    system_instruction = mock_client.models.generate_content.call_args.kwargs["config"].system_instruction
    assert "preferences" not in system_instruction.lower()


def test_recipe_endpoint_returns_ai_generated_steps(client, session):
    meal = MealPlanItem(
        date=date(2026, 9, 22), meal_slot=MealSlot.dinner, name="Tacos", ingredients=["beef", "salsa"]
    )
    session.add(meal)
    session.commit()
    session.refresh(meal)

    mock_client = make_mock_client(SimpleNamespace(steps=["Cook beef.", "Warm tortillas.", "Assemble tacos."]))
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post(f"/api/meal-plan/{meal.id}/recipe")

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    assert resp.json() == {"steps": ["Cook beef.", "Warm tortillas.", "Assemble tacos."]}
    prompt = mock_client.models.generate_content.call_args.kwargs["contents"]
    assert "Tacos" in prompt
    assert "beef, salsa" in prompt


def test_recipe_endpoint_404s_for_unknown_meal(client, session):
    app.dependency_overrides[get_ai_client] = lambda: MagicMock()

    resp = client.post("/api/meal-plan/999/recipe")

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 404
