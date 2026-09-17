import logging
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.database import get_session
from backend.main import app
from backend.models import MealSlot


def make_mock_gemini_client(parsed_items, finish_reason="STOP"):
    """Build a fake Gemini client whose generate_content() returns a canned
    parsed result, so tests never make a real network call."""
    mock_client = MagicMock()
    mock_response = SimpleNamespace(
        parsed=SimpleNamespace(items=parsed_items),
        candidates=[SimpleNamespace(finish_reason=finish_reason)],
    )
    mock_client.models.generate_content.return_value = mock_response
    return mock_client


def make_parsed_item(item_id, set_fields, unset_defaults=None):
    """SimpleNamespace stand-in for a generated ItemSchema instance whose
    model_dump mirrors Pydantic's real semantics.

    ``set_fields`` are the fields the AI actually included in its JSON;
    ``unset_defaults`` are fields it omitted, mapped to the default Pydantic
    would fill in for them. A plain ``model_dump()`` returns both (which is
    what silently overwrote stored values); ``exclude_unset=True`` returns
    only what the AI set. Without the second behaviour, a mock that simply
    omits the key passes whether or not the handler is fixed.
    """
    unset_defaults = unset_defaults or {}

    def model_dump(exclude=None, exclude_unset=False, **kwargs):
        data = dict(set_fields)
        if not exclude_unset:
            data.update(unset_defaults)
        for key in exclude or ():
            data.pop(key, None)
        return data

    return SimpleNamespace(id=item_id, model_dump=model_dump, **set_fields)


def test_ai_edit_creates_a_new_meal_plan_item(client, session):
    from backend.routers.ai import get_ai_client

    # ItemSchema instances are duck-typed here via SimpleNamespace with the
    # fields the endpoint reads: id, date, meal_slot, name, ingredients.
    new_item = SimpleNamespace(
        id=None,
        date=date(2026, 9, 10),
        meal_slot=MealSlot.dinner,
        name="Chicken stir fry",
        ingredients=["chicken", "soy sauce"],
        # **kwargs so the mock tolerates however the handler calls model_dump
        # (it passes exclude= and exclude_unset=). The returned dict stands in
        # for "the fields the AI actually set" — a key absent here means the
        # AI omitted that field.
        model_dump=lambda **kwargs: {
            "date": date(2026, 9, 10),
            "meal_slot": MealSlot.dinner,
            "name": "Chicken stir fry",
            "ingredients": ["chicken", "soy sauce"],
        },
    )
    mock_client = make_mock_gemini_client([new_item])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit",
        json={"message": "add chicken stir fry for dinner Thursday"},
    )

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "Chicken stir fry"
    assert body[0]["id"] is not None

    # Verify the system prompt mentioned the scope and the raw request reached the mock
    call_kwargs = mock_client.models.generate_content.call_args.kwargs
    assert "meal plan" in call_kwargs["config"].system_instruction.lower()
    assert "add chicken stir fry for dinner Thursday" in call_kwargs["contents"]


def test_ai_edit_updates_an_existing_item_by_id(client, session):
    from backend.routers.ai import get_ai_client
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
        meal_slot=MealSlot.dinner,
        name="Chicken stir fry",
        ingredients=["chicken"],
        model_dump=lambda **kwargs: {
            "date": date(2026, 9, 10),
            "meal_slot": MealSlot.dinner,
            "name": "Chicken stir fry",
            "ingredients": ["chicken"],
        },
    )
    mock_client = make_mock_gemini_client([updated_item])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit",
        json={"message": "swap Tuesday's old dinner for chicken stir fry"},
    )

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["id"] == existing.id
    assert body[0]["name"] == "Chicken stir fry"


def test_ai_edit_deletes_items_omitted_from_the_response(client, session):
    from backend.routers.ai import get_ai_client
    from backend.models import MealPlanItem, MealSlot

    to_delete = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.lunch, name="Leftover soup", ingredients=[]
    )
    session.add(to_delete)
    session.commit()
    session.refresh(to_delete)

    mock_client = make_mock_gemini_client([])  # AI returned an empty list: delete everything in scope
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit",
        json={"message": "remove Tuesday's lunch"},
    )

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    assert resp.json() == []

    list_resp = client.get("/api/meal-plan/")
    assert list_resp.json() == []


def test_ai_edit_scopes_to_the_requested_date_range(client, session):
    from backend.routers.ai import get_ai_client
    from backend.models import MealPlanItem, MealSlot

    in_scope = MealPlanItem(
        date=date(2026, 9, 10), meal_slot=MealSlot.dinner, name="In scope", ingredients=[]
    )
    out_of_scope = MealPlanItem(
        date=date(2026, 9, 20), meal_slot=MealSlot.dinner, name="Out of scope", ingredients=[]
    )
    session.add_all([in_scope, out_of_scope])
    session.commit()

    mock_client = make_mock_gemini_client([])  # returning nothing in scope
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit",
        json={
            "message": "clear this week",
            "date_from": "2026-09-07",
            "date_to": "2026-09-13",
        },
    )

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    # Only the in-scope item should have been visible to delete; the
    # out-of-scope item must survive untouched.
    remaining = client.get("/api/meal-plan/").json()
    assert len(remaining) == 1
    assert remaining[0]["name"] == "Out of scope"


def test_ai_edit_returns_502_on_gemini_api_error(client, session):
    from google.genai import errors as genai_errors

    from backend.routers.ai import get_ai_client

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = genai_errors.APIError(
        code=503, response_json={"message": "model unavailable"}
    )
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit", json={"message": "anything"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 502


def test_ai_edit_returns_422_when_the_ai_refuses(client, session):
    from backend.routers.ai import get_ai_client

    mock_client = make_mock_gemini_client([], finish_reason="SAFETY")
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit", json={"message": "do something bad"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 422
    assert "declined" in resp.json()["detail"].lower()


def test_ai_edit_returns_502_when_parsed_is_none(client, session):
    """.parsed is None both for a truly empty response and for one whose JSON
    didn't match the schema — the SDK validates internally and swallows the
    mismatch (see backend/routers/ai.py's _ask_ai). Reading .items off None
    would otherwise be an unhandled 500."""
    from backend.routers.ai import get_ai_client

    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(
        parsed=None, candidates=[SimpleNamespace(finish_reason="STOP")]
    )
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post("/api/meal-plan/ai-edit", json={"message": "anything"})

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 502
    assert "no usable response" in resp.json()["detail"].lower()


def test_ai_edit_returns_503_when_no_api_key_is_configured(client, session, monkeypatch):
    """The real get_ai_client must run here — no dependency override — so a
    missing key surfaces as a clear 503."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from backend.routers.ai import get_ai_client

    assert get_ai_client not in app.dependency_overrides

    resp = client.post("/api/meal-plan/ai-edit", json={"message": "anything"})

    assert resp.status_code == 503
    assert "GEMINI_API_KEY" in resp.json()["detail"]


def test_ai_edit_returns_503_when_api_key_is_blank(client, session, monkeypatch):
    """A blank GEMINI_API_KEY must give the same clear 503 as an unset one."""
    monkeypatch.setenv("GEMINI_API_KEY", "")
    from backend.routers.ai import get_ai_client

    assert get_ai_client not in app.dependency_overrides

    resp = client.post("/api/workouts/ai-edit", json={"message": "anything"})

    assert resp.status_code == 503


def test_ai_model_id_falls_back_when_env_var_is_blank(monkeypatch):
    """os.environ.get(key, default) would return "" for an explicitly blank
    var; the `or` form must fall back to the default instead."""
    import importlib.util

    import backend.routers.ai

    def load_fresh():
        # Execute a fresh copy of ai.py without replacing sys.modules'
        # backend.routers.ai (which would break other tests' dependency overrides).
        spec = importlib.util.spec_from_file_location(
            "_ai_model_id_probe", backend.routers.ai.__file__
        )
        probe = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(probe)
        return probe

    monkeypatch.setenv("AI_MODEL_ID", "")
    assert load_fresh().AI_MODEL_ID == "gemini-flash-lite-latest"

    monkeypatch.delenv("AI_MODEL_ID", raising=False)
    assert load_fresh().AI_MODEL_ID == "gemini-flash-lite-latest"

    monkeypatch.setenv("AI_MODEL_ID", "gemini-some-other-model")
    assert load_fresh().AI_MODEL_ID == "gemini-some-other-model"


def test_ai_edit_does_not_wipe_optional_fields_the_ai_omitted(client, session):
    """The AI-item schema lets optional fields be omitted from the response.
    An omitted field must leave the stored value alone rather than
    overwriting it with the field's default (data loss)."""
    from backend.routers.ai import get_ai_client
    from backend.models import Workout

    existing = Workout(
        date=date(2026, 9, 10), plan_text="5k easy", notes="stretch first"
    )
    session.add(existing)
    session.commit()
    session.refresh(existing)

    # The AI set only date and plan_text; notes would otherwise be dumped as
    # its default (None) and wipe the stored "stretch first".
    updated_item = make_parsed_item(
        existing.id,
        {"date": date(2026, 9, 10), "plan_text": "5k tempo"},
        unset_defaults={"notes": None},
    )
    mock_client = make_mock_gemini_client([updated_item])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post(
        "/api/workouts/ai-edit",
        json={
            "message": "make Thursday a tempo run",
            "date_from": "2026-09-07",
            "date_to": "2026-09-13",
        },
    )

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["plan_text"] == "5k tempo"
    assert body[0]["notes"] == "stretch first"


def test_ai_edit_create_still_applies_model_defaults_for_omitted_fields(client, session):
    """exclude_unset must not break the create path: a brand-new row built from
    only the fields the AI set still gets each model field's own default."""
    from backend.routers.ai import get_ai_client

    # The AI omitted ingredients (a default_factory field), so exclude_unset
    # drops it from the constructor call entirely.
    new_item = make_parsed_item(
        None,
        {
            "date": date(2026, 9, 10),
            "meal_slot": MealSlot.dinner,
            "name": "Chicken stir fry",
        },
        unset_defaults={"ingredients": []},
    )
    mock_client = make_mock_gemini_client([new_item])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post(
        "/api/meal-plan/ai-edit", json={"message": "add chicken stir fry for dinner"}
    )

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert body[0]["id"] is not None
    assert body[0]["ingredients"] == []


def test_ai_edit_does_not_reset_a_sent_reminder_the_ai_omitted(client, session):
    """The same hazard on a boolean with a non-None default: Reminder.sent is
    True once a reminder has fired and must not silently flip back to False."""
    from datetime import datetime

    from backend.routers.ai import get_ai_client
    from backend.models import Reminder

    existing = Reminder(
        text="Old reminder", trigger_time=datetime(2026, 9, 10, 18, 0), sent=True
    )
    session.add(existing)
    session.commit()
    session.refresh(existing)

    updated_item = make_parsed_item(
        existing.id,
        {
            "text": "Old reminder, moved",
            "trigger_time": datetime(2026, 9, 10, 19, 0),
        },
        unset_defaults={"sent": False},
    )
    mock_client = make_mock_gemini_client([updated_item])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    resp = client.post(
        "/api/reminders/ai-edit", json={"message": "push that reminder an hour later"}
    )

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    body = resp.json()
    assert body[0]["text"] == "Old reminder, moved"
    assert body[0]["sent"] is True


def test_ai_edit_logs_a_warning_when_rows_are_deleted(client, session, caplog):
    from backend.routers.ai import get_ai_client
    from backend.models import MealPlanItem, MealSlot

    doomed = MealPlanItem(
        date=date(2026, 9, 10),
        meal_slot=MealSlot.lunch,
        name="Leftover soup",
        ingredients=[],
    )
    session.add(doomed)
    session.commit()
    session.refresh(doomed)
    doomed_id = doomed.id

    mock_client = make_mock_gemini_client([])
    app.dependency_overrides[get_ai_client] = lambda: mock_client

    with caplog.at_level(logging.WARNING, logger="backend.routers.ai"):
        resp = client.post(
            "/api/meal-plan/ai-edit", json={"message": "remove Tuesday's lunch"}
        )

    app.dependency_overrides.pop(get_ai_client, None)

    assert resp.status_code == 200
    messages = [r.getMessage() for r in caplog.records if r.name == "backend.routers.ai"]
    assert any(
        str(doomed_id) in m and "remove Tuesday's lunch" in m for m in messages
    ), messages
