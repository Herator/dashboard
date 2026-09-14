import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listItems } from "../api";
import { startOfWeekMonday, addDays, toYMD } from "../dateUtils";

const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"];
const SLOT_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

export default function MealPlanWidget() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    listItems("meal-plan")
      .then(setItems)
      .catch((err) => setError(err.message));
  }, []);

  const weekDays = useMemo(() => {
    const start = startOfWeekMonday(new Date());
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, []);

  const byDateAndSlot = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      map.set(`${item.date}_${item.meal_slot}`, item);
    }
    return map;
  }, [items]);

  const todayKey = toYMD(new Date());

  return (
    <section className="widget meal-plan-widget">
      <div className="widget-header">
        <Link to="/meal-plan" aria-label="Manage meal plan">
          <h2>Meal Plan</h2>
        </Link>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="meal-plan-grid">
        <div className="meal-plan-corner" />
        {weekDays.map((day) => {
          const key = toYMD(day);
          return (
            <div key={key} className={`meal-plan-day-header${key === todayKey ? " meal-plan-day-header--today" : ""}`}>
              <span>{day.toLocaleDateString([], { weekday: "short" })}</span>
              <span className="meal-plan-day-number">{day.getDate()}</span>
            </div>
          );
        })}
        {MEAL_SLOTS.map((slot) => (
          <Fragment key={slot}>
            <div className="meal-plan-slot-label">{SLOT_LABELS[slot]}</div>
            {weekDays.map((day) => {
              const key = toYMD(day);
              const item = byDateAndSlot.get(`${key}_${slot}`);
              return (
                <div key={`${slot}-${key}`} className="meal-plan-cell">
                  {item ? item.name : <span className="meal-plan-empty">—</span>}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </section>
  );
}
