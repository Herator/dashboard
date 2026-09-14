import { useEffect, useState } from "react";
import { listItems, createItem, updateItem, deleteItem } from "../api";
import AiEditBox from "./AiEditBox";

function setStates(exercise) {
  return Array.from({ length: exercise.sets }, (_, i) => exercise.completed?.[i] ?? false);
}

function emptyAddForm() {
  return { date: "", plan_text: "", notes: "" };
}

export default function WorkoutLog() {
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addForm, setAddForm] = useState(emptyAddForm());
  const [editing, setEditing] = useState(null); // the workout being edited, or null

  function refresh() {
    setLoading(true);
    return listItems("workouts")
      .then((data) => setWorkouts([...data].sort((a, b) => a.date.localeCompare(b.date))))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function toggleSet(workout, exerciseIndex, setIndex) {
    const updatedExercises = workout.exercises.map((exercise, i) => {
      if (i !== exerciseIndex) return exercise;
      const completed = setStates(exercise);
      completed[setIndex] = !completed[setIndex];
      return { ...exercise, completed };
    });
    const originalExercises = workout.exercises;
    setWorkouts((prev) =>
      prev.map((w) => (w.id === workout.id ? { ...w, exercises: updatedExercises } : w))
    );
    try {
      await updateItem("workouts", workout.id, { exercises: updatedExercises });
    } catch (err) {
      setError(err.message);
      // Revert in place rather than a full refresh(): refresh() flips
      // `loading`, which unmounts the whole card list and flashes
      // "Loading…" just to undo one checkbox.
      setWorkouts((prev) =>
        prev.map((w) => (w.id === workout.id ? { ...w, exercises: originalExercises } : w))
      );
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError(null);
    try {
      await createItem("workouts", { date: addForm.date, plan_text: addForm.plan_text, notes: addForm.notes || null });
      setAddForm(emptyAddForm());
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  function openEdit(workout) {
    setEditing({ id: workout.id, date: workout.date, plan_text: workout.plan_text, notes: workout.notes || "" });
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    setError(null);
    try {
      await updateItem("workouts", editing.id, {
        date: editing.date,
        plan_text: editing.plan_text,
        notes: editing.notes || null,
      });
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    setError(null);
    try {
      await deleteItem("workouts", id);
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="workout-log">
      <AiEditBox resourceKey="workouts" primaryField="plan_text" onApplied={refresh} />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={handleAdd} className="resource-form workout-log-add-form">
        <label>
          Date
          <input
            type="date"
            required
            value={addForm.date}
            onChange={(e) => setAddForm((prev) => ({ ...prev, date: e.target.value }))}
          />
        </label>
        <label>
          Plan
          <input
            required
            placeholder="e.g. Push Day"
            value={addForm.plan_text}
            onChange={(e) => setAddForm((prev) => ({ ...prev, plan_text: e.target.value }))}
          />
        </label>
        <label>
          Notes
          <textarea
            value={addForm.notes}
            onChange={(e) => setAddForm((prev) => ({ ...prev, notes: e.target.value }))}
          />
        </label>
        <button type="submit">Add</button>
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : workouts.length === 0 ? (
        <p className="widget-empty">No workouts logged yet.</p>
      ) : (
        <div className="workout-cards">
          {workouts.map((workout) => {
            const exercises = workout.exercises || [];
            const totalSets = exercises.reduce((sum, ex) => sum + ex.sets, 0);
            const doneSets = exercises.reduce(
              (sum, ex) => sum + setStates(ex).filter(Boolean).length,
              0
            );
            return (
              <div key={workout.id} className="workout-card">
                <div className="workout-card-header">
                  <div>
                    <span className="workout-card-date">
                      {new Date(`${workout.date}T00:00:00`).toLocaleDateString([], {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <h3 className="workout-card-title">{workout.plan_text}</h3>
                  </div>
                  <div className="workout-card-actions">
                    {totalSets > 0 && (
                      <span className="workout-card-progress">
                        {doneSets}/{totalSets} sets
                      </span>
                    )}
                    <button type="button" onClick={() => openEdit(workout)}>
                      Edit
                    </button>
                  </div>
                </div>

                {exercises.length > 0 ? (
                  <ol className="exercise-list">
                    {exercises.map((exercise, exerciseIndex) => (
                      <li key={exerciseIndex} className="exercise-item">
                        <div className="exercise-info">
                          <span className="exercise-name">{exercise.name}</span>
                          <span className="exercise-reps">{exercise.reps} reps</span>
                        </div>
                        <div className="exercise-sets">
                          {setStates(exercise).map((done, setIndex) => (
                            <label
                              key={setIndex}
                              className={`set-checkbox${done ? " set-checkbox--done" : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={done}
                                onChange={() => toggleSet(workout, exerciseIndex, setIndex)}
                                aria-label={`${exercise.name} set ${setIndex + 1}`}
                              />
                              <span aria-hidden="true">{setIndex + 1}</span>
                            </label>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  workout.notes && <p className="workout-card-notes">{workout.notes}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit workout</h3>
              <button type="button" className="modal-close" aria-label="Close" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="calendar-event-form">
              <label>
                Date
                <input
                  type="date"
                  required
                  value={editing.date}
                  onChange={(e) => setEditing((prev) => ({ ...prev, date: e.target.value }))}
                />
              </label>
              <label>
                Plan
                <input
                  required
                  value={editing.plan_text}
                  onChange={(e) => setEditing((prev) => ({ ...prev, plan_text: e.target.value }))}
                />
              </label>
              <label>
                Notes
                <textarea
                  value={editing.notes}
                  onChange={(e) => setEditing((prev) => ({ ...prev, notes: e.target.value }))}
                />
              </label>
              <div className="calendar-event-form-actions">
                <button type="submit">Save</button>
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button type="button" className="calendar-event-delete" onClick={() => handleDelete(editing.id)}>
                  Delete
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
