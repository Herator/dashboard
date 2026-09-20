import { useEffect, useState } from "react";
import { getMealRecipeSteps } from "../../lib/api";

const SLOT_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

// Steps aren't stored on the meal — fetched fresh per open, cached per meal id
// for the rest of this page session so reopening the same meal is instant.
export default function MealRecipeDialog({ meal, dayLabel, stepsCache, onStepsLoaded, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const cachedSteps = stepsCache[meal.id];

  useEffect(() => {
    if (cachedSteps) return;
    setLoading(true);
    setError(null);
    getMealRecipeSteps(meal.id)
      .then((data) => onStepsLoaded(meal.id, data.steps))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meal.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal meal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="meal-tag meal-tag--accent">
              {SLOT_LABELS[meal.meal_slot]} · {dayLabel}
            </span>
            <h3 className="meal-dialog-title">{meal.name}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="modal-close">
            ×
          </button>
        </div>

        {meal.ingredients?.length > 0 && (
          <div className="meal-dialog-section">
            <h4>What you need</h4>
            <div className="meal-tag-list">
              {meal.ingredients.map((ing) => (
                <span key={ing} className="meal-tag meal-tag--accent-2">
                  {ing}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="meal-dialog-section">
          <h4>How to make it</h4>
          {loading && <p className="widget-empty">Asking the AI for steps…</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {cachedSteps && (
            <ol className="meal-recipe-steps">
              {cachedSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}
        </div>

        <div className="meal-dialog-actions">
          <button type="button" className="meal-btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
