export default function WorkoutDetail({ workout, onBack, onStart }) {
  const exercises = workout.exercises || [];
  const meta = [
    workout.duration_min ? `${workout.duration_min} min` : null,
    workout.level,
    exercises.length ? `${exercises.length} exercises` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="workout-detail">
      <div className="workout-detail-main">
        <button type="button" className="workout-detail-back" onClick={onBack}>
          ← Home
        </button>
        <h1 className="workout-detail-title">{workout.plan_text}</h1>
        {exercises.length > 0 ? (
          <ol className="exercise-list exercise-list--detail">
            {exercises.map((exercise, i) => (
              <li key={i} className="exercise-item exercise-item--detail">
                <div className="exercise-item-row">
                  <span className="exercise-name">{exercise.name}</span>
                  <span className="exercise-reps">
                    {exercise.sets} sets × {exercise.reps} reps
                  </span>
                </div>
                {exercise.cue && <p className="exercise-cue">{exercise.cue}</p>}
              </li>
            ))}
          </ol>
        ) : (
          workout.notes && <p className="workout-card-notes">{workout.notes}</p>
        )}
      </div>

      <div className="workout-detail-side">
        {meta && <p className="workout-detail-meta">{meta}</p>}
        {exercises.length > 0 && (
          <button type="button" className="workout-start-button" onClick={() => onStart(workout)}>
            Start workout
          </button>
        )}
      </div>
    </div>
  );
}
