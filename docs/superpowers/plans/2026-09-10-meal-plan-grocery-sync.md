# Meal Plan → Grocery Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically sync meal plan ingredients into the weekly grocery list (`grocery_items`), provide a manual sync endpoint/button, and provide interactive checkbox toggles for fast shopping check-off.

**Architecture:** A standalone domain helper `backend/grocery_sync.py` handles Monday-based week calculation, ingredient normalization, and additive inserts into `grocery_items` without mutating existing manual or checked items. This is exposed via `POST /api/groceries/sync-meal-plan` and hooked into meal plan CRUD/AI mutations. On the frontend, `ResourcePage` renders live checkboxes for shopping check-off and a "Sync from Meal Plan" button for on-demand sync.

**Tech Stack:** FastAPI, SQLModel/SQLAlchemy, SQLite, React, Vite, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-10-meal-plan-grocery-sync-design.md`

## Global Constraints

- Monday is the start of the week: `week_of = date - timedelta(days=date.weekday())`.
- Additive sync only: never delete, reset, or uncheck existing `grocery_items` for that week.
- Deduplication: ingredient names are compared case-insensitively (e.g., "Eggs" and "eggs" are treated as the same item).
- Existing test suites (backend 60 tests, frontend 29 tests) must remain 100% passing.

---

### Task 1: Core Grocery Sync Domain Logic

**Files:**
- Create: `life-dashboard/backend/grocery_sync.py`
- Test: `life-dashboard/backend/tests/test_grocery_sync.py`

**Interfaces:**
- Produces:
  - `get_week_start(d: date) -> date`
  - `sync_meal_plan_to_groceries(session: Session, week_start: date) -> List[GroceryItem]`

- [ ] **Step 1: Write the failing tests for domain helper**

`life-dashboard/backend/tests/test_grocery_sync.py`:
```python
from datetime import date, timedelta
from sqlmodel import Session, select

from backend.grocery_sync import get_week_start, sync_meal_plan_to_groceries
from backend.models import GroceryItem, MealPlanItem, MealSlot


def test_get_week_start():
    # 2026-09-10 is a Thursday -> Monday is 2026-09-07
    assert get_week_start(date(2026, 9, 10)) == date(2026, 9, 7)
    # 2026-09-07 is Monday -> Monday is 2026-09-07
    assert get_week_start(date(2026, 9, 7)) == date(2026, 9, 7)
    # 2026-09-13 is Sunday -> Monday is 2026-09-07
    assert get_week_start(date(2026, 9, 13)) == date(2026, 9, 7)


def test_sync_meal_plan_to_groceries_creates_missing_items(session: Session):
    week_start = date(2026, 9, 7)
    meal1 = MealPlanItem(
        date=date(2026, 9, 8),
        meal_slot=MealSlot.dinner,
        name="Tacos",
        ingredients=["Ground Beef", "Tortillas", "Salsa"],
    )
    meal2 = MealPlanItem(
        date=date(2026, 9, 9),
        meal_slot=MealSlot.dinner,
        name="Burritos",
        ingredients=["tortillas", "Rice", "Cheese"],
    )
    session.add(meal1)
    session.add(meal2)
    session.commit()

    added = sync_meal_plan_to_groceries(session, week_start)
    assert len(added) == 5
    added_names = {item.name for item in added}
    assert added_names == {"Ground Beef", "Tortillas", "Salsa", "Rice", "Cheese"}

    # Verify rows in DB
    items = session.exec(select(GroceryItem).where(GroceryItem.week_of == week_start)).all()
    assert len(items) == 5
    assert all(not item.checked for item in items)


def test_sync_meal_plan_preserves_existing_and_checked_items(session: Session):
    week_start = date(2026, 9, 7)
    # Pre-existing manual item and checked item
    existing1 = GroceryItem(name="Tortillas", week_of=week_start, checked=True)
    existing2 = GroceryItem(name="Paper Towels", week_of=week_start, checked=False)
    session.add(existing1)
    session.add(existing2)

    meal = MealPlanItem(
        date=date(2026, 9, 8),
        meal_slot=MealSlot.dinner,
        name="Tacos",
        ingredients=["tortillas", "Salsa"],
    )
    session.add(meal)
    session.commit()

    added = sync_meal_plan_to_groceries(session, week_start)
    assert len(added) == 1
    assert added[0].name == "Salsa"

    # Verify existing items untouched
    tortillas = session.exec(
        select(GroceryItem).where(GroceryItem.week_of == week_start, GroceryItem.name == "Tortillas")
    ).first()
    assert tortillas is not None
    assert tortillas.checked is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_grocery_sync.py -v` in `life-dashboard/backend`
Expected: FAIL (ModuleNotFoundError: No module named 'backend.grocery_sync')

- [ ] **Step 3: Implement `backend/grocery_sync.py`**

`life-dashboard/backend/grocery_sync.py`:
```python
from datetime import date, timedelta
from typing import List
from sqlmodel import Session, select

from backend.models import GroceryItem, MealPlanItem


def get_week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def sync_meal_plan_to_groceries(session: Session, week_start: date) -> List[GroceryItem]:
    week_end = week_start + timedelta(days=6)
    meals = session.exec(
        select(MealPlanItem).where(MealPlanItem.date >= week_start, MealPlanItem.date <= week_end)
    ).all()

    # Collect unique ingredients maintaining first seen casing
    seen_lower = set()
    ingredients_to_sync = []
    for meal in meals:
        for ing in meal.ingredients or []:
            cleaned = ing.strip()
            if cleaned and cleaned.lower() not in seen_lower:
                seen_lower.add(cleaned.lower())
                ingredients_to_sync.append(cleaned)

    # Fetch existing groceries for this week
    existing_groceries = session.exec(
        select(GroceryItem).where(GroceryItem.week_of == week_start)
    ).all()
    existing_lower = {g.name.strip().lower() for g in existing_groceries}

    added = []
    for ing in ingredients_to_sync:
        if ing.lower() not in existing_lower:
            new_item = GroceryItem(
                name=ing,
                week_of=week_start,
                checked=False,
                quantity=None,
            )
            session.add(new_item)
            added.append(new_item)
            existing_lower.add(ing.lower())

    if added:
        session.commit()
        for item in added:
            session.refresh(item)

    return added
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_grocery_sync.py -v`
Expected: PASS (all 3 tests pass)

- [ ] **Step 5: Commit**

```bash
git add backend/grocery_sync.py backend/tests/test_grocery_sync.py
git commit -m "feat: implement core grocery sync logic from meal plan"
```

---

### Task 2: Manual Sync Endpoint (`POST /api/groceries/sync-meal-plan`)

**Files:**
- Modify: `life-dashboard/backend/main.py`
- Test: `life-dashboard/backend/tests/test_grocery_sync.py`

**Interfaces:**
- Consumes: `sync_meal_plan_to_groceries`
- Produces: `POST /api/groceries/sync-meal-plan?week_of=YYYY-MM-DD` endpoint returning `{"added": List[GroceryItem], "week_of": date}`

- [ ] **Step 1: Write failing test for sync endpoint**

Append to `life-dashboard/backend/tests/test_grocery_sync.py`:
```python
def test_sync_meal_plan_endpoint(client, session: Session):
    meal = MealPlanItem(
        date=date(2026, 9, 8),
        meal_slot=MealSlot.dinner,
        name="Pasta",
        ingredients=["Noodles", "Marinara"],
    )
    session.add(meal)
    session.commit()

    resp = client.post("/api/groceries/sync-meal-plan?week_of=2026-09-08")
    assert resp.status_code == 200
    data = resp.json()
    assert data["week_of"] == "2026-09-07"
    assert len(data["added"]) == 2
    names = {item["name"] for item in data["added"]}
    assert names == {"Noodles", "Marinara"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_grocery_sync.py::test_sync_meal_plan_endpoint -v`
Expected: FAIL 404 Not Found

- [ ] **Step 3: Wire router endpoint in `backend/main.py`**

Modify `life-dashboard/backend/main.py`:
Add sync endpoint directly or via a router before/after crud routers:
```python
from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session
from backend.database import get_session
from backend.grocery_sync import get_week_start, sync_meal_plan_to_groceries

grocery_sync_router = APIRouter(prefix="/api/groceries", tags=["groceries"])

@grocery_sync_router.post("/sync-meal-plan")
def sync_meal_plan_endpoint(
    week_of: Optional[date] = Query(default=None),
    session: Session = Depends(get_session),
):
    target_date = week_of or date.today()
    week_start = get_week_start(target_date)
    added = sync_meal_plan_to_groceries(session, week_start)
    return {"added": added, "week_of": week_start}

app.include_router(grocery_sync_router)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_grocery_sync.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_grocery_sync.py
git commit -m "feat: add POST /api/groceries/sync-meal-plan endpoint"
```

---

### Task 3: Automated Sync Triggers on Meal Plan Mutations & AI Apply

**Files:**
- Modify: `life-dashboard/backend/crud.py` (or post-mutation hook)
- Modify: `life-dashboard/backend/ai.py`
- Test: `life-dashboard/backend/tests/test_grocery_sync.py`

**Interfaces:**
- When `MealPlanItem` is created, updated, or deleted via CRUD or applied via AI, `sync_meal_plan_to_groceries` is executed for the relevant `week_of`.

- [ ] **Step 1: Write failing integration test for auto-sync on CRUD and AI apply**

Append to `life-dashboard/backend/tests/test_grocery_sync.py`:
```python
def test_create_meal_plan_auto_syncs_groceries(client, session: Session):
    resp = client.post(
        "/api/meal-plan/",
        json={
            "date": "2026-09-08",
            "meal_slot": "dinner",
            "name": "Burger",
            "ingredients": ["Patty", "Buns"],
        },
    )
    assert resp.status_code == 201

    # Check grocery list was automatically populated
    groceries = client.get("/api/groceries/").json()
    names = {g["name"] for g in groceries}
    assert "Patty" in names
    assert "Buns" in names


def test_ai_apply_meal_plan_auto_syncs_groceries(client, session: Session):
    resp = client.post(
        "/api/meal-plan/ai-edit/apply",
        json={
            "items": [
                {
                    "date": "2026-09-09",
                    "meal_slot": "dinner",
                    "name": "Pizza",
                    "ingredients": ["Dough", "Mozzarella"],
                }
            ]
        },
    )
    assert resp.status_code == 200

    groceries = client.get("/api/groceries/").json()
    names = {g["name"] for g in groceries}
    assert "Dough" in names
    assert "Mozzarella" in names
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_grocery_sync.py::test_create_meal_plan_auto_syncs_groceries -v`
Expected: FAIL (groceries list empty)

- [ ] **Step 3: Implement auto-sync hook in CRUD router and AI apply**

In `backend/crud.py`:
Add optional `post_mutation_hook(session, item)` callback parameter to `make_crud_router` or handle `MealPlanItem` specifically.
Or in `backend/main.py` / `backend/crud.py`:
When a mutation on `MealPlanItem` occurs (create/update/delete), call `sync_meal_plan_to_groceries(session, get_week_start(item.date))`.

In `backend/ai.py` in `apply_endpoint`:
After committing items, if `resource_label == "meal plan"`, call `sync_meal_plan_to_groceries` for each unique week in the applied items.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_grocery_sync.py -v`
Expected: PASS (all tests pass)

- [ ] **Step 5: Commit**

```bash
git add backend/crud.py backend/ai.py backend/main.py backend/tests/test_grocery_sync.py
git commit -m "feat: trigger automatic grocery sync on meal plan mutations and AI apply"
```

---

### Task 4: Frontend API & Interactive Shopping Checkbox in `ResourcePage`

**Files:**
- Modify: `life-dashboard/frontend/src/api.js`
- Modify: `life-dashboard/frontend/src/components/ResourcePage.jsx`
- Modify: `life-dashboard/frontend/src/App.css`
- Test: `life-dashboard/frontend/src/components/ResourcePage.test.jsx`

**Interfaces:**
- `syncGroceriesFromMealPlan(weekOf)` in `api.js`
- Interactive table checkbox toggling `updateItem` with `.item-checked` CSS strikethrough.

- [ ] **Step 1: Write failing tests for interactive table checkbox**

In `life-dashboard/frontend/src/components/ResourcePage.test.jsx`:
```jsx
it("toggles checkbox directly in the table row", async () => {
  vi.spyOn(api, "listItems").mockResolvedValue([{ id: 1, name: "Milk", quantity: "1 gal", checked: false }]);
  const updateSpy = vi.spyOn(api, "updateItem").mockResolvedValue({ id: 1, name: "Milk", quantity: "1 gal", checked: true });

  render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);
  expect(await screen.findByText("Milk")).toBeInTheDocument();

  const tableCheckbox = screen.getByRole("checkbox", { name: "Toggle Checked for Milk" });
  expect(tableCheckbox).not.toBeChecked();

  await userEvent.click(tableCheckbox);
  expect(updateSpy).toHaveBeenCalledWith("groceries", 1, { name: "Milk", quantity: "1 gal", checked: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` in `life-dashboard/frontend`
Expected: FAIL

- [ ] **Step 3: Update `api.js`, `ResourcePage.jsx`, and `App.css`**

In `frontend/src/api.js`:
```javascript
export function syncGroceriesFromMealPlan(weekOf) {
  const query = weekOf ? `?week_of=${encodeURIComponent(weekOf)}` : "";
  return request(`/api/groceries/sync-meal-plan${query}`, { method: "POST" });
}
```

In `frontend/src/components/ResourcePage.jsx`:
Add table row toggle function:
```javascript
async function handleToggleCheckbox(item, fieldName) {
  const updated = { ...item, [fieldName]: !item[fieldName] };
  try {
    // Optimistic local update
    setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)));
    await updateItem(resourceKey, item.id, toPayload(fields, updated));
  } catch (err) {
    setError(err.message);
    await refresh();
  }
}
```
In table body cell rendering:
```jsx
{field.type === "checkbox" ? (
  <input
    type="checkbox"
    aria-label={`Toggle ${field.label} for ${item.name || item.title || item.id}`}
    checked={!!item[field.name]}
    onChange={() => handleToggleCheckbox(item, field.name)}
  />
) : ...}
```
Add `.item-checked` CSS styling in `App.css`.

- [ ] **Step 4: Run frontend tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api.js src/components/ResourcePage.jsx src/components/ResourcePage.test.jsx src/App.css
git commit -m "feat: add syncGroceriesFromMealPlan API and interactive shopping checkboxes"
```

---

### Task 5: Frontend "Sync from Meal Plan" Action Button in Groceries View

**Files:**
- Modify: `life-dashboard/frontend/src/components/ResourcePage.jsx`
- Test: `life-dashboard/frontend/src/components/ResourcePage.test.jsx`

**Interfaces:**
- If `resourceKey === "groceries"`, render a "Sync from Meal Plan" button in `ResourcePage` header/toolbar that calls `syncGroceriesFromMealPlan` and displays status.

- [ ] **Step 1: Write failing test for Sync from Meal Plan button**

In `life-dashboard/frontend/src/components/ResourcePage.test.jsx`:
```jsx
it("renders Sync from Meal Plan button and triggers sync for groceries", async () => {
  vi.spyOn(api, "listItems").mockResolvedValue([]);
  const syncSpy = vi.spyOn(api, "syncGroceriesFromMealPlan").mockResolvedValue({
    week_of: "2026-09-07",
    added: [{ id: 2, name: "Apples" }],
  });

  render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);
  const syncBtn = await screen.findByRole("button", { name: /sync from meal plan/i });
  expect(syncBtn).toBeInTheDocument();

  await userEvent.click(syncBtn);
  expect(syncSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL (button not found)

- [ ] **Step 3: Implement Sync button in `ResourcePage.jsx`**

In `frontend/src/components/ResourcePage.jsx`:
- Import `syncGroceriesFromMealPlan` from `../api`.
- Add `syncing` state and `syncStatus` message.
- Add handler `handleSyncMealPlan()`.
- Render button conditionally when `resourceKey === "groceries"`.

- [ ] **Step 4: Run frontend and backend tests**

Run in `life-dashboard/frontend`: `npm test`
Run in `life-dashboard/backend`: `.venv/Scripts/pytest -v`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ResourcePage.jsx src/components/ResourcePage.test.jsx
git commit -m "feat: add Sync from Meal Plan action button to Groceries page"
```
