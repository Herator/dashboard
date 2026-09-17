import pytest

RESOURCE_PATHS = [
    "/api/events/",
    "/api/meal-plan/",
    "/api/groceries/",
    "/api/workouts/",
    "/api/exams/",
    "/api/reminders/",
    "/api/packages/",
    "/api/quick-links/",
    "/api/filament/",
]


@pytest.mark.parametrize("path", RESOURCE_PATHS)
def test_resource_list_endpoint_returns_empty_list(client, path):
    resp = client.get(path)
    assert resp.status_code == 200
    assert resp.json() == []


def test_health_check(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
