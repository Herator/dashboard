from backend.routers.calendar_feeds import get_http_client, _feed_cache, _normalize_url

ICS_SINGLE_EVENT = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:1@example.com
DTSTART:20260915T090000
DTEND:20260915T100000
SUMMARY:Girlfriend Yoga
END:VEVENT
END:VCALENDAR
"""

ICS_WEEKLY_RECURRING = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:2@example.com
DTSTART:20260901T180000
DTEND:20260901T190000
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:School Practice
END:VEVENT
END:VCALENDAR
"""


def reset_cache():
    _feed_cache.clear()


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def make_fake_http_client(ics_text):
    class FakeHttpClient:
        def get(self, url):
            return FakeResponse(ics_text)

    def dependency():
        yield FakeHttpClient()

    return dependency


def test_calendar_feed_crud(client):
    create_resp = client.post(
        "/api/calendar-feeds/", json={"name": "Girlfriend", "url": "https://example.com/gf.ics", "color": "#ff6b6b"}
    )
    assert create_resp.status_code == 200
    feed_id = create_resp.json()["id"]

    list_resp = client.get("/api/calendar-feeds/")
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    delete_resp = client.delete(f"/api/calendar-feeds/{feed_id}")
    assert delete_resp.status_code == 204


def test_external_events_returns_single_event(client):
    from backend.main import app

    reset_cache()
    client.post("/api/calendar-feeds/", json={"name": "Girlfriend", "url": "https://example.com/gf.ics", "color": "#ff6b6b"})

    app.dependency_overrides[get_http_client] = make_fake_http_client(ICS_SINGLE_EVENT)
    resp = client.get("/api/external-events/", params={"start": "2026-09-01", "end": "2026-09-30"})
    app.dependency_overrides.pop(get_http_client, None)
    reset_cache()

    assert resp.status_code == 200
    events = resp.json()["events"]
    assert len(events) == 1
    assert events[0]["title"] == "Girlfriend Yoga"
    assert events[0]["color"] == "#ff6b6b"
    assert events[0]["start"].startswith("2026-09-15T09:00:00")


def test_external_events_expands_recurring_events(client):
    from backend.main import app

    reset_cache()
    client.post("/api/calendar-feeds/", json={"name": "School", "url": "https://example.com/school.ics", "color": "#feca57"})

    app.dependency_overrides[get_http_client] = make_fake_http_client(ICS_WEEKLY_RECURRING)
    resp = client.get("/api/external-events/", params={"start": "2026-09-01", "end": "2026-09-30"})
    app.dependency_overrides.pop(get_http_client, None)
    reset_cache()

    assert resp.status_code == 200
    events = resp.json()["events"]
    # COUNT=4 weekly from 2026-09-01 -> 09-01, 09-08, 09-15, 09-22, all in September.
    assert len(events) == 4
    assert all(e["title"] == "School Practice" for e in events)


def test_external_events_skips_unreachable_feed(client):
    from backend.main import app

    reset_cache()
    client.post("/api/calendar-feeds/", json={"name": "Broken", "url": "https://example.com/broken.ics", "color": "#feca57"})

    class RaisingHttpClient:
        def get(self, url):
            raise ConnectionError("unreachable")

    def dependency():
        yield RaisingHttpClient()

    app.dependency_overrides[get_http_client] = dependency
    resp = client.get("/api/external-events/", params={"start": "2026-09-01", "end": "2026-09-30"})
    app.dependency_overrides.pop(get_http_client, None)
    reset_cache()

    assert resp.status_code == 200
    body = resp.json()
    assert body["events"] == []
    assert len(body["errors"]) == 1
    assert body["errors"][0]["feed_name"] == "Broken"
    assert "unreachable" in body["errors"][0]["detail"]


def test_normalize_url_converts_webcal_scheme():
    assert _normalize_url("webcal://p01-calendars.icloud.com/foo.ics") == "https://p01-calendars.icloud.com/foo.ics"
    assert _normalize_url("https://example.com/already-https.ics") == "https://example.com/already-https.ics"


def test_external_events_fetches_webcal_link_over_https(client):
    from backend.main import app

    reset_cache()
    client.post(
        "/api/calendar-feeds/",
        json={"name": "iCloud", "url": "webcal://example.com/cal.ics", "color": "#feca57"},
    )

    requested_urls = []

    class RecordingHttpClient:
        def get(self, url):
            requested_urls.append(url)
            return FakeResponse(ICS_SINGLE_EVENT)

    def dependency():
        yield RecordingHttpClient()

    app.dependency_overrides[get_http_client] = dependency
    resp = client.get("/api/external-events/", params={"start": "2026-09-01", "end": "2026-09-30"})
    app.dependency_overrides.pop(get_http_client, None)
    reset_cache()

    assert resp.status_code == 200
    assert requested_urls == ["https://example.com/cal.ics"]
    assert len(resp.json()["events"]) == 1
