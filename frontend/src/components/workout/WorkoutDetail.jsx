import { completedStates } from "../../lib/workoutPlans";

export default function WorkoutDetail({ workout, onBack, onStart }) {
  const exercises = workout.exercises || [];
  const tags = [workout.duration_min ? `${workout.duration_min} min` : null, workout.level, workout.goal].filter(
    Boolean
  );

  return (
    <div className="workout-detail">
      <button type="button" className="workout-detail-back" onClick={onBack}>
        ← Home
      </button>
      <h1 className="workout-detail-title">{workout.plan_text}</h1>
      {tags.length > 0 && (
        <div className="workout-detail-tags">
          {tags.map((tag) => (
            <span key={tag} className="workout-tag workout-tag--neutral">
              {tag}
            </span>
          ))}
        </div>
      )}
      {exercises.length > 0 ? (
        <ol className="exercise-list exercise-list--detail">
          {exercises.map((exercise, i) => {
            const states = completedStates(exercise);
            const allDone = states.length > 0 && states.every(Boolean);
            return (
              <li key={i} className="exercise-item exercise-item--detail">
                <div className="exercise-item-row">
                  <span className="exercise-item-name">
                    <span
                      className={`exercise-status-dot${allDone ? " exercise-status-dot--done" : ""}`}
                      aria-hidden="true"
                    >
                      {allDone && "✓"}
                    </span>
                    <span className="exercise-name">{exercise.name}</span>
                  </span>
                  <span className="exercise-reps">
                    {exercise.sets} sets × {exercise.reps} reps
                  </span>
                </div>
                {exercise.cue && <p className="exercise-cue">{exercise.cue}</p>}
              </li>
            );
          })}
        </ol>
      ) : (
        workout.notes && <p className="workout-card-notes">{workout.notes}</p>
      )}
      {exercises.length > 0 && (
        <button type="button" className="workout-start-button" onClick={() => onStart(workout)}>
          ▶ Start workout
        </button>
      )}
    </div>
  );
}
