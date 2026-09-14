import time
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends

router = APIRouter(prefix="/api/weather", tags=["weather"])

# Grimstad, Norway — this dashboard is fixed to one physical location, so the
# coordinates are hardcoded rather than guessed from server IP geolocation.
LATITUDE = 58.3406
LONGITUDE = 8.5945
TIMEZONE = ZoneInfo("Europe/Oslo")

# MET Norway (the data provider behind yr.no) requires a descriptive
# User-Agent identifying the application; anonymous-looking clients get
# blocked or rate-limited. https://api.met.no/doc/TermsOfService
USER_AGENT = "life-dashboard/1.0 github.com/Herator/dashboard"

# The forecast is only worth re-fetching a few times an hour on a
# wall-mounted dashboard that never closes its tab.
_FORECAST_TTL = 30 * 60

_forecast_cache: dict = {"data": None, "fetched_at": 0.0}


def get_http_client():
    client = httpx.Client(timeout=10, headers={"User-Agent": USER_AGENT})
    try:
        yield client
    finally:
        client.close()


def _local_datetime(iso_time: str) -> datetime:
    return datetime.fromisoformat(iso_time.replace("Z", "+00:00")).astimezone(TIMEZONE)


def _build_daily_forecast(timeseries: list, num_days: int = 7) -> list:
    """Collapse MET's per-timestamp series into one row per local calendar
    day. MET has no "daily forecast" endpoint like Open-Meteo did — each
    entry is a point in time, so day-level numbers have to be aggregated
    here: min/max from the `instant` temperature across the day, and a
    representative icon/precipitation-chance from whichever `next_6_hours`
    block sits closest to local noon (the same convention yr.no's own daily
    view uses), since a symbol only exists on the 6h-resolution blocks.
    """
    by_date: dict = {}
    for entry in timeseries:
        local_dt = _local_datetime(entry["time"])
        date_key = local_dt.date().isoformat()
        bucket = by_date.setdefault(date_key, {"temps": [], "precip_chances": [], "noon_candidates": []})

        instant = entry["data"].get("instant", {}).get("details", {})
        if "air_temperature" in instant:
            bucket["temps"].append(instant["air_temperature"])

        next_6h = entry["data"].get("next_6_hours")
        if next_6h:
            prob = next_6h.get("details", {}).get("probability_of_precipitation")
            if prob is not None:
                bucket["precip_chances"].append(prob)
            symbol = next_6h.get("summary", {}).get("symbol_code")
            if symbol:
                bucket["noon_candidates"].append((abs(local_dt.hour - 12), symbol))

    days = []
    for date_key in sorted(by_date)[:num_days]:
        bucket = by_date[date_key]
        if not bucket["temps"]:
            continue
        symbol = min(bucket["noon_candidates"], default=(None, "cloudy"))[1]
        days.append(
            {
                "date": date_key,
                "code": symbol,
                "temp_max": max(bucket["temps"]),
                "temp_min": min(bucket["temps"]),
                "precipitation_chance": round(max(bucket["precip_chances"], default=0)),
            }
        )
    return days


@router.get("", include_in_schema=False)
@router.get("/")
def get_weekly_forecast(http: httpx.Client = Depends(get_http_client)):
    now = time.time()
    if _forecast_cache["data"] and now - _forecast_cache["fetched_at"] < _FORECAST_TTL:
        return _forecast_cache["data"]

    resp = http.get(
        "https://api.met.no/weatherapi/locationforecast/2.0/complete",
        params={"lat": LATITUDE, "lon": LONGITUDE},
    )
    resp.raise_for_status()
    timeseries = resp.json()["properties"]["timeseries"]

    result = {"days": _build_daily_forecast(timeseries)}
    _forecast_cache["data"] = result
    _forecast_cache["fetched_at"] = now
    return result
