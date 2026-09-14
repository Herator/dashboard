from backend.main import app
from backend.weather import get_http_client, _forecast_cache


def _entry(iso_time, temp, symbol=None, precip_chance=None):
    data = {"instant": {"details": {"air_temperature": temp}}}
    if symbol is not None:
        data["next_6_hours"] = {"summary": {"symbol_code": symbol}, "details": {}}
        if precip_chance is not None:
            data["next_6_hours"]["details"]["probability_of_precipitation"] = precip_chance
    return {"time": iso_time, "data": data}


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class FakeHttpClient:
    def get(self, url, params=None):
        # Times are UTC; Europe/Oslo is UTC+2 in September (CEST), so these
        # land on local hours 10:00/12:00/18:00 (day 1) and 06:00/12:00 (day 2).
        timeseries = [
            _entry("2026-09-14T08:00:00Z", 12.0, "partlycloudy_day", 5),
            _entry("2026-09-14T10:00:00Z", 18.0, "fair_day", 10),  # closest to local noon
            _entry("2026-09-14T16:00:00Z", 9.0, "cloudy", 20),
            _entry("2026-09-15T04:00:00Z", 8.0, "clearsky_day", 0),
            _entry("2026-09-15T10:00:00Z", 15.0, "rain", 80),  # closest to local noon
        ]
        return FakeResponse({"properties": {"timeseries": timeseries}})


def reset_cache():
    _forecast_cache["data"] = None
    _forecast_cache["fetched_at"] = 0.0


def fake_http_client():
    yield FakeHttpClient()


def test_weather_endpoint_returns_daily_forecast_shape(client):
    reset_cache()
    app.dependency_overrides[get_http_client] = fake_http_client

    resp = client.get("/api/weather/")

    app.dependency_overrides.pop(get_http_client, None)
    reset_cache()

    assert resp.status_code == 200
    data = resp.json()
    assert data["days"][0] == {
        "date": "2026-09-14",
        "code": "fair_day",
        "temp_max": 18.0,
        "temp_min": 9.0,
        "precipitation_chance": 20,
    }
    assert data["days"][1] == {
        "date": "2026-09-15",
        "code": "rain",
        "temp_max": 15.0,
        "temp_min": 8.0,
        "precipitation_chance": 80,
    }
    assert len(data["days"]) == 2
