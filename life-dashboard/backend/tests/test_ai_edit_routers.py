from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.ai import get_anthropic_client
from backend.main import app


def make_mock_client(parsed_items):
    mock_client = MagicMock()
    mock_client.messages.parse.return_value = SimpleNamespace(
        parsed_output=SimpleNamespace(items=parsed_items), stop_reason="end_turn"
    )
    return mock_client


def test_workouts_ai_edit_endpoint_exists_and_is_scoped(client, session):
    mock_client = make_mock_client([])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post("/api/workouts/ai-edit", json={"message": "make Thursday a rest day"})

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    assert "workout" in call_kwargs["system"].lower()
    # scope_note is only generated when scope_field is active; assert on its unique text
    assert "entries with date between" in call_kwargs["system"]


def test_reminders_ai_edit_endpoint_exists_and_is_unscoped(client, session):
    from datetime import datetime

    from backend.models import Reminder

    existing = Reminder(text="Old reminder", trigger_time=datetime(2026, 9, 10, 18, 0))
    session.add(existing)
    session.commit()
    session.refresh(existing)

    new_item = SimpleNamespace(
        id=None,
        text="Text girlfriend when I leave practice",
        trigger_time=datetime(2026, 9, 10, 20, 0),
        sent=False,
        model_dump=lambda exclude=None: {
            "text": "Text girlfriend when I leave practice",
            "trigger_time": datetime(2026, 9, 10, 20, 0),
            "sent": False,
        },
    )
    mock_client = make_mock_client([new_item])
    app.dependency_overrides[get_anthropic_client] = lambda: mock_client

    resp = client.post(
        "/api/reminders/ai-edit",
        json={"message": "remind me to text her when I leave practice"},
    )

    app.dependency_overrides.pop(get_anthropic_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["text"] == "Text girlfriend when I leave practice"
    assert body[0]["trigger_time"] == "2026-09-10T20:00:00"
    assert body[0]["sent"] is False
    # Unscoped: no date_from/date_to language expected in the system prompt
    call_kwargs = mock_client.messages.parse.call_args.kwargs
    assert "between" not in call_kwargs["system"]
