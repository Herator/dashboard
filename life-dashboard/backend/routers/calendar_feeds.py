import logging
import time
from datetime import date, timedelta

import httpx
import icalendar
import recurring_ical_events
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from backend.crud import make_crud_router
from backend.database import get_session
from backend.models import CalendarFeed

logger = logging.getLogger(__name__)

crud_router = make_crud_router(CalendarFeed, "/api/calendar-feeds", "calendar-feeds")

events_router = APIRouter(prefix="/api/external-events", tags=["external-events"])

# Subscribed calendars are third-party servers the dashboard has no control
# over; re-downloading and re-parsing one on every calendar render would be
# both slow and rude, so each feed's raw ICS text is cached in-process.
_FEED_CACHE_TTL = 30 * 60
_feed_cache: dict = {}


def get_http_client():
    client = httpx.Client(timeout=10, follow_redirects=True)
    try:
        yield client
    finally:
        client.close()


def _normalize_url(url: str) -> str:
    # `webcal://` is what Apple/Google hand out for "subscribe" links, but
    # it's just a hint to open the OS's calendar app — plain HTTP(S) fetches
    # (like ours) need the real scheme underneath.
    if url.startswith("webcal://"):
        return "https://" + url[len("webcal://") :]
    return url


def _fetch_ics(feed: CalendarFeed, http: httpx.Client) -> str:
    now = time.time()
    cached = _feed_cache.get(feed.id)
    if cached and now - cached["fetched_at"] < _FEED_CACHE_TTL:
        return cached["ics"]

    resp = http.get(_normalize_url(feed.url))
    resp.raise_for_status()
    _feed_cache[feed.id] = {"ics": resp.text, "fetched_at": now}
    return resp.text


@events_router.get("", include_in_schema=False)
@events_router.get("/")
def get_external_events(
    start: date = Query(...),
    end: date = Query(...),
    session: Session = Depends(get_session),
    http: httpx.Client = Depends(get_http_client),
):
    feeds = session.exec(select(CalendarFeed)).all()
    results = []
    errors = []
    for feed in feeds:
        try:
            ics_text = _fetch_ics(feed, http)
            calendar = icalendar.Calendar.from_ical(ics_text)
            # `end` is exclusive on the library's side; +1 day makes the
            # caller's `end` date itself inclusive, matching how the local
            # events endpoint is used (a whole calendar month, both ends in).
            occurrences = recurring_ical_events.of(calendar).between(start, end + timedelta(days=1))
        except Exception as exc:
            # One unreachable or malformed subscription shouldn't blank out
            # the whole calendar — skip it, keep the feeds that do work. But
            # unlike a bare `except: continue`, log it and report it back so
            # a bad link doesn't just look like "no events" with no hint why.
            logger.warning("Failed to load calendar feed %r (%s): %s", feed.name, feed.url, exc)
            errors.append({"feed_id": feed.id, "feed_name": feed.name, "detail": str(exc)})
            continue

        for occurrence in occurrences:
            dtstart = occurrence.get("dtstart").dt
            dtend_field = occurrence.get("dtend")
            dtend = dtend_field.dt if dtend_field else dtstart
            results.append(
                {
                    "feed_id": feed.id,
                    "feed_name": feed.name,
                    "color": feed.color,
                    "title": str(occurrence.get("summary", "Untitled")),
                    "start": dtstart.isoformat(),
                    "end": dtend.isoformat(),
                }
            )
    return {"events": results, "errors": errors}
