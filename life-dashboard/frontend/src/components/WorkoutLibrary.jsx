import { useEffect, useState } from "react";
import { listItems } from "../api";

export default function WorkoutLibrary({ onSelect }) {
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    listItems("workouts")
      .then((data) => setWorkouts([...data].sort((a, b) => b.date.localeCompare(a.date))))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading…</p>;
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (workouts.length === 0) return <p className="widget-empty">No workouts yet — generate one above.</p>;

  return (
    <div className="workout-library">
      {workouts.map((workout) => {
        const exerciseCount = workout.exercises?.length || 0;
        const meta = [
          workout.duration_min ? `${workout.duration_min} min` : null,
          workout.level,
          exerciseCount ? `${exerciseCount} exercises` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <button
            type="button"
            key={workout.id}
            className="workout-library-card"
            onClick={() => onSelect(workout)}
          >
            <div className="workout-library-card-top">
              <span className="workout-library-name">{workout.plan_text}</span>
              {workout.generated && <span className="workout-badge-ai">AI</span>}
            </div>
            {workout.muscles?.[0] && <span className="workout-tag">{workout.muscles[0]}</span>}
            {meta && <span className="workout-library-meta">{meta}</span>}
          </button>
        );
      })}
    </div>
  );
}
