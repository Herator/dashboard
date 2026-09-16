from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

import anthropic

from backend.routers.ai import get_anthropic_client
from backend.main import app


def _classify_response(resource_key):
    return SimpleNamespace(
        parsed_output=SimpleNamespace(resource_key=resource_key), stop_reason="end_turn"
    )


def _edit_response(items):
    return SimpleNamespace(parsed_output=SimpleNamespace(items=items), stop_reason="end_turn")


def test_voice_command_routes_to_groceries_and_creates_item(client, session):
    new_item = SimpleNamespace(
        id=None,
        model_dump=lambda **kwargs: {
            "name": "Milk",
            "quantity": None,
            "checked": False,
            "week_of": date(2026, 9, 14),
        },
    )
    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = [
        _classify_response("groceries"),
        _edit_response([new_item]),
    ]
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/voice-command", json={"message": "add milk to the grocery list"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json() == {"speech": "Added Milk to grocery list."}

    list_resp = client.get("/api/groceries/")
    assert len(list_resp.json()) == 1
    assert list_resp.json()[0]["name"] == "Milk"


def test_voice_command_speaks_apology_when_classification_is_unclear(client, session):
    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = [_classify_response(None)]
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/voice-command", json={"message": "what's the weather like"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json() == {"speech": "I'm not sure what you meant — try rephrasing."}
    assert mock_client.messages.parse.call_count == 1  # never attempted an edit


def test_voice_command_speaks_apology_when_classification_key_is_unknown(client, session):
    """The classifier returning a string that isn't a real registry key
    (a hallucinated or stale key) must be treated the same as `None`."""
    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = [_classify_response("not-a-real-resource")]
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/voice-command", json={"message": "do something"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json() == {"speech": "I'm not sure what you meant — try rephrasing."}


def test_voice_command_speaks_apology_when_edit_step_fails(client, session):
    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = [
        _classify_response("filament"),
        anthropic.APIConnectionError(request=MagicMock()),
    ]
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/voice-command", json={"message": "I bought black PLA"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json() == {"speech": "Something went wrong updating that — try again in a bit."}


def test_voice_command_reports_updates_and_deletions(client, session):
    from backend.models import Reminder
    from datetime import datetime

    existing = Reminder(text="Old reminder", trigger_time=datetime(2026, 9, 10, 18, 0))
    session.add(existing)
    session.commit()
    session.refresh(existing)

    updated_item = SimpleNamespace(
        id=existing.id,
        model_dump=lambda exclude=None, exclude_unset=False, **kwargs: (
            {"text": "Updated reminder"}
            if exclude_unset
            else {"id": existing.id, "text": "Updated reminder", "trigger_time": datetime(2026, 9, 10, 18, 0), "sent": False}
        ),
    )
    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = [
        _classify_response("reminders"),
        _edit_response([updated_item]),
    ]
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/voice-command", json={"message": "change my reminder text"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json() == {"speech": "Updated 1 item in reminders."}


def test_voice_command_reports_a_deletion(client, session):
    from datetime import datetime

    from backend.models import Reminder

    existing = Reminder(text="Old reminder", trigger_time=datetime(2026, 9, 10, 18, 0))
    session.add(existing)
    session.commit()
    session.refresh(existing)

    mock_client = MagicMock()
    mock_client.messages.parse.side_effect = [
        _classify_response("reminders"),
        _edit_response([]),  # AI returned nothing -> existing row is stale -> deleted
    ]
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/voice-command", json={"message": "delete my old reminder"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    assert resp.json() == {"speech": "Removed Old reminder from reminders."}
