import { useEffect, useState } from "react";
import { listItems, createItem, updateItem, deleteItem } from "../api";
import { PLAN_OPTIONS, planIcon, formatTime } from "../workoutPlans";
import { nextDateForWeekday, toYMD } from "../dateUtils";
import AiEditBox from "./AiEditBox";

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

const RECOMMENDED_SCHEDULE = [
  { day_of_week: "mon", time: "07:00:00", label: "Push Day" },
  { day_of_week: "wed", time: "07:00:00", label: "Pull Day" },
  { day_of_week: "fri", time: "07:00:00", label: "Leg Day" },
];

function emptyForm() {
  return { id: null, planPreset: PLAN_OPTIONS[0], planCustom: "", time: "07:00", notes: "" };
}

export default function WorkoutScheduleEditor({ onWorkoutGenerated }) {
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [applying, setApplying] = useState(false);
  const [editingDay, setEditingDay] = useState(null);
  const [form, setForm] = useState(null);

  function refresh() {
    setLoading(true);
    return listItems("workout-schedule")
      .then(setSchedule)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  const byDay = new Map(schedule.map((entry) => [entry.day_of_week, entry]));

  function openEditor(dayKey) {
    const existing = byDay.get(dayKey);
    setEditingDay(dayKey);
    setError(null);
    if (existing) {
      const isPreset = PLAN_OPTIONS.includes(existing.label);
      setForm({
        id: existing.id,
        planPreset: isPreset ? existing.label : "Other",
        planCustom: isPreset ? "" : existing.label,
        time: formatTime(existing.time),
        notes: existing.notes || "",
      });
    } else {
      setForm(emptyForm());
    }
  }

  function closeEditor() {
    setEditingDay(null);
    setForm(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const label = form.planPreset === "Other" ? form.planCustom.trim() || "Workout" : form.planPreset;
    const payload = { day_of_week: editingDay, time: `${form.time}:00`, label, notes: form.notes || null };
    try {
      if (form.id) {
        await updateItem("workout-schedule", form.id, payload);
      } else {
        await createItem("workout-schedule", payload);
      }
      closeEditor();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await deleteItem("workout-schedule", form.id);
      closeEditor();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function applyRecommended() {
    setApplying(true);
    setError(null);
    try {
      await Promise.all(RECOMMENDED_SCHEDULE.map((entry) => createItem("workout-schedule", entry)));
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  const editingDayLabel = DAYS.find((d) => d.key === editingDay)?.label;
  const effectivePlan = form
    ? form.planPreset === "Other"
      ? form.planCustom.trim() || "Workout"
      : form.planPreset
    : "";
  const targetDate = editingDay ? nextDateForWeekday(editingDay) : null;
  const targetDateKey = targetDate ? toYMD(targetDate) : null;
  const targetDateLabel = targetDate
    ? targetDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })
    : "";

  return (
    <div className="workout-schedule">
      <div className="widget-header">
        <h2>Weekly Training Schedule</h2>
        {schedule.length === 0 && !loading && (
          <button type="button" onClick={applyRecommended} disabled={applying}>
            {applying ? "Applying…" : "Use recommended (Push/Pull/Legs)"}
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && (
        <div className="workout-week-grid">
          {DAYS.map((day) => {
            const entry = byDay.get(day.key);
            return (
              <button
                type="button"
                key={day.key}
                className={`workout-day-card${entry ? " workout-day-card--filled" : ""}`}
                onClick={() => openEditor(day.key)}
              >
                <span className="workout-day-label">{day.label}</span>
                {entry ? (
                  <>
                    <span className="workout-day-icon" aria-hidden="true">
                      {planIcon(entry.label)}
                    </span>
                    <span className="workout-day-plan">{entry.label}</span>
                    <span className="workout-day-time">{formatTime(entry.time)}</span>
                  </>
                ) : (
                  <span className="workout-day-empty">+ Add</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {editingDay && form && (
        <div className="modal-overlay" onClick={closeEditor}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingDayLabel} training</h3>
              <button type="button" className="modal-close" aria-label="Close" onClick={closeEditor}>
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="calendar-event-form">
              <label>
                Workout Plan
                <select
                  value={form.planPreset}
                  onChange={(e) => setForm((prev) => ({ ...prev, planPreset: e.target.value }))}
                >
                  {PLAN_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  <option value="Other">Other…</option>
                </select>
              </label>
              {form.planPreset === "Other" && (
                <label>
                  Custom plan name
                  <input
                    value={form.planCustom}
                    placeholder="e.g. Upper Body Blast"
                    onChange={(e) => setForm((prev) => ({ ...prev, planCustom: e.target.value }))}
                  />
                </label>
              )}
              <label>
                Time
                <input
                  type="time"
                  value={form.time}
                  required
                  onChange={(e) => setForm((prev) => ({ ...prev, time: e.target.value }))}
                />
              </label>
              <label>
                Notes
                <textarea value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
              </label>
              <div className="calendar-event-form-actions">
                <button type="submit">{form.id ? "Save" : "Add"}</button>
                <button type="button" onClick={closeEditor}>
                  Cancel
                </button>
                {form.id && (
                  <button type="button" className="calendar-event-delete" onClick={handleDelete}>
                    Delete
                  </button>
                )}
              </div>
            </form>

            {effectivePlan !== "Rest Day" && (
              <div className="workout-generate">
                <h4>Generate this workout</h4>
                <AiEditBox
                  key={editingDay}
                  resourceKey="workouts"
                  primaryField="plan_text"
                  dateFrom={targetDateKey}
                  dateTo={targetDateKey}
                  initialMessage={`Give me a ${effectivePlan} workout for ${targetDateLabel}`}
                  onApplied={async () => {
                    if (onWorkoutGenerated) await onWorkoutGenerated();
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
