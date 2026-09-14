import time

import httpx
from fastapi import APIRouter, Depends

router = APIRouter(prefix="/api/weather", tags=["weather"])

# Grimstad, Norway — this dashboard is fixed to one physical location, so the
# coordinates are hardcoded rather than guessed from server IP geolocation.
LATITUDE = 58.3406
LONGITUDE = 8.5945

# Open-Meteo's forecast is only worth re-fetching a few times an hour on a
# wall-mounted dashboard that never closes its tab.
_FORECAST_TTL = 30 * 60

_forecast_cache: dict = {"data": None, "fetched_at": 0.0}


def get_http_client():
    client = httpx.Client(timeout=10)
    try:
        yield client
    finally:
        client.close()


@router.get("", include_in_schema=False)
@router.get("/")
def get_weekly_forecast(http: httpx.Client = Depends(get_http_client)):
    now = time.time()
    if _forecast_cache["data"] and now - _forecast_cache["fetched_at"] < _FORECAST_TTL:
        return _forecast_cache["data"]

    resp = http.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": LATITUDE,
            "longitude": LONGITUDE,
            "daily": "weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "timezone": "auto",
            "forecast_days": 7,
        },
    )
    resp.raise_for_status()
    daily = resp.json()["daily"]

    days = [
        {
            "date": daily["time"][i],
            "code": daily["weathercode"][i],
            "temp_max": daily["temperature_2m_max"][i],
            "temp_min": daily["temperature_2m_min"][i],
            "precipitation_chance": daily["precipitation_probability_max"][i],
        }
        for i in range(len(daily["time"]))
    ]
    result = {"days": days}
    _forecast_cache["data"] = result
    _forecast_cache["fetched_at"] = now
    return result
