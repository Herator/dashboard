import { useEffect, useMemo, useState } from "react";
import { listItems, deleteItem } from "../lib/api";
import { startOfWeekMonday, addDays, toYMD } from "../lib/dateUtils";
import AiEditBox from "../components/AiEditBox";
import MealRecipeDialog from "../components/meal-plan/MealRecipeDialog";
import MealPreferencesDialog from "../components/meal-plan/MealPreferencesDialog";
import MealFormDialog from "../components/meal-plan/MealFormDialog";

const SLOT_ORDER = ["breakfast", "lunch", "dinner", "snack"];
const SLOT_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

export default function MealPlanPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [selectedMeal, setSelectedMeal] = useState(null); // { meal, dayLabel }
  const [formTarget, setFormTarget] = useState(null); // { date, mealSlot, item? }
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [recipeSteps, setRecipeSteps] = useState({}); // meal id -> steps[], cached for this page visit

  async function refresh() {
    try {
      setItems(await listItems("meal-plan"));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const weekDays = useMemo(() => {
    const start = addDays(startOfWeekMonday(new Date()), weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [weekOffset]);

  const weekLabel = `${weekDays[0].toLocaleDateString([], { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString([], { month: "short", day: "numeric" })}`;

  const byDateAndSlot = useMemo(() => {
    const map = new Map();
    for (const item of items) map.set(`${item.date}_${item.meal_slot}`, item);
    return map;
  }, [items]);

  async function handleDelete(item) {
    try {
      await deleteItem("meal-plan", item.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="meal-plan-page">
      <header className="meal-plan-header">
        <span className="meal-plan-badge" aria-hidden="true">
          🍽️
        </span>
        <div>
          <h1>Meal Plan</h1>
          <p className="meal-plan-subtitle">Plan the week, then let groceries sync themselves.</p>
        </div>
      </header>

      <AiEditBox
        resourceKey="meal-plan"
        primaryField="name"
        dateFrom={toYMD(weekDays[0])}
        dateTo={toYMD(weekDays[6])}
        onApplied={refresh}
      />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="meal-plan-week-nav">
        <div className="meal-plan-week-controls">
          <button type="button" className="meal-plan-week-chevron" aria-label="Previous week" onClick={() => setWeekOffset((o) => o - 1)}>
            ‹
          </button>
          <span className="meal-plan-week-label">{weekLabel}</span>
          <button type="button" className="meal-plan-week-chevron" aria-label="Next week" onClick={() => setWeekOffset((o) => o + 1)}>
            ›
          </button>
        </div>
        <div className="meal-plan-week-actions">
          <span className="meal-plan-synced">✓ Groceries synced</span>
          <button type="button" onClick={() => setPrefsOpen(true)}>
            ♥ Edit likes &amp; dislikes
          </button>
        </div>
      </div>

      <div className="meal-plan-grid">
        {weekDays.map((day, i) => {
          const key = toYMD(day);
          const dayLabel = day.toLocaleDateString([], { weekday: "long" });
          return (
            <div key={key} className="meal-plan-day-card">
              <div className="meal-plan-day-card-header">
                <span>{day.toLocaleDateString([], { weekday: "short" })}</span>
                <span className="meal-plan-day-card-date">{day.toLocaleDateString([], { month: "short", day: "numeric" })}</span>
              </div>
              <div className="meal-plan-day-card-body">
                {SLOT_ORDER.filter((slot) => slot !== "snack" || byDateAndSlot.has(`${key}_snack`)).map((slot) => {
                  const meal = byDateAndSlot.get(`${key}_${slot}`);
                  if (!meal) {
                    return (
                      <button
                        key={slot}
                        type="button"
                        className="meal-slot-empty"
                        onClick={() => setFormTarget({ date: key, mealSlot: slot, dayLabel })}
                      >
                        + Add {SLOT_LABELS[slot]}
                      </button>
                    );
                  }
                  return (
                    <div key={slot} className="meal-slot" onClick={() => setSelectedMeal({ meal, dayLabel })}>
                      <div className="meal-slot-top">
                        <span className="meal-tag">{SLOT_LABELS[slot]}</span>
                        <div className="meal-slot-actions">
                          <button
                            type="button"
                            aria-label="Edit meal"
                            className="meal-slot-icon-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFormTarget({ date: key, mealSlot: slot, item: meal, dayLabel });
                            }}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            aria-label="Delete meal"
                            className="meal-slot-icon-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(meal);
                            }}
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                      <p className="meal-slot-name">{meal.name}</p>
                      {meal.ingredients?.length > 0 && (
                        <div className="meal-slot-ingredients">
                          {meal.ingredients.map((ing) => (
                            <span key={ing}>{ing}</span>
                          ))}
                        </div>
                      )}
                      {meal.amount_used && <p className="meal-slot-used">Used: {meal.amount_used}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {selectedMeal && (
        <MealRecipeDialog
          meal={selectedMeal.meal}
          dayLabel={selectedMeal.dayLabel}
          stepsCache={recipeSteps}
          onStepsLoaded={(id, steps) => setRecipeSteps((prev) => ({ ...prev, [id]: steps }))}
          onClose={() => setSelectedMeal(null)}
        />
      )}

      {formTarget && (
        <MealFormDialog
          target={formTarget}
          dayLabel={formTarget.dayLabel}
          onClose={() => setFormTarget(null)}
          onSaved={async () => {
            setFormTarget(null);
            await refresh();
          }}
        />
      )}

      {prefsOpen && <MealPreferencesDialog onClose={() => setPrefsOpen(false)} />}
    </div>
  );
}
