# Meal Plan → Grocery Auto-Sync Design Specification

## Overview

Automatically populates and synchronizes the weekly grocery list (`grocery_items`) from ingredient lists specified in the active meal plan (`meal_plan`), while supporting manual grocery items and in-store shopping interactions.

## 1. Domain Logic & Data Model

- **Week Calculation**: Monday-based week start: `week_of = date - timedelta(days=date.weekday())`.
- **Additive Sync Behavior**:
  - For a given `week_start` (Monday), the week's meal dates span `[week_start, week_start + timedelta(days=6)]`.
  - All `MealPlanItem` entries within this span have their `ingredients` extracted, stripped, and deduplicated (case-insensitively).
  - Existing `GroceryItem` entries for `week_of == week_start` are checked.
  - Ingredients not already on the grocery list for that `week_of` (case-insensitive name match) are created as new `GroceryItem(name=ingredient, week_of=week_start, checked=False, quantity=None)`.
  - Manually added grocery items and already-checked items are preserved and never deleted or reset by the sync.

## 2. Backend Architecture

### 2.1 Sync Helper (`backend/grocery_sync.py`)
- `get_week_start(d: date) -> date`: Returns Monday of the week for date `d`.
- `sync_meal_plan_to_groceries(session: Session, week_start: date) -> List[GroceryItem]`: Core reconciliation and additive insert function.

### 2.2 Endpoints & Automatic Triggers
- **Manual Sync Endpoint**:
  - `POST /api/groceries/sync-meal-plan?week_of=YYYY-MM-DD`
  - Returns `{"added": [GroceryItem], "week_of": "YYYY-MM-DD"}`.
- **Automated Triggers**:
  - Hooked into `MealPlanItem` CRUD mutations (`POST`, `PUT`, `DELETE` on `/api/meal-plan/`) and AI apply (`POST /api/meal-plan/ai-edit/apply`) so changes automatically trigger sync for affected `week_of` dates.

## 3. Frontend Architecture

### 3.1 API Client (`frontend/src/api.js`)
- `syncGroceriesFromMealPlan(weekOf: string)`: Calls `POST /api/groceries/sync-meal-plan?week_of=${weekOf}`.

### 3.2 UI Enhancements (`frontend/src/components/ResourcePage.jsx`, `frontend/src/App.css`)
- **Interactive Checkbox**:
  - Table rows render live checkboxes for `boolean` / `checkbox` fields.
  - Toggling updates the item directly via `updateItem` with optimistic UI and line-through styling on checked grocery items.
- **Sync Button on Groceries View**:
  - A "Sync from Meal Plan" action button on the Groceries page allowing on-demand synchronization for the active week with notification of how many new items were added.

## 4. Testing Strategy

- **Backend Unit & Integration Tests (`backend/tests/test_grocery_sync.py`)**:
  - Week calculation logic across edge dates (Sundays, Mondays, leap years).
  - Additive sync with no duplicate creation for existing items.
  - Case-insensitive deduplication and normalization.
  - Preservation of manual grocery items and existing checked items.
  - Endpoint tests for `POST /api/groceries/sync-meal-plan`.
  - Automatic sync verification on meal plan create/update/delete/apply.
- **Frontend Component Tests (`frontend/src/components/ResourcePage.test.jsx`)**:
  - Renders live checkbox in table for boolean fields.
  - Toggling checkbox calls `updateItem` with updated boolean value.
  - Renders "Sync from Meal Plan" button when on Groceries page and triggers sync API call.
