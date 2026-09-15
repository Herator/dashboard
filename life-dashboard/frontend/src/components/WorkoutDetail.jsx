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
    <div className="modal-overlay" onClick={onBack}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="workout-detail-back" onClick={onBack}>
          ← Home
        </button>
        <h2 className="workout-detail-title">{workout.plan_text}</h2>
        {meta && <p className="workout-detail-meta">{meta}</p>}
        {exercises.length > 0 ? (
          <>
            <ol className="exercise-list">
              {exercises.map((exercise, i) => (
                <li key={i} className="exercise-item exercise-item--detail">
                  <div className="exercise-info">
                    <span className="exercise-name">{exercise.name}</span>
                    <span className="exercise-reps">
                      {exercise.sets} sets × {exercise.reps} reps
                    </span>
                    {exercise.cue && <span className="exercise-cue">{exercise.cue}</span>}
                  </div>
                </li>
              ))}
            </ol>
            <button type="button" className="workout-start-button" onClick={() => onStart(workout)}>
              Start workout
            </button>
          </>
        ) : (
          workout.notes && <p className="workout-card-notes">{workout.notes}</p>
        )}
      </div>
    </div>
  );
}
