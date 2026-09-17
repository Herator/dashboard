import json
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.routers.ai import _current_week_bounds, get_ai_client
from backend.main import app


def make_mock_client(parsed_items):
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(
        parsed=SimpleNamespace(items=parsed_items),
        candidates=[SimpleNamespace(finish_reason="STOP")],
    )
    return mock_client


def test_workouts_ai_edit_endpoint_exists_and_is_scoped(client, session):
    mock_client = make_mock_client([])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/workouts/ai-edit", json={"message": "make Thursday a rest day"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    call_kwargs = mock_client.models.generate_content.call_args.kwargs
    system_instruction = call_kwargs["config"].system_instruction
    assert "workout" in system_instruction.lower()
    # scope_note is only generated when scope_field is active; assert on its unique text
    assert "entries with date between" in system_instruction
    # extra_instructions steers the AI toward concrete exercises for a split,
    # not vague advice — assert it actually reaches the system prompt.
    assert "Push Day" in system_instruction
    assert "exercises" in system_instruction
    assert "completed" in system_instruction


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
        model_dump=lambda **kwargs: {
            "text": "Text girlfriend when I leave practice",
            "trigger_time": datetime(2026, 9, 10, 20, 0),
            "sent": False,
        },
    )
    mock_client = make_mock_client([new_item])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post(
        "/api/reminders/ai-edit",
        json={"message": "remind me to text her when I leave practice"},
    )

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["text"] == "Text girlfriend when I leave practice"
    assert body[0]["trigger_time"] == "2026-09-10T20:00:00"
    assert body[0]["sent"] is False
    # Unscoped: no date_from/date_to language expected in the system prompt
    call_kwargs = mock_client.models.generate_content.call_args.kwargs
    assert "between" not in call_kwargs["config"].system_instruction


def test_workouts_ai_edit_preview_and_apply_round_trip(client, session):
    from backend.models import Workout

    existing = Workout(date=date(2026, 9, 10), plan_text="5k easy", notes="stretch first")
    session.add(existing)
    session.commit()
    session.refresh(existing)

    updated_item = SimpleNamespace(
        id=existing.id,
        model_dump=lambda exclude=None, exclude_unset=False, **kwargs: (
            {"id": existing.id, "date": date(2026, 9, 10), "plan_text": "5k tempo"}
            if exclude_unset
            else {"id": existing.id, "date": date(2026, 9, 10), "plan_text": "5k tempo", "notes": "stretch first"}
        ),
    )
    mock_client = make_mock_client([updated_item])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    preview = client.post(
        "/api/workouts/ai-edit/preview", json={"message": "make it a tempo run"}
    ).json()

    app.dependency_overrides.pop(get_ai_client, None)

    assert len(preview["updated"]) == 1
    assert "notes" not in preview["items"][0]

    apply_resp = client.post("/api/workouts/ai-edit/apply", json={"items": preview["items"]})
    assert apply_resp.status_code == 200
    body = apply_resp.json()
    assert body[0]["plan_text"] == "5k tempo"
    assert body[0]["notes"] == "stretch first"


def test_reminders_ai_edit_preview_and_apply_round_trip(client, session):
    new_item = SimpleNamespace(
        id=None,
        model_dump=lambda exclude=None, exclude_unset=False, **kwargs: {
            "text": "Text her when I leave practice",
            "trigger_time": datetime(2026, 9, 10, 20, 0, 0),
        },
    )
    mock_client = make_mock_client([new_item])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    preview = client.post(
        "/api/reminders/ai-edit/preview",
        json={"message": "remind me to text her when I leave practice"},
    ).json()

    app.dependency_overrides.pop(get_ai_client, None)

    assert len(preview["created"]) == 1

    apply_resp = client.post("/api/reminders/ai-edit/apply", json={"items": preview["items"]})
    assert apply_resp.status_code == 200
    body = apply_resp.json()
    assert body[0]["text"] == "Text her when I leave practice"
    assert body[0]["sent"] is False  # model default applied


def test_calendar_ai_edit_endpoint_exists_and_is_scoped(client, session):
    mock_client = make_mock_client([])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/events/ai-edit", json={"message": "add a tee time Saturday at 9am"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    call_kwargs = mock_client.models.generate_content.call_args.kwargs
    system_instruction = call_kwargs["config"].system_instruction
    assert "calendar event" in system_instruction.lower()
    assert "entries with start between" in system_instruction


def test_calendar_ai_edit_includes_events_late_on_the_last_scoped_day(client, session):
    """`start` is a datetime column, so the default week's last day must be
    scoped as a half-open range through the *next* midnight — otherwise an
    event later that same day is silently excluded despite the system
    prompt's own "inclusive" scope note (see `_scoped_existing`)."""
    from backend.models import CalendarSource, Event

    _, week_end = _current_week_bounds()
    late_event = Event(
        source=CalendarSource.self,
        title="Late event",
        start=datetime(week_end.year, week_end.month, week_end.day, 21, 30),
        end=datetime(week_end.year, week_end.month, week_end.day, 22, 30),
    )
    session.add(late_event)
    session.commit()

    mock_client = make_mock_client([])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/events/ai-edit", json={"message": "what's on my calendar"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    call_kwargs = mock_client.models.generate_content.call_args.kwargs
    current_json = json.loads(
        call_kwargs["contents"]
        .split("Current data: ", 1)[1]
        .split("\n\nUser request:", 1)[0]
    )
    assert [item["title"] for item in current_json] == ["Late event"]


def test_filament_ai_edit_endpoint_exists_and_is_unscoped(client, session):
    mock_client = make_mock_client([])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/filament/ai-edit", json={"message": "I bought a new spool of black PLA"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    call_kwargs = mock_client.models.generate_content.call_args.kwargs
    system_instruction = call_kwargs["config"].system_instruction
    assert "filament spool" in system_instruction.lower()
    assert "between" not in system_instruction


def test_groceries_ai_edit_creates_a_new_item(client, session):
    new_item = SimpleNamespace(
        id=None,
        model_dump=lambda **kwargs: {
            "name": "Milk",
            "quantity": "1 gallon",
            "checked": False,
            "week_of": date(2026, 9, 14),
        },
    )
    mock_client = make_mock_client([new_item])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/groceries/ai-edit", json={"message": "add a gallon of milk"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "Milk"
    assert body[0]["checked"] is False
