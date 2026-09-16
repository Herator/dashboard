# Voice Assistant (Siri Shortcut) — Design Specification

## 1. Overview

Lets the user speak a request to Siri on their iPhone ("Hey Siri, tell the
dashboard...") and have it applied to the life-dashboard data — calendar
events, meal plan, workouts, reminders, groceries, or filament — with a
spoken confirmation back, fully hands-free. No wake-word engine, no mobile
app, no browser mic code: Siri does the speech-to-text for free via an iOS
Shortcut, which POSTs the dictated text to a new backend endpoint.

## 2. Scope

Covers all six resources that make sense as spoken edits: `Event`
(calendar), `MealPlanItem`, `Workout`, `Reminder`, `GroceryItem`,
`FilamentSpool`. Three of these (`MealPlanItem`, `Workout`, `Reminder`)
already have AI-edit routers; the other three (`Event`, `GroceryItem`,
`FilamentSpool`) get one added, following the existing pattern.

**Out of scope for v1** (explicit simplifications, not overlooked):
- One resource per utterance — "add milk and log my workout" in one
  sentence is not supported. Say two separate requests instead.
- No conversational follow-up/context ("no, I meant tomorrow") — each
  request is handled independently.
- Android — this design is iOS Shortcuts-specific. Android's nearest
  equivalent (a PWA with the browser's speech-to-text) is a different,
  separate design if ever wanted.
- No kiosk wake-word/always-listening mode — this is deliberately
  push-driven from the user's own phone via Siri, not the wall-mounted
  display's mic.

## 3. Flow

```
User: "Hey Siri, tell the dashboard..."
  -> iOS Shortcut: Dictate Text
  -> Get Contents of URL
       POST https://home.<domain>/api/voice-command
       headers: CF-Access-Client-Id, CF-Access-Client-Secret, Content-Type
       body: {"message": "<dictated text>"}
  -> Backend: classify -> edit -> confirm
  -> Response: {"speech": "Added milk and eggs to groceries."}
  -> Shortcut: Speak Text (response.speech)
```

## 4. Backend changes

### 4.1 Refactor `backend/routers/ai.py`

`make_ai_edit_router`'s `_scoped_existing`, `_ask_claude`, and `_reconcile`
are currently closures over one fixed `model`/`resource_label`/
`scope_field`/`extra_instructions`, used only by the per-resource HTTP
routes it builds. The voice endpoint needs the same create/update/delete
logic across *any* of the six resources at request time, so these three
functions move to module level, taking those four values as explicit
parameters instead of closing over them. `make_ai_edit_router` becomes a
thin wrapper that calls the module-level versions with its fixed config —
its own behavior and HTTP routes are unchanged.

A small registry describes each voice-eligible resource once, reused by
both the per-resource routers and the classifier:

```python
@dataclass
class AiEditConfig:
    model: Type[SQLModel]
    resource_label: str        # e.g. "grocery list" — used in prompts
    scope_field: Optional[str] # e.g. "week_of", or None if unscoped
    extra_instructions: str = ""
    primary_field: str = "name" # for building the spoken confirmation

RESOURCE_REGISTRY: dict[str, AiEditConfig] = {
    "meal-plan": AiEditConfig(MealPlanItem, "meal plan", "date", primary_field="name"),
    "workouts": AiEditConfig(Workout, "workout plan", "date", WORKOUT_EXTRA_INSTRUCTIONS, "plan_text"),
    "reminders": AiEditConfig(Reminder, "reminders", None, primary_field="text"),
    "calendar": AiEditConfig(Event, "calendar event", "start", primary_field="title"),
    "groceries": AiEditConfig(GroceryItem, "grocery list", "week_of", primary_field="name"),
    "filament": AiEditConfig(FilamentSpool, "filament spool", None, primary_field="color_name"),
}
```

### 4.2 New resource wirings (`main.py`)

Three new `make_ai_edit_router` calls, mirroring the existing ones:
- `Event` at `/api/events`, `scope_field="start"` (same current-week
  default window as the date-scoped resources; a `date` range compares
  fine against a `datetime` column at midnight boundaries, same as the
  external-events endpoint already does).
- `GroceryItem` at `/api/groceries`, `scope_field="week_of"`.
- `FilamentSpool` at `/api/filament`, no `scope_field` (small manually-kept
  list — always fully in scope, like `Reminder`).

These are backend-only additions. No `aiEditable` flag is added to
`resourceConfigs.js` for these — the on-screen AI-edit box for those pages
is a separate, un-requested feature; easy to add later if wanted.

### 4.3 New endpoint: `backend/routers/voice.py`

`POST /api/voice-command`, body `{"message": str}`, response
`{"speech": str}`. Always returns HTTP 200 for *recognized* failure modes
(ambiguous request, AI refusal) so the Shortcut always has something to
speak; only a genuinely unexpected server error is a 500.

1. **Classify** — one small Claude call: system prompt lists each
   `RESOURCE_REGISTRY` key with its `resource_label` as a one-line
   description, asks for the best-matching key or `null` if none fit
   confidently. Structured output, one field, cheap/fast.
   - `null` (or an API error at this step) → `{"speech": "I'm not sure what you meant — try rephrasing."}`.
2. **Edit** — look up the matched key's `AiEditConfig`, call the
   module-level `_scoped_existing` / `_ask_claude` / `_reconcile(commit=True)`
   exactly as the resource's own `/ai-edit` route would (default
   current-week scope for scoped resources — voice requests carry no
   `date_from`/`date_to`).
   - **Known limitation**: the scope note `_ask_claude` sends doesn't just
     limit what the AI *sees* — it explicitly forbids creating entries
     outside that window too (`"you may only affect entries with
     {scope_field} between X and Y"`). So for date-scoped resources
     (calendar, meal-plan, workouts, groceries), voice can only
     add/change/remove things in the **current week**. "Add a dentist
     appointment next month" won't work via voice in v1 — it'll either
     get silently ignored or come back with a confirmation that doesn't
     match what was asked. Reminders and filament (unscoped) aren't
     affected. Worth confirming this is acceptable before implementation;
     lifting it later means teaching the classifier to also extract a
     target date range from the utterance and pass it through as
     `date_from`/`date_to`.
   - AI/API failure at this step → `{"speech": "Something went wrong updating that — try again in a bit."}`.
3. **Confirm** — deterministic sentence built from the `created` /
   `updated` / `deleted` lists returned by `_reconcile`, using each item's
   `primary_field`: e.g. `"Added milk, eggs to groceries."` /
   `"Updated 1 item in workouts."` / `"Removed Tuesday's lunch from meal plan."`.
   No second AI call — just string formatting.

### 4.4 Cloudflare Access Service Token

`/api/voice-command` must be reachable without an interactive login. In
the Cloudflare Zero Trust dashboard:
1. **Access → Service Auth → Service Tokens** — create a token (e.g.
   `voice-shortcut`). Cloudflare shows a Client ID and Client Secret once —
   save both.
2. **Access → Applications** — edit the dashboard's Access application,
   add a policy above the existing login policy: Action `Service Auth`,
   include rule = that Service Token, scoped via a path rule to
   `/api/voice-command*` only (a separate policy, not a change to the
   existing login-required policy covering everything else).
3. The Shortcut sends `CF-Access-Client-Id` and `CF-Access-Client-Secret`
   as request headers on every call — Cloudflare validates them before the
   request ever reaches the backend.

### 4.5 iOS Shortcut (user-configured, not code)

1. Shortcuts app → new Shortcut → **Dictate Text**.
2. **Get Contents of URL**: `https://home.<domain>/api/voice-command`,
   Method `POST`, Headers: `CF-Access-Client-Id`, `CF-Access-Client-Secret`,
   `Content-Type: application/json`. Body (JSON): `{"message": <Dictated Text>}`.
3. **Get Dictionary from Input** on the response, get value for key
   `speech`.
4. **Speak Text** with that value.
5. **If** the request failed (non-200 or no `speech` key) → **Speak Text**
   a fixed fallback ("Couldn't reach the dashboard").
6. Name the Shortcut something Siri-invocable ("tell the dashboard") and
   optionally add it to Siri via Settings → Siri → All Shortcuts, or record
   a custom phrase.

## 5. Error handling summary

| Situation | Response |
|---|---|
| `ANTHROPIC_API_KEY` unset | 503 with detail (existing `get_anthropic_client` behavior; Shortcut's fallback branch speaks the generic failure phrase) |
| Classification returns no confident match | 200, apologetic `speech`, nothing changed |
| Claude API error during classify or edit | 200, apologetic `speech`, nothing changed |
| Successful edit | 200, `speech` describing what changed |
| Anything unexpected (bug, DB error) | 500 — Shortcut's `If` branch catches it |

## 6. Testing

- Backend: unit tests for the new module-level `_scoped_existing` /
  `_ask_claude` / `_reconcile` (same coverage the closures had, now
  callable directly), the classifier's resource-matching (mock the
  Claude client, assert routing to the right `AiEditConfig`), the
  confirmation-sentence builder (created/updated/deleted → expected
  string, per resource's `primary_field`), and the three new resource
  routers (mirroring the existing `test_ai_edit*.py` pattern).
- No frontend changes or tests — this bypasses the browser entirely.
- Manual end-to-end check: real Shortcut run against a deployed instance,
  covering one request per resource type plus one deliberately ambiguous
  request.

## 7. Out of scope / explicit non-goals

- Compound multi-resource requests in one utterance.
- Conversational context across requests.
- Android support.
- Kiosk-device wake-word/always-listening mode.
- On-screen AI-edit box for calendar/groceries/filament pages (the new
  routers exist for voice to use; wiring them into `AiEditBox` on those
  pages is a separate, easy follow-up if wanted).
