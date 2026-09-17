def test_create_and_fetch_workout_with_exercises(client):
    resp = client.post(
        "/api/workouts/",
        json={
            "date": "2026-09-21",
            "plan_text": "Push Day",
            "exercises": [
                {"name": "Bench Press", "sets": 4, "reps": "8", "completed": [False, False, False, False]},
                {"name": "Overhead Press", "sets": 3, "reps": "10", "completed": [False, False, False]},
            ],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["exercises"][0]["name"] == "Bench Press"
    assert body["exercises"][0]["completed"] == [False, False, False, False]
    workout_id = body["id"]

    get_resp = client.get(f"/api/workouts/{workout_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["exercises"][1]["name"] == "Overhead Press"


def test_toggling_a_completed_set_persists(client):
    create_resp = client.post(
        "/api/workouts/",
        json={
            "date": "2026-09-21",
            "plan_text": "Leg Day",
            "exercises": [{"name": "Squat", "sets": 3, "reps": "5", "completed": [False, False, False]}],
        },
    )
    workout_id = create_resp.json()["id"]

    update_resp = client.put(
        f"/api/workouts/{workout_id}",
        json={"exercises": [{"name": "Squat", "sets": 3, "reps": "5", "completed": [True, False, False]}]},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["exercises"][0]["completed"] == [True, False, False]

    get_resp = client.get(f"/api/workouts/{workout_id}")
    assert get_resp.json()["exercises"][0]["completed"] == [True, False, False]


def test_workout_without_exercises_defaults_to_empty_list(client):
    resp = client.post("/api/workouts/", json={"date": "2026-09-21", "plan_text": "Rest Day"})
    assert resp.status_code == 200
    assert resp.json()["exercises"] == []


def test_exercise_defaults_new_fields_when_omitted(client):
    """Old clients/rows send/have only name+sets+reps+completed — the new
    muscle/cue/weight/actual_reps fields must default rather than 500."""
    resp = client.post(
        "/api/workouts/",
        json={
            "date": "2026-09-21",
            "plan_text": "Push Day",
            "exercises": [{"name": "Bench Press", "sets": 3, "reps": "8", "completed": [False, False, False]}],
        },
    )
    assert resp.status_code == 200
    exercise = resp.json()["exercises"][0]
    assert exercise["muscle"] is None
    assert exercise["cue"] is None
    assert exercise["weight"] == []
    assert exercise["actual_reps"] == []


def test_workout_library_metadata_round_trips(client):
    resp = client.post(
        "/api/workouts/",
        json={
            "date": "2026-09-21",
            "plan_text": "Leg Day",
            "goal": "strength",
            "duration_min": 45,
            "level": "intermediate",
            "equipment": ["Barbell", "Rack"],
            "muscles": ["Legs"],
            "generated": True,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["goal"] == "strength"
    assert body["duration_min"] == 45
    assert body["level"] == "intermediate"
    assert body["equipment"] == ["Barbell", "Rack"]
    assert body["muscles"] == ["Legs"]
    assert body["generated"] is True


def test_workout_without_library_metadata_defaults_to_none(client):
    resp = client.post("/api/workouts/", json={"date": "2026-09-21", "plan_text": "Rest Day"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["goal"] is None
    assert body["duration_min"] is None
    assert body["equipment"] is None
    assert body["muscles"] is None
    assert body["generated"] is False
