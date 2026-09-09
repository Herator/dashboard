# Personal Life Dashboard — Project Spec

## 1. Overview

A self-hosted personal dashboard that combines calendar, meal planning, grocery
lists, workouts, school deadlines, exam countdowns, reminders, and package
tracking into one place — editable via natural language (AI-powered), not just
manual forms.

This is a **separate app from the existing `dev.domain.com` dashboard**. It
should live in its own codebase, its own container, and its own subdomain —
no shared code or routes with the dev dashboard.

## 2. Infrastructure (already in place)

- Home server already running Docker and other self-hosted services.
- Cloudflare Tunnel already configured and in use for `dev.domain.com`.
- **New public hostname** to be added to the same Cloudflare Tunnel config,
  e.g. `home.domain.com` (name TBD), pointing to a new local port
  (e.g. `localhost:8080`) where this app will run.
- **Auth**: use Cloudflare Access on the new hostname (email OTP or Google
  login policy) rather than building auth into the app itself. The app can
  trust that any request reaching it has already passed Cloudflare Access.
  (Decide: should the app also have its own lightweight login as a second
  layer? Default recommendation: no, keep it simple — rely on Cloudflare
  Access.)

## 3. Tech Stack

- **Backend**: Node.js/Express or Python/FastAPI (pick one — FastAPI if
  Claude Code should optimize for simplicity/typing, Express if the rest of
  the home server stack is already JS-based).
- **Database**: SQLite (single user, small dataset — no need for
  Postgres/MySQL).
- **Frontend**: Simple, mobile-friendly web app (this will be used heavily
  from a phone browser). Framework choice left to Claude Code — plain
  React or a lightweight framework is fine. No PWA/offline requirement for
  v1.
- **Containerization**: Docker, added to the existing docker-compose setup
  on the home server.
- **AI layer**: Anthropic API (Claude) called server-side. Natural language
  requests (e.g. "swap Tuesday dinner for chicken", "I've got golf 11:50
  Wednesday") get sent to Claude along with the current relevant data
  (as structured JSON), and Claude returns an updated structured JSON
  object that the backend validates and saves.

## 4. Core Features

### 4.1 Calendar
- Combines three sources into one view:
  - User's own calendar
  - Girlfriend's calendar (shared with user via Google Calendar, view-only)
  - School schedule (imported/subscribed, e.g. via .ics if school provides one)
- Google Calendar API integration (read combined calendars, write to user's
  own calendar).
- Natural language event creation: user types something like "I got golf
  11:50 on Wednesday" → parsed by Claude into a structured event → checked
  for conflicts across all three calendars → added to user's calendar.
- Conflicts should be flagged back to the user, not silently ignored.

### 4.2 Meal Plan
- Weekly grid (Mon–Sun, meal slots e.g. breakfast/lunch/dinner — confirm
  which slots are wanted).
- Stored as structured data (not free text) so it can feed the grocery list.
- AI-editable: "swap Tuesday dinner for something with chicken" → Claude
  receives current week's plan as JSON, returns updated JSON, backend saves.

### 4.3 Grocery List
- Auto-generated from the current meal plan (ingredients aggregated across
  the week).
- Should update automatically when the meal plan changes.
- Simple check-off UI for when actually shopping.

### 4.4 Workout Plan
- Weekly plan, similar structure/pattern to meal plan.
- AI-editable: "make Thursday a rest day", "add 10 minutes of cardio Friday".

### 4.5 Assignment & Deadline Tracker
- Separate from the calendar (deadlines need earlier/repeated reminders,
  not just a single calendar event).
- Fields: title, course/subject, due date, status (not started / in
  progress / done), optional notes.
- Reminder logic: e.g. notify at 5 days, 1 day before due.

### 4.6 Exam Countdown
- List of upcoming exams with date + subject.
- Dashboard widget showing "X days until [exam]" for the nearest one(s).

### 4.7 Notifications / Reminders
- General-purpose reminder system, not tied to a specific feature.
- User can say "remind me to text [girlfriend] when I leave practice" —
  decide on trigger mechanism (time-based to start; location-based is a
  stretch goal, not v1).
- Delivery method TBD — options: push notification (needs a service like
  ntfy.sh, ntfy self-hosted, ApprisePush, or ntfy plus a wrapper), email,
  or just an in-dashboard notification feed. Recommend starting with
  **ntfy** (self-hostable, simple, works great with a home server) for
  actual push notifications to phone.

### 4.8 Package Tracking
- User adds a tracking number (+ carrier, or auto-detect).
- Dashboard shows current status per package.
- Consider using a free package-tracking API (e.g. AfterShip free tier,
  or 17track) rather than building carrier-specific scraping.

### 4.9 Quick Links
- Small "Quick Links" tile row on the dashboard home page linking out to
  other self-hosted services already running on the home server (e.g.
  Immich, already hosted on the dev server).
- No API integration with the linked services — just label + URL, opens
  in a new tab.
- Stored as simple records (label, url) via the same generic CRUD pattern
  as other resources, so more links can be added later without a code
  change.

## 5. AI Interaction Pattern (applies across features)

For every AI-editable feature (calendar, meal plan, workout plan, reminders):

1. User sends a natural language message via the dashboard.
2. Backend sends Claude: the current relevant structured data (JSON) + the
   user's message + a system prompt instructing Claude to return **only**
   valid JSON matching the existing schema.
3. Backend parses Claude's JSON response, validates it against the schema,
   and saves to SQLite.
4. Frontend re-fetches/re-renders the updated data.
5. If Claude's response can't be parsed or fails validation, show the user
   an error rather than silently failing.

## 6. Data Model (rough starting point — Claude Code should refine)

- `events` (calendar): id, source (self/girlfriend/school), title, start,
  end, location, notes
- `meal_plan`: id, date, meal_slot, recipe/name, ingredients (list)
- `grocery_items`: id, name, quantity, checked (bool), week_of
- `workouts`: id, date, exercise/plan text, notes
- `assignments`: id, title, course, due_date, status, notes
- `exams`: id, subject, date, notes
- `reminders`: id, text, trigger_time, sent (bool)
- `packages`: id, tracking_number, carrier, status, last_updated
- `quick_links`: id, label, url

## 7. Deployment Steps (summary)

1. Build app (backend + frontend) in its own repo/folder.
2. Add Dockerfile + add service to existing docker-compose.yml on home server.
3. Add new public hostname to existing Cloudflare Tunnel config, pointing to
   the new container's port.
4. Add a Cloudflare Access policy on that hostname (login requirement).
5. Set environment variables (Anthropic API key, Google Calendar API
   credentials, ntfy config, package tracking API key) via `.env`, not
   committed to git.
6. Test end-to-end from phone browser over the new subdomain.

## 8. Decisions

- [x] Subdomain name: `home.domain.com` (replace `domain.com` with actual
      domain when configuring the Cloudflare Tunnel)
- [x] Backend language: **Python/FastAPI**
- [x] Meal slots: **breakfast / lunch / dinner / snack** (4 slots/day)
- [x] Reminder delivery method: **ntfy** (self-hosted or ntfy.sh)
- [x] Package tracking API: **17track free tier** (default choice; revisit
      if limits become an issue)
- [x] App-level login on top of Cloudflare Access: **no** — rely on
      Cloudflare Access only for v1
- [ ] Google Calendar API vs .ics subscription for school schedule — still
      depends on what the school actually provides. Default assumption:
      Google Calendar API for user's + girlfriend's calendars (both
      Google), and .ics subscription for school if a feed URL is
      available; otherwise manual entry as a fallback for school events
      in v1.

## 9. Suggested Build Order

1. Static dashboard shell (all pages present, no AI yet, manual data entry)
2. Calendar integration (read-only combined view first, then write via AI)
3. Meal plan + grocery list (these feed each other, build together)
4. Workout plan
5. Assignment/deadline tracker + exam countdown
6. Reminders (ntfy integration)
7. Package tracking
8. Docker + Cloudflare Tunnel + Access wiring
