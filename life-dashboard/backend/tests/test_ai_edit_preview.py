from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.database import get_session
from backend.main import app
from backend.models import MealSlot


def make_mock_anthropic_client(parsed_items, stop_reason="end_turn"):
    mock_client = MagicMock()
    mock_client.messages.parse.return_value = SimpleNamespace(
        parsed_output=SimpleNamespace(items=parsed_items), stop_reason=stop_reason
    )
    return mock_client


def make_parsed_item(item_id, set_fields, unset_defaults=None):
    """SimpleNamespace stand-in for a generated ItemSchema instance whose
    model_dump mirrors Pydantic's real exclude_unset semantics — see
    test_ai_edit.py for the original version of this helper (duplicated
    here to keep this file self-contained; do not import across test files)."""
    unset_defaults = unset_defaults or {}

    def model_dump(exclude=None, exclude_unset=False, **kwargs):
        data = {"id": item_id}
        data.update(set_fields)
        if not exclude_unset:
            data.update(unset_defaults)
        for key in exclude or ():
            data.pop(key, None)
        return data

    return SimpleNamespace(id=item_id, model_dump=model_dump, **set_fields)


def test_preview_creates_show_up_in_created_and_nothing_is_persisted(client, session):
    from backend.ai import get_anthropic_client

    new_item = make_parsed_item(
        None, {"date": date(2026, 9, 10), "meal_slot": MealSlot.dinner, "name": "Chicken stir fry"},
        unset_defaults={"ingredients": []},
    )
    mock_client = make_mock_anthropic_client([new_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit/preview",
        json={"message": "add chicken stir fry for dinner"},
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["created"]) == 1
    assert body["created"][0]["name"] == "Chicken stir fry"
    assert body["updated"] == []
    assert body["deleted"] == []

    # Nothing was actually written.
    assert client.get("/api/meal-plan/").json() == []


def test_preview_updates_show_before_and_after_without_persisting(client, session):
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    existing = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.dinner, name="Old dinner", ingredients=["rice"]
    )
    session.add(existing)
    session.commit()
    session.refresh(existing)

    updated_item = make_parsed_item(
        existing.id,
        {"date": date(2026, 9, 10), "meal_slot": MealSlot.dinner, "name": "Chicken stir fry"},
        unset_defaults={"ingredients": ["rice"]},
    )
    mock_client = make_mock_anthropic_client([updated_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit/preview", json={"message": "swap for chicken stir fry"}
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["updated"]) == 1
    assert body["updated"][0]["before"]["name"] == "Old dinner"
    assert body["updated"][0]["after"]["name"] == "Chicken stir fry"
    # The AI omitted ingredients — the round-trip item it returns to us must
    # not claim a value for it.
    assert "ingredients" not in body["items"][0]

    # Nothing was actually written — the row is still "Old dinner".
    still_there = client.get("/api/meal-plan/").json()
    assert len(still_there) == 1
    assert still_there[0]["name"] == "Old dinner"
    assert still_there[0]["ingredients"] == ["rice"]


def test_preview_deletions_show_up_without_persisting(client, session):
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    existing = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.lunch, name="Leftover soup", ingredients=[]
    )
    session.add(existing)
    session.commit()

    mock_client = make_mock_anthropic_client([])  # AI returned nothing: delete everything in scope
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit/preview", json={"message": "remove lunch"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["deleted"]) == 1
    assert body["deleted"][0]["name"] == "Leftover soup"

    # Nothing was actually deleted.
    still_there = client.get("/api/meal-plan/").json()
    assert len(still_there) == 1


def test_preview_no_op_change_is_not_reported_as_updated(client, session):
    """If the AI echoes an item back completely unchanged, it shouldn't show
    up in `updated` — that list is for genuinely different before/after."""
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    existing = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.dinner, name="Same dinner", ingredients=["rice"]
    )
    session.add(existing)
    session.commit()
    session.refresh(existing)

    same_item = make_parsed_item(
        existing.id,
        {"date": date(2026, 9, 10), "meal_slot": MealSlot.dinner, "name": "Same dinner", "ingredients": ["rice"]},
    )
    mock_client = make_mock_anthropic_client([same_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit/preview", json={"message": "no real change"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json()["updated"] == []


def test_preview_passes_through_refusal_and_api_error_like_ai_edit(client, session):
    from backend.ai import get_anthropic_client

    mock_client = make_mock_anthropic_client([], stop_reason="refusal")
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit/preview", json={"message": "do something bad"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 422


def test_apply_does_not_call_the_ai(client, session):
    """apply must be pure DB reconciliation — it should work with no
    Anthropic client override at all, proving it never calls messages.parse."""
    resp = client.post(
        "/api/meal-plan/ai-edit/apply",
        json={"items": [{"date": "2026-09-10", "meal_slot": "dinner", "name": "Tacos"}]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "Tacos"


def test_preview_then_apply_round_trip_creates_correctly(client, session):
    from backend.ai import get_anthropic_client

    new_item = make_parsed_item(
        None, {"date": date(2026, 9, 10), "meal_slot": MealSlot.dinner, "name": "Chicken stir fry"},
        unset_defaults={"ingredients": []},
    )
    mock_client = make_mock_anthropic_client([new_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    preview = client.post(
        "/api/meal-plan/ai-edit/preview", json={"message": "add chicken stir fry"}
    ).json()

    app.dependency_overrides.pop(get_anthropic_client, None)

    apply_resp = client.post("/api/meal-plan/ai-edit/apply", json={"items": preview["items"]})

    assert apply_resp.status_code == 200
    body = apply_resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "Chicken stir fry"
    assert body[0]["ingredients"] == []  # SQLModel's own default_factory applied


def test_preview_then_apply_round_trip_preserves_omitted_optional_fields(client, session):
    """The exact regression this plan exists to protect: an update that omits
    an optional field must not wipe it, all the way through preview -> apply."""
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    existing = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.dinner, name="Old dinner", ingredients=["rice"]
    )
    session.add(existing)
    session.commit()
    session.refresh(existing)

    updated_item = make_parsed_item(
        existing.id,
        {"date": date(2026, 9, 10), "meal_slot": MealSlot.dinner, "name": "Chicken stir fry"},
        unset_defaults={"ingredients": ["rice"]},
    )
    mock_client = make_mock_anthropic_client([updated_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    preview = client.post(
        "/api/meal-plan/ai-edit/preview", json={"message": "swap for chicken stir fry"}
    ).json()

    app.dependency_overrides.pop(get_anthropic_client, None)

    # Confirm the round trip actually dropped the unset field before we even
    # get to apply — this is what makes the test meaningful rather than
    # trivially passing regardless of whether exclude_unset survived.
    assert "ingredients" not in preview["items"][0]

    apply_resp = client.post("/api/meal-plan/ai-edit/apply", json={"items": preview["items"]})

    assert apply_resp.status_code == 200
    body = apply_resp.json()
    assert body[0]["id"] == existing.id
    assert body[0]["name"] == "Chicken stir fry"
    assert body[0]["ingredients"] == ["rice"]  # untouched, survived preview -> apply


def test_preview_then_apply_round_trip_deletes_correctly(client, session):
    from backend.ai import get_anthropic_client
    from backend.models import MealPlanItem, MealSlot

    existing = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.lunch, name="Leftover soup", ingredients=[]
    )
    session.add(existing)
    session.commit()

    mock_client = make_mock_anthropic_client([])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    preview = client.post(
        "/api/meal-plan/ai-edit/preview", json={"message": "remove lunch"}
    ).json()

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert len(preview["deleted"]) == 1

    apply_resp = client.post("/api/meal-plan/ai-edit/apply", json={"items": preview["items"]})

    assert apply_resp.status_code == 200
    assert apply_resp.json() == []
    assert client.get("/api/meal-plan/").json() == []
