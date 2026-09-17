import { useState } from "react";
import { previewAiEdit, applyAiEdit } from "../../lib/api";
import { toYMD } from "../../lib/dateUtils";

const GOALS = ["Strength", "Hypertrophy", "Endurance", "Cardio"];
const MUSCLES = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core", "Full body"];
const DURATIONS = [15, 30, 45, 60, 90, 120];
const EQUIPMENT = ["Bodyweight", "Dumbbells", "Cable", "Machine", "Full gym"];
const LEVELS = ["Beginner", "Intermediate", "Advanced"];

function toggleInSet(set, value) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function emptyFilters() {
  return { goal: null, muscles: new Set(), duration: null, equipment: new Set(), level: null };
}

function buildMessage(prompt, filters) {
  const parts = [];
  if (filters.goal) parts.push(`goal: ${filters.goal}`);
  if (filters.muscles.size) parts.push(`target muscles: ${[...filters.muscles].join(", ")}`);
  if (filters.duration) parts.push(`duration: ${filters.duration} min`);
  if (filters.equipment.size) parts.push(`equipment: ${[...filters.equipment].join(", ")}`);
  if (filters.level) parts.push(`level: ${filters.level}`);
  const filterLine = parts.length ? ` Filters — ${parts.join("; ")}.` : "";
  const today = toYMD(new Date());
  return (
    `${prompt.trim() || "Generate a workout"}.${filterLine} ` +
    `Schedule it for today (${today}) unless the request clearly implies another date. Mark it generated.`
  );
}

export default function WorkoutGenerateCard({ onGenerated }) {
  const [prompt, setPrompt] = useState("");
  const [filters, setFilters] = useState(emptyFilters());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleGenerate(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await previewAiEdit("workouts", { message: buildMessage(prompt, filters) });
      setPreview(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    setError(null);
    setLoading(true);
    try {
      await applyAiEdit("workouts", { items: preview.items });
      setPreview(null);
      setPrompt("");
      setFilters(emptyFilters());
      setAdvancedOpen(false);
      await onGenerated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const hasNoChanges = preview && preview.created.length === 0 && preview.updated.length === 0;

  return (
    <div className="workout-generate-card">
      <h2>Generate a workout</h2>
      <form onSubmit={handleGenerate} className="workout-generate-form">
        <textarea
          placeholder="e.g. A quick upper body session"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={loading || !!preview}
        />
        <button
          type="button"
          className="workout-advanced-toggle"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          Advanced filters {advancedOpen ? "▲" : "▼"}
        </button>
        {advancedOpen && (
          <div className="workout-filters">
            <ChipRow
              label="Goal"
              options={GOALS}
              selected={filters.goal ? [filters.goal] : []}
              onToggle={(v) => setFilters((f) => ({ ...f, goal: f.goal === v ? null : v }))}
            />
            <ChipRow
              label="Target muscles"
              options={MUSCLES}
              selected={[...filters.muscles]}
              onToggle={(v) => setFilters((f) => ({ ...f, muscles: toggleInSet(f.muscles, v) }))}
            />
            <ChipRow
              label="Duration"
              options={DURATIONS.map(String)}
              renderLabel={(v) => `${v} min`}
              selected={filters.duration ? [String(filters.duration)] : []}
              onToggle={(v) =>
                setFilters((f) => ({ ...f, duration: f.duration === Number(v) ? null : Number(v) }))
              }
            />
            <ChipRow
              label="Equipment"
              options={EQUIPMENT}
              selected={[...filters.equipment]}
              onToggle={(v) => setFilters((f) => ({ ...f, equipment: toggleInSet(f.equipment, v) }))}
            />
            <ChipRow
              label="Level"
              options={LEVELS}
              selected={filters.level ? [filters.level] : []}
              onToggle={(v) => setFilters((f) => ({ ...f, level: f.level === v ? null : v }))}
            />
          </div>
        )}
        <button type="submit" className="workout-generate-submit" disabled={loading || !!preview}>
          {loading && !preview ? (
            <>
              <span className="workout-spinner" aria-hidden="true" /> Generating…
            </>
          ) : (
            "Generate workout"
          )}
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {preview && (
        <div className="ai-edit-preview">
          <h3>AI Preview</h3>
          {hasNoChanges && <p>No changes.</p>}
          {preview.created.map((item, i) => (
            <p key={item.id ?? `created-${i}`}>➕ {item.plan_text}</p>
          ))}
          {preview.updated.map((u, i) => (
            <p key={u.after.id ?? `updated-${i}`}>✏️ {u.after.plan_text}</p>
          ))}
          <div className="ai-edit-actions">
            <button type="button" onClick={() => setPreview(null)} disabled={loading}>
              Cancel
            </button>
            <button type="button" onClick={handleApply} disabled={loading}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChipRow({ label, options, selected, onToggle, renderLabel = (v) => v }) {
  return (
    <div className="workout-chip-row">
      <span className="workout-chip-label">{label}</span>
      <div className="workout-chips">
        {options.map((opt) => (
          <button
            type="button"
            key={opt}
            className={`workout-chip${selected.includes(opt) ? " workout-chip--selected" : ""}`}
            onClick={() => onToggle(opt)}
          >
            {renderLabel(opt)}
          </button>
        ))}
      </div>
    </div>
  );
}
