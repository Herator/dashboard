def test_create_list_update_delete_workout_schedule_entry(client):
    create_resp = client.post(
        "/api/workout-schedule/",
        json={"day_of_week": "mon", "time": "07:00:00", "label": "Strength Training"},
    )
    assert create_resp.status_code == 200
    created = create_resp.json()
    assert created["day_of_week"] == "mon"
    assert created["time"] == "07:00:00"
    entry_id = created["id"]

    list_resp = client.get("/api/workout-schedule/")
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    update_resp = client.put(
        f"/api/workout-schedule/{entry_id}",
        json={"time": "18:30:00"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["time"] == "18:30:00"

    delete_resp = client.delete(f"/api/workout-schedule/{entry_id}")
    assert delete_resp.status_code == 204
    assert client.get("/api/workout-schedule/").json() == []


def test_workout_schedule_rejects_invalid_day_of_week(client):
    resp = client.post(
        "/api/workout-schedule/",
        json={"day_of_week": "someday", "time": "07:00:00"},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["loc"] == ["body", "day_of_week"]


def test_workout_schedule_label_defaults_to_workout(client):
    resp = client.post("/api/workout-schedule/", json={"day_of_week": "wed", "time": "06:00:00"})
    assert resp.status_code == 200
    assert resp.json()["label"] == "Workout"
