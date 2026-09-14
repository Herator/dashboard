from backend.main import app
from backend.weather import get_http_client, _forecast_cache


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class FakeHttpClient:
    def get(self, url, params=None):
        return FakeResponse(
            {
                "daily": {
                    "time": ["2026-09-14", "2026-09-15"],
                    "weathercode": [1, 61],
                    "temperature_2m_max": [18.0, 15.0],
                    "temperature_2m_min": [9.0, 8.0],
                    "precipitation_probability_max": [10, 80],
                }
            }
        )


def reset_cache():
    _forecast_cache["data"] = None
    _forecast_cache["fetched_at"] = 0.0


def fake_http_client():
    yield FakeHttpClient()


def test_weather_endpoint_returns_seven_day_shape(client):
    reset_cache()
    app.dependency_overrides[get_http_client] = fake_http_client

    resp = client.get("/api/weather/")

    app.dependency_overrides.pop(get_http_client, None)
    reset_cache()

    assert resp.status_code == 200
    data = resp.json()
    assert data["days"][0] == {
        "date": "2026-09-14",
        "code": 1,
        "temp_max": 18.0,
        "temp_min": 9.0,
        "precipitation_chance": 10,
    }
    assert len(data["days"]) == 2
