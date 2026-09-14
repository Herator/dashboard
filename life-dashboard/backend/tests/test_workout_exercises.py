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
