# Life Dashboard — Frontend Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the static dashboard shell (spec section 9, build-order item 1): a mobile-friendly React app with manual create/edit/delete pages for all 9 backend resources (events, meal plan, groceries, workouts, assignments, exams, reminders, packages) plus a home page with a Quick Links tile row (label + URL, e.g. linking to the already-hosted Immich instance) and a section-nav to every resource page. No AI editing yet, no external service integrations yet — those are later plans. This is Phase 1b, building directly on Phase 1a's backend API (already merged to `main`).

**Architecture:** A Vite + React app. Because all 9 resources need the same list/create/edit/delete UI shape (mirroring the backend's generic CRUD factory), a single config-driven `ResourcePage` component renders every resource's page from a per-resource field-list description, instead of 9 hand-built pages. A thin `api.js` module wraps `fetch` against the backend's REST endpoints. The backend needs one small addition — CORS middleware — since the frontend (a different origin: Vite dev server or its own Docker container) calls the backend's API cross-origin.

**Tech Stack:** React 18, Vite 5, react-router-dom 6, Vitest + React Testing Library for tests, plain CSS (no UI framework — YAGNI, spec doesn't call for one). Backend addition: FastAPI's `CORSMiddleware`.

**Spec:** `life-dashboard-spec.md` (repo root) — this plan implements section 4.9 (Quick Links) and the "static dashboard shell" item in section 9's build order, for all resources in section 6 except the AI-editing behavior (that's a later plan, per spec section 5).

## Global Constraints

- Frontend must be mobile-friendly (spec section 3) — no desktop-only assumptions in layout/CSS.
- No AI editing in this phase — forms are plain manual CRUD, not natural-language input.
- No PWA/offline support required for v1 (spec section 3).
- Do not change any backend Python class names, API path prefixes, or JSON field names — Phase 1a's tests and the plans after this one (AI layer, integrations) depend on them being stable. The only backend change this plan makes is adding CORS middleware to `main.py`.
- This frontend lives in `life-dashboard/frontend/`, alongside the existing `life-dashboard/backend/` from Phase 1a.
- Every resource's meal-slot field must offer exactly: breakfast, lunch, dinner, snack (spec decision, section 8).

---

### Task 1: Frontend Project Scaffold, API Client, and Backend CORS

**Files:**
- Create: `life-dashboard/frontend/package.json`
- Create: `life-dashboard/frontend/vite.config.js`
- Create: `life-dashboard/frontend/index.html`
- Create: `life-dashboard/frontend/.gitignore`
- Create: `life-dashboard/frontend/src/main.jsx`
- Create: `life-dashboard/frontend/src/setupTests.js`
- Create: `life-dashboard/frontend/src/api.js`
- Create: `life-dashboard/frontend/src/api.test.js`
- Modify: `life-dashboard/backend/main.py`
- Create: `life-dashboard/backend/tests/test_cors.py`

**Interfaces:**
- Produces: `src/api.js` exposes `listItems(resource)`, `getItem(resource, id)`, `createItem(resource, data)`, `updateItem(resource, id, data)`, `deleteItem(resource, id)` — all return Promises resolving to parsed JSON (or `null` for a 204), and reject with an `Error` whose `.message` is a human-readable string on any non-2xx response. Task 2 and Task 3 import these five functions exactly as named.
- Consumes: the backend's existing REST endpoints from Phase 1a (`/api/<resource>/`, `/api/<resource>/{id}`) — no backend endpoint changes in this task other than adding CORS headers.

- [ ] **Step 1: Add CORS middleware to the backend (write the failing test first)**

`life-dashboard/backend/tests/test_cors.py`:

```python
def test_cors_allows_configured_frontend_origin(client):
    resp = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"
```

Run it to verify it fails:

```bash
cd life-dashboard/backend
.venv/Scripts/pytest tests/test_cors.py -v
```

Expected: FAIL — `KeyError: 'access-control-allow-origin'` (no CORS middleware registered yet).

Add the middleware to `life-dashboard/backend/main.py`. Insert this near the top of the file, after the imports and before the router registrations, and add the one new import at the top with the other imports:

```python
import os

from fastapi.middleware.cors import CORSMiddleware
```

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

(Place the `app.add_middleware(...)` call immediately after `app = FastAPI(title="Life Dashboard API")`, before the `@app.on_event("startup")` block.)

Run the test again to verify it passes:

```bash
.venv/Scripts/pytest tests/test_cors.py -v
```

Expected: PASS. Then run the full backend suite to confirm no regressions:

```bash
.venv/Scripts/pytest -v
```

Expected: all 30 tests pass (29 existing + 1 new).

Commit this backend change on its own before starting the frontend scaffold:

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/backend/main.py life-dashboard/backend/tests/test_cors.py
git commit -m "$(cat <<'EOF'
feat: add CORS middleware so the frontend can call the API cross-origin

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

- [ ] **Step 2: Create the frontend directory and package.json**

`life-dashboard/frontend/package.json`:

```json
{
  "name": "life-dashboard-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 3: Create Vite config with Vitest set up**

`life-dashboard/frontend/vite.config.js`:

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.js",
    globals: true,
  },
});
```

`life-dashboard/frontend/src/setupTests.js`:

```js
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Create index.html and main.jsx entry point**

`life-dashboard/frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Life Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

`life-dashboard/frontend/src/main.jsx` (references `App` and `./index.css`, which Task 3 creates — this file won't run correctly until then, but it doesn't need to for this task's tests, which target `api.js` directly):

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 5: Create .gitignore for the frontend**

`life-dashboard/frontend/.gitignore`:

```
node_modules/
dist/
.env.local
```

- [ ] **Step 6: Install dependencies**

```bash
cd life-dashboard/frontend
npm install
```

Expected: installs cleanly, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 7: Write the failing test for the API client**

`life-dashboard/frontend/src/api.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listItems, getItem, createItem, updateItem, deleteItem } from "./api";

function mockFetchOnce(body, { ok = true, status = 200 } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listItems fetches the resource collection", async () => {
    mockFetchOnce([{ id: 1, label: "Immich", url: "https://photos.example.com" }]);
    const result = await listItems("quick-links");
    expect(result).toEqual([{ id: 1, label: "Immich", url: "https://photos.example.com" }]);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/quick-links/"),
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) })
    );
  });

  it("getItem fetches a single item by id", async () => {
    mockFetchOnce({ id: 1, label: "Immich", url: "https://photos.example.com" });
    const result = await getItem("quick-links", 1);
    expect(result.label).toBe("Immich");
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/quick-links/1"), expect.anything());
  });

  it("createItem POSTs the payload and returns the created item", async () => {
    mockFetchOnce({ id: 2, label: "Router", url: "https://192.168.1.1" });
    const result = await createItem("quick-links", { label: "Router", url: "https://192.168.1.1" });
    expect(result.id).toBe(2);
    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ label: "Router", url: "https://192.168.1.1" });
  });

  it("updateItem PUTs the payload", async () => {
    mockFetchOnce({ id: 2, label: "Router Admin", url: "https://192.168.1.1" });
    const result = await updateItem("quick-links", 2, { label: "Router Admin" });
    expect(result.label).toBe("Router Admin");
    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe("PUT");
  });

  it("deleteItem sends DELETE and returns null on 204", async () => {
    mockFetchOnce(null, { ok: true, status: 204 });
    const result = await deleteItem("quick-links", 2);
    expect(result).toBeNull();
    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe("DELETE");
  });

  it("rejects with a readable error message on a non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: [{ msg: "Field required" }] }),
    });
    await expect(createItem("meal-plan", {})).rejects.toThrow();
  });
});
```

Run it to verify it fails:

```bash
npm test -- src/api.test.js
```

Expected: FAIL — `Failed to resolve import "./api"` (file doesn't exist yet).

- [ ] **Step 8: Write api.js**

`life-dashboard/frontend/src/api.js`:

```js
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.detail ? JSON.stringify(body.detail) : `Request failed: ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

export function listItems(resource) {
  return request(`/api/${resource}/`);
}

export function getItem(resource, id) {
  return request(`/api/${resource}/${id}`);
}

export function createItem(resource, data) {
  return request(`/api/${resource}/`, { method: "POST", body: JSON.stringify(data) });
}

export function updateItem(resource, id, data) {
  return request(`/api/${resource}/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function deleteItem(resource, id) {
  return request(`/api/${resource}/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 9: Run the test to verify it passes**

```bash
npm test -- src/api.test.js
```

Expected: PASS (6 tests).

- [ ] **Step 10: Commit**

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/frontend/package.json life-dashboard/frontend/package-lock.json \
  life-dashboard/frontend/vite.config.js life-dashboard/frontend/index.html \
  life-dashboard/frontend/.gitignore life-dashboard/frontend/src/main.jsx \
  life-dashboard/frontend/src/setupTests.js life-dashboard/frontend/src/api.js \
  life-dashboard/frontend/src/api.test.js
git commit -m "$(cat <<'EOF'
feat: scaffold life-dashboard frontend with a tested API client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 2: Resource Config and Generic ResourcePage Component

**Files:**
- Create: `life-dashboard/frontend/src/resourceConfigs.js`
- Create: `life-dashboard/frontend/src/components/ResourcePage.jsx`
- Create: `life-dashboard/frontend/src/components/ResourcePage.test.jsx`

**Interfaces:**
- Consumes: `listItems`, `createItem`, `updateItem`, `deleteItem` from `src/api.js` (Task 1).
- Produces: `resourceConfigs.js` exports `RESOURCES`, an array of `{ key, label, fields }` objects, one per resource (excluding quick-links, which Task 3's Home page manages directly). Each `fields` entry is `{ name, label, type, required?, options? }` where `type` is one of `text | textarea | date | datetime-local | select | checkbox | list`. `ResourcePage.jsx` exports a default component `ResourcePage({ resourceKey, label, fields })` — Task 3 imports both and wires them into routes.

- [ ] **Step 1: Write resourceConfigs.js**

`life-dashboard/frontend/src/resourceConfigs.js`:

```js
export const RESOURCES = [
  {
    key: "events",
    label: "Calendar",
    fields: [
      { name: "source", label: "Source", type: "select", options: ["self", "girlfriend", "school"], required: true },
      { name: "title", label: "Title", type: "text", required: true },
      { name: "start", label: "Start", type: "datetime-local", required: true },
      { name: "end", label: "End", type: "datetime-local", required: true },
      { name: "location", label: "Location", type: "text" },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
  {
    key: "meal-plan",
    label: "Meal Plan",
    fields: [
      { name: "date", label: "Date", type: "date", required: true },
      { name: "meal_slot", label: "Meal", type: "select", options: ["breakfast", "lunch", "dinner", "snack"], required: true },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "ingredients", label: "Ingredients (comma-separated)", type: "list" },
    ],
  },
  {
    key: "groceries",
    label: "Groceries",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "quantity", label: "Quantity", type: "text" },
      { name: "checked", label: "Checked", type: "checkbox" },
      { name: "week_of", label: "Week Of", type: "date", required: true },
    ],
  },
  {
    key: "workouts",
    label: "Workouts",
    fields: [
      { name: "date", label: "Date", type: "date", required: true },
      { name: "plan_text", label: "Plan", type: "textarea", required: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
  {
    key: "assignments",
    label: "Assignments",
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "course", label: "Course", type: "text", required: true },
      { name: "due_date", label: "Due Date", type: "date", required: true },
      { name: "status", label: "Status", type: "select", options: ["not_started", "in_progress", "done"], required: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
  {
    key: "exams",
    label: "Exams",
    fields: [
      { name: "subject", label: "Subject", type: "text", required: true },
      { name: "date", label: "Date", type: "date", required: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
  {
    key: "reminders",
    label: "Reminders",
    fields: [
      { name: "text", label: "Text", type: "text", required: true },
      { name: "trigger_time", label: "Trigger Time", type: "datetime-local", required: true },
      { name: "sent", label: "Sent", type: "checkbox" },
    ],
  },
  {
    key: "packages",
    label: "Packages",
    fields: [
      { name: "tracking_number", label: "Tracking Number", type: "text", required: true },
      { name: "carrier", label: "Carrier", type: "text" },
      { name: "status", label: "Status", type: "text" },
    ],
  },
];
```

- [ ] **Step 2: Write the failing test for ResourcePage**

`life-dashboard/frontend/src/components/ResourcePage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResourcePage from "./ResourcePage";
import * as api from "../api";

const fields = [
  { name: "name", label: "Name", type: "text", required: true },
  { name: "quantity", label: "Quantity", type: "text" },
  { name: "checked", label: "Checked", type: "checkbox" },
];

describe("ResourcePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders items returned by listItems", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([{ id: 1, name: "Milk", quantity: "1 gal", checked: false }]);
    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);
    expect(await screen.findByText("Milk")).toBeInTheDocument();
  });

  it("submits the create form and refreshes the list", async () => {
    vi.spyOn(api, "listItems").mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 1, name: "Eggs", quantity: "1 dozen", checked: false },
    ]);
    const createSpy = vi.spyOn(api, "createItem").mockResolvedValue({ id: 1, name: "Eggs", quantity: "1 dozen", checked: false });
    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);

    await waitFor(() => expect(api.listItems).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByLabelText("Name"), "Eggs");
    await userEvent.type(screen.getByLabelText("Quantity"), "1 dozen");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("groceries", { name: "Eggs", quantity: "1 dozen", checked: false }));
    expect(await screen.findByText("Eggs")).toBeInTheDocument();
  });

  it("populates the form for editing and calls updateItem on submit", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([{ id: 1, name: "Milk", quantity: "1 gal", checked: false }]);
    const updateSpy = vi.spyOn(api, "updateItem").mockResolvedValue({ id: 1, name: "Milk", quantity: "2 gal", checked: false });
    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);

    await screen.findByText("Milk");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Milk");

    await userEvent.clear(screen.getByLabelText("Quantity"));
    await userEvent.type(screen.getByLabelText("Quantity"), "2 gal");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith("groceries", 1, { name: "Milk", quantity: "2 gal", checked: false }));
  });

  it("calls deleteItem and refreshes the list when Delete is clicked", async () => {
    vi.spyOn(api, "listItems").mockResolvedValueOnce([{ id: 1, name: "Milk", quantity: "1 gal", checked: false }]).mockResolvedValueOnce([]);
    const deleteSpy = vi.spyOn(api, "deleteItem").mockResolvedValue(null);
    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);

    await screen.findByText("Milk");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith("groceries", 1));
    await waitFor(() => expect(screen.queryByText("Milk")).not.toBeInTheDocument());
  });

  it("shows an error message when the API call fails", async () => {
    vi.spyOn(api, "listItems").mockRejectedValue(new Error("Request failed: 500"));
    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed: 500");
  });

  it("converts a comma-separated list field to an array on submit", async () => {
    const listField = [{ name: "name", label: "Name", type: "text", required: true }, { name: "ingredients", label: "Ingredients", type: "list" }];
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    const createSpy = vi.spyOn(api, "createItem").mockResolvedValue({ id: 1, name: "Tacos", ingredients: ["beef", "salsa"] });
    render(<ResourcePage resourceKey="meal-plan" label="Meal Plan" fields={listField} />);

    await userEvent.type(screen.getByLabelText("Name"), "Tacos");
    await userEvent.type(screen.getByLabelText("Ingredients"), "beef, salsa");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("meal-plan", { name: "Tacos", ingredients: ["beef", "salsa"] }));
  });
});
```

Run it to verify it fails:

```bash
npm test -- src/components/ResourcePage.test.jsx
```

Expected: FAIL — `Failed to resolve import "./ResourcePage"` (file doesn't exist yet).

- [ ] **Step 3: Write ResourcePage.jsx**

`life-dashboard/frontend/src/components/ResourcePage.jsx`:

```jsx
import { useEffect, useState } from "react";
import { listItems, createItem, updateItem, deleteItem } from "../api";

function emptyForm(fields) {
  const form = {};
  for (const field of fields) {
    form[field.name] = field.type === "checkbox" ? false : "";
  }
  return form;
}

function toPayload(fields, form) {
  const payload = {};
  for (const field of fields) {
    if (field.type === "list") {
      payload[field.name] = form[field.name]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (field.type === "checkbox") {
      payload[field.name] = !!form[field.name];
    } else {
      payload[field.name] = form[field.name] === "" ? null : form[field.name];
    }
  }
  return payload;
}

function toFormValues(fields, item) {
  const form = {};
  for (const field of fields) {
    const value = item[field.name];
    if (field.type === "list") {
      form[field.name] = Array.isArray(value) ? value.join(", ") : "";
    } else {
      form[field.name] = value ?? "";
    }
  }
  return form;
}

export default function ResourcePage({ resourceKey, label, fields }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(() => emptyForm(fields));
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const data = await listItems(resourceKey);
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceKey]);

  function handleChange(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const payload = toPayload(fields, form);
    try {
      if (editingId) {
        await updateItem(resourceKey, editingId, payload);
      } else {
        await createItem(resourceKey, payload);
      }
      setForm(emptyForm(fields));
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(item) {
    setEditingId(item.id);
    setForm(toFormValues(fields, item));
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm(fields));
  }

  async function handleDelete(id) {
    setError(null);
    try {
      await deleteItem(resourceKey, id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="resource-page">
      <h1>{label}</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit} className="resource-form">
        {fields.map((field) => (
          <label key={field.name} htmlFor={`field-${field.name}`}>
            {field.label}
            {field.type === "select" ? (
              <select
                id={`field-${field.name}`}
                value={form[field.name]}
                required={field.required}
                onChange={(e) => handleChange(field.name, e.target.value)}
              >
                <option value="" disabled>
                  Select…
                </option>
                {field.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : field.type === "checkbox" ? (
              <input
                id={`field-${field.name}`}
                type="checkbox"
                checked={!!form[field.name]}
                onChange={(e) => handleChange(field.name, e.target.checked)}
              />
            ) : field.type === "textarea" ? (
              <textarea
                id={`field-${field.name}`}
                value={form[field.name]}
                onChange={(e) => handleChange(field.name, e.target.value)}
              />
            ) : (
              <input
                id={`field-${field.name}`}
                type={field.type === "list" ? "text" : field.type}
                value={form[field.name]}
                required={field.required}
                onChange={(e) => handleChange(field.name, e.target.value)}
              />
            )}
          </label>
        ))}
        <button type="submit">{editingId ? "Save" : "Add"}</button>
        {editingId && (
          <button type="button" onClick={cancelEdit}>
            Cancel
          </button>
        )}
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="resource-table">
          <thead>
            <tr>
              {fields.map((field) => (
                <th key={field.name}>{field.label}</th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                {fields.map((field) => (
                  <td key={field.name}>
                    {field.type === "list"
                      ? (item[field.name] || []).join(", ")
                      : field.type === "checkbox"
                        ? item[field.name]
                          ? "Yes"
                          : "No"
                        : String(item[field.name] ?? "")}
                  </td>
                ))}
                <td>
                  <button onClick={() => startEdit(item)}>Edit</button>
                  <button onClick={() => handleDelete(item.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- src/components/ResourcePage.test.jsx
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/frontend/src/resourceConfigs.js life-dashboard/frontend/src/components/ResourcePage.jsx \
  life-dashboard/frontend/src/components/ResourcePage.test.jsx
git commit -m "$(cat <<'EOF'
feat: add resource config and a generic ResourcePage CRUD component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 3: App Routing, Home Page with Quick Links, and Base Styling

**Files:**
- Create: `life-dashboard/frontend/src/App.jsx`
- Create: `life-dashboard/frontend/src/App.test.jsx`
- Create: `life-dashboard/frontend/src/pages/Home.jsx`
- Create: `life-dashboard/frontend/src/pages/Home.test.jsx`
- Create: `life-dashboard/frontend/src/index.css`
- Create: `life-dashboard/frontend/src/App.css`

**Interfaces:**
- Consumes: `RESOURCES` from `resourceConfigs.js`, `ResourcePage` from `components/ResourcePage.jsx` (Task 2); `listItems`, `createItem`, `deleteItem` from `api.js` (Task 1).
- Produces: `App.jsx` exports a default component rendering the full routed app — this is what `main.jsx` (Task 1) renders. `Home.jsx` exports a default component for the `/` route.

- [ ] **Step 1: Write the failing test for Home**

`life-dashboard/frontend/src/pages/Home.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Home from "./Home";
import * as api from "../api";

describe("Home", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders quick links returned by the API", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([{ id: 1, label: "Immich", url: "https://photos.example.com" }]);
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    const link = await screen.findByRole("link", { name: "Immich" });
    expect(link).toHaveAttribute("href", "https://photos.example.com");
  });

  it("adds a quick link via the form", async () => {
    vi.spyOn(api, "listItems").mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 1, label: "Router", url: "https://192.168.1.1" },
    ]);
    const createSpy = vi.spyOn(api, "createItem").mockResolvedValue({ id: 1, label: "Router", url: "https://192.168.1.1" });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );

    await waitFor(() => expect(api.listItems).toHaveBeenCalledTimes(1));
    await userEvent.type(screen.getByPlaceholderText("Label (e.g. Immich)"), "Router");
    await userEvent.type(screen.getByPlaceholderText("URL"), "https://192.168.1.1");
    await userEvent.click(screen.getByRole("button", { name: "Add Link" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("quick-links", { label: "Router", url: "https://192.168.1.1" }));
  });

  it("renders a nav link for every resource", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(await screen.findByRole("link", { name: "Calendar" })).toHaveAttribute("href", "/events");
    expect(screen.getByRole("link", { name: "Meal Plan" })).toHaveAttribute("href", "/meal-plan");
    expect(screen.getByRole("link", { name: "Packages" })).toHaveAttribute("href", "/packages");
  });
});
```

Run it to verify it fails (`Home.jsx` doesn't exist yet):

```bash
npm test -- src/pages/Home.test.jsx
```

Expected: FAIL — `Failed to resolve import "./Home"`.

- [ ] **Step 2: Write Home.jsx**

`life-dashboard/frontend/src/pages/Home.jsx`:

```jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listItems, createItem, deleteItem } from "../api";
import { RESOURCES } from "../resourceConfigs";

export default function Home() {
  const [links, setLinks] = useState([]);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState(null);

  async function refresh() {
    try {
      const data = await listItems("quick-links");
      setLinks(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAddLink(e) {
    e.preventDefault();
    setError(null);
    try {
      await createItem("quick-links", { label, url });
      setLabel("");
      setUrl("");
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteLink(id) {
    setError(null);
    try {
      await deleteItem("quick-links", id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="home">
      <h1>Life Dashboard</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section>
        <h2>Quick Links</h2>
        <div className="quick-links">
          {links.map((link) => (
            <div key={link.id} className="quick-link-tile">
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
              <button onClick={() => handleDeleteLink(link.id)}>Remove</button>
            </div>
          ))}
        </div>
        <form onSubmit={handleAddLink} className="quick-link-form">
          <input placeholder="Label (e.g. Immich)" value={label} required onChange={(e) => setLabel(e.target.value)} />
          <input placeholder="URL" type="url" value={url} required onChange={(e) => setUrl(e.target.value)} />
          <button type="submit">Add Link</button>
        </form>
      </section>

      <section>
        <h2>Sections</h2>
        <nav className="section-nav">
          {RESOURCES.map((resource) => (
            <Link key={resource.key} to={`/${resource.key}`} className="section-tile">
              {resource.label}
            </Link>
          ))}
        </nav>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Run the Home test to verify it passes**

```bash
npm test -- src/pages/Home.test.jsx
```

Expected: PASS (3 tests).

- [ ] **Step 4: Write the failing test for App routing**

`life-dashboard/frontend/src/App.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import * as api from "./api";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, BrowserRouter: actual.MemoryRouter };
});

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    window.history.pushState({}, "", "/");
  });

  it("renders the Home page at /", async () => {
    render(<App />);
    expect(await screen.findByText("Life Dashboard")).toBeInTheDocument();
  });

  it("renders the Groceries ResourcePage at /groceries", async () => {
    window.history.pushState({}, "", "/groceries");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Groceries" })).toBeInTheDocument();
  });
});
```

Run it to verify it fails (`App.jsx` doesn't exist yet):

```bash
npm test -- src/App.test.jsx
```

Expected: FAIL — `Failed to resolve import "./App"`.

- [ ] **Step 5: Write App.jsx**

`life-dashboard/frontend/src/App.jsx`:

```jsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import ResourcePage from "./components/ResourcePage";
import { RESOURCES } from "./resourceConfigs";
import "./App.css";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        {RESOURCES.map((resource) => (
          <Route
            key={resource.key}
            path={`/${resource.key}`}
            element={<ResourcePage resourceKey={resource.key} label={resource.label} fields={resource.fields} />}
          />
        ))}
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 6: Run the App test to verify it passes**

```bash
npm test -- src/App.test.jsx
```

Expected: PASS (2 tests).

- [ ] **Step 7: Add base styling for mobile-friendliness**

`life-dashboard/frontend/src/index.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #f7f7f8;
  color: #1a1a1a;
}

button {
  cursor: pointer;
}

.error {
  color: #b00020;
  font-weight: 600;
}
```

`life-dashboard/frontend/src/App.css`:

```css
.home,
.resource-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 1rem;
}

.quick-links,
.section-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.quick-link-tile,
.section-tile {
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  text-decoration: none;
  color: inherit;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.quick-link-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.quick-link-form input {
  flex: 1 1 200px;
  padding: 0.5rem;
}

.resource-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.resource-form label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-weight: 600;
}

.resource-form input,
.resource-form select,
.resource-form textarea {
  padding: 0.5rem;
  font-size: 1rem;
}

.resource-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
}

.resource-table th,
.resource-table td {
  border-bottom: 1px solid #eee;
  padding: 0.5rem;
  text-align: left;
  font-size: 0.9rem;
}

@media (max-width: 480px) {
  .resource-table {
    display: block;
    overflow-x: auto;
  }
}
```

- [ ] **Step 8: Run the full frontend test suite to confirm no regressions**

```bash
npm test
```

Expected: all tests across all files pass (api.test.js, ResourcePage.test.jsx, Home.test.jsx, App.test.jsx).

- [ ] **Step 9: Commit**

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/frontend/src/App.jsx life-dashboard/frontend/src/App.test.jsx \
  life-dashboard/frontend/src/pages/Home.jsx life-dashboard/frontend/src/pages/Home.test.jsx \
  life-dashboard/frontend/src/index.css life-dashboard/frontend/src/App.css
git commit -m "$(cat <<'EOF'
feat: wire up routing, home page with quick links, and base styling

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

### Task 4: Dockerize the Frontend and Verify the Full Stack

**Files:**
- Create: `life-dashboard/frontend/Dockerfile`
- Create: `life-dashboard/frontend/.dockerignore`
- Modify: `life-dashboard/docker-compose.yml`

**Interfaces:**
- Consumes: `package.json`/`package-lock.json` (Task 1), the built app (`npm run build` output, `dist/`).
- Produces: a container serving the built static frontend on port 80 inside the container, published as `5173:80` on the host, alongside the existing backend service on `8080:8000`. The frontend calls the backend at `http://localhost:8080` (baked in at build time via `VITE_API_BASE_URL`, matching the backend's existing published port from Phase 1a) — the browser (not the container) makes that call, so both services just need their ports published on the host.

- [ ] **Step 1: Write the Dockerfile**

`life-dashboard/frontend/Dockerfile`:

```dockerfile
FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

ARG VITE_API_BASE_URL=http://localhost:8080
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
```

- [ ] **Step 2: Write .dockerignore**

`life-dashboard/frontend/.dockerignore`:

```
node_modules/
dist/
.git/
*.test.jsx
*.test.js
```

- [ ] **Step 3: Add the frontend service to docker-compose.yml**

Read the current `life-dashboard/docker-compose.yml` first (it has one service, `life-dashboard-backend`, from Phase 1a) and add a second service alongside it, keeping the existing `life-dashboard-backend` service and its `life-dashboard-data` volume exactly as they are:

```yaml
services:
  life-dashboard-backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8080:8000"
    volumes:
      - life-dashboard-data:/app/backend/data
    restart: unless-stopped

  life-dashboard-frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        VITE_API_BASE_URL: http://localhost:8080
    ports:
      - "5173:80"
    depends_on:
      - life-dashboard-backend
    restart: unless-stopped

volumes:
  life-dashboard-data:
```

(If the file on disk differs from this — e.g. the volume mount path — preserve whatever is actually there for `life-dashboard-backend` and only add the new `life-dashboard-frontend` service and update `depends_on`/`ports` as shown.)

- [ ] **Step 4: Build both images**

```bash
cd life-dashboard
docker compose build
```

Expected: both `life-dashboard-backend` and `life-dashboard-frontend` build with no errors.

- [ ] **Step 5: Run the full stack and verify the backend is reachable**

```bash
docker compose up -d
curl http://localhost:8080/health
```

Expected: `{"status":"ok"}`.

- [ ] **Step 6: Verify the frontend container serves the built app**

```bash
curl -s http://localhost:5173/ | grep -o "<title>.*</title>"
```

Expected: `<title>Life Dashboard</title>`.

- [ ] **Step 7: Verify CORS allows the frontend's origin to call the backend**

```bash
curl -s -D - -o /dev/null http://localhost:8080/api/quick-links/ -H "Origin: http://localhost:5173"
```

Expected: response headers include `access-control-allow-origin: http://localhost:5173`.

- [ ] **Step 8: Verify a full quick-links round trip works end-to-end (as the frontend would perform it)**

```bash
curl -s -X POST http://localhost:8080/api/quick-links/ \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{"label": "Immich", "url": "https://photos.example.com"}'
curl -s http://localhost:8080/api/quick-links/ -H "Origin: http://localhost:5173"
```

Expected: the POST returns the created record; the GET returns a list containing it.

- [ ] **Step 9: Tear down**

```bash
docker compose down
```

- [ ] **Step 10: Commit**

```bash
cd C:/Users/herma/Documents/Home-server
git add life-dashboard/frontend/Dockerfile life-dashboard/frontend/.dockerignore life-dashboard/docker-compose.yml
git commit -m "$(cat <<'EOF'
feat: containerize the frontend and wire it into the compose stack

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bpJWD7EwNVjT43untE4d6
EOF
)"
```

---

## Note for whoever reviews this phase

Automated coverage here is Vitest/RTL component tests plus curl-based container smoke tests — there is no headless-browser check that the app actually renders correctly and is usable end-to-end in a real browser. Recommend the user open `http://localhost:5173` (with `docker compose up` running) in an actual browser and click through each resource page before considering this phase fully done, per usual UI-verification practice.

## Next Plans (not part of this plan)

1. **AI editing layer** — natural-language endpoints per spec section 5, calling the Anthropic API server-side, plus frontend UI for it.
2. **External integrations** — Google Calendar API / .ics import, ntfy for reminders, package tracking API.
3. **Deployment** — merge into the home server's existing Cloudflare Tunnel config and Access policy, per spec section 7. This is also where the deferred backend-exposure decision (I3 from Phase 1a's review — whether the backend's port should stay published to the host/LAN, or become internal-only behind a reverse proxy once the real network topology is known) gets resolved.
