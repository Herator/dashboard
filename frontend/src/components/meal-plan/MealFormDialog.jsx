import { useState } from "react";
import { createItem, updateItem } from "../../lib/api";

const SLOT_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

// `target` is either { date, mealSlot } (creating a new meal in that slot) or
// { date, mealSlot, item } (editing an existing one).
export default function MealFormDialog({ target, dayLabel, onClose, onSaved }) {
  const editing = target.item;
  const [name, setName] = useState(editing?.name || "");
  const [ingredients, setIngredients] = useState(editing?.ingredients?.join(", ") || "");
  const [amountUsed, setAmountUsed] = useState(editing?.amount_used || "");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      date: target.date,
      meal_slot: target.mealSlot,
      name,
      ingredients: ingredients
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      amount_used: amountUsed.trim() || null,
    };
    try {
      if (editing) {
        await updateItem("meal-plan", editing.id, payload);
      } else {
        await createItem("meal-plan", payload);
      }
      await onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal meal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {editing ? "Edit" : "Add"} {SLOT_LABELS[target.mealSlot]} · {dayLabel}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="modal-close">
            ×
          </button>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="meal-form">
          <label>
            Name
            <input value={name} required onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Ingredients (comma-separated)
            <input value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
          </label>
          <label>
            Amount used
            <input
              value={amountUsed}
              placeholder="e.g. 300g chicken, 1 onion"
              onChange={(e) => setAmountUsed(e.target.value)}
            />
          </label>
          <div className="meal-dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="meal-btn-primary" disabled={saving}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
