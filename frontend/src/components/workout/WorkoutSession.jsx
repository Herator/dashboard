import { useEffect, useRef, useState } from "react";
import { updateItem } from "../../lib/api";
import { completedStates, weightStates, actualRepsStates, sessionSteps } from "../../lib/workoutPlans";
import { getWorkoutSettings } from "../../lib/workoutSettings";

function formatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function exerciseStatus(exercise, exerciseIndex, currentStep) {
  if (exerciseIndex === currentStep.exerciseIndex) return "active";
  if (completedStates(exercise).every(Boolean)) return "completed";
  return "upcoming";
}

export default function WorkoutSession({ workout, onExit, onFinish }) {
  const [exercises, setExercises] = useState(() => workout.exercises.map((ex) => ({ ...ex })));
  const [steps] = useState(() => sessionSteps(workout.exercises));
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState("exercise"); // "exercise" | "rest"
  const [restRemaining, setRestRemaining] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [reps, setReps] = useState("");
  const [weight, setWeight] = useState("");
  const [error, setError] = useState(null);
  const settings = useRef(getWorkoutSettings()).current;

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (phase !== "rest") return;
    if (restRemaining <= 0) {
      setPhase("exercise");
      return;
    }
    const id = setInterval(() => setRestRemaining((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [phase, restRemaining]);

  const currentStep = steps[stepIndex];
  const currentExercise = exercises[currentStep.exerciseIndex];
  const isLastStep = stepIndex === steps.length - 1;

  async function persist(updatedExercises, extra = {}) {
    setError(null);
    try {
      await updateItem("workouts", workout.id, { exercises: updatedExercises, ...extra });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCompleteSet() {
    const { exerciseIndex, setIndex } = currentStep;
    const updated = exercises.map((exercise, i) => {
      if (i !== exerciseIndex) return exercise;
      const completed = completedStates(exercise);
      const weights = weightStates(exercise);
      const actualReps = actualRepsStates(exercise);
      completed[setIndex] = true;
      weights[setIndex] = weight === "" ? null : Number(weight);
      actualReps[setIndex] = reps === "" ? null : reps;
      return { ...exercise, completed, weight: weights, actual_reps: actualReps };
    });
    setExercises(updated);
    setReps("");
    setWeight("");

    if (isLastStep) {
      await persist(updated, { duration_min: Math.max(1, Math.round(elapsed / 60)) });
      onFinish();
      return;
    }

    await persist(updated);
    setStepIndex((i) => i + 1);
    if (settings.autoRest) {
      setRestRemaining(settings.restSeconds);
      setPhase("rest");
    }
  }

  function handleSkipRest() {
    setPhase("exercise");
  }

  function jumpToExercise(exerciseIndex) {
    const exercise = exercises[exerciseIndex];
    const completed = completedStates(exercise);
    let setIndex = completed.findIndex((done) => !done);
    if (setIndex === -1) setIndex = 0;
    const newStepIndex = steps.findIndex((s) => s.exerciseIndex === exerciseIndex && s.setIndex === setIndex);
    if (newStepIndex === -1) return;
    setPhase("exercise");
    setRestRemaining(0);
    setReps("");
    setWeight("");
    setStepIndex(newStepIndex);
  }

  const completed = completedStates(currentExercise);
  const weights = weightStates(currentExercise);
  const actualReps = actualRepsStates(currentExercise);
  const setRows = Array.from({ length: currentExercise.sets }, (_, i) => {
    const isCurrentRow = i === currentStep.setIndex;
    const editable = isCurrentRow && phase === "exercise";
    const done = completed[i];
    return {
      num: i + 1,
      editable,
      done,
      weightDisplay: done && weights[i] != null ? weights[i] : "—",
      repsDisplay: done ? actualReps[i] || currentExercise.reps : "—",
      targetReps: currentExercise.reps,
    };
  });

  return (
    <div className="workout-session">
      <div className="workout-session-topbar">
        <button type="button" className="workout-session-exit" onClick={onExit}>
          ← Exit
        </button>
        <div className="workout-session-topbar-right">
          <span className="workout-session-timer">{formatClock(elapsed)}</span>
          {phase === "rest" && (
            <span className="workout-tag workout-tag--rest">Rest {formatClock(restRemaining)}</span>
          )}
        </div>
      </div>

      <div className="workout-session-strip">
        {exercises.map((exercise, i) => (
          <button
            type="button"
            key={i}
            className={`workout-tile workout-tile--${exerciseStatus(exercise, i, currentStep)}`}
            onClick={() => jumpToExercise(i)}
          >
            {exercise.name.charAt(0).toUpperCase()}
          </button>
        ))}
      </div>

      <h2 className="workout-session-name">{currentExercise.name}</h2>
      <p className="workout-session-set-label">
        Set {currentStep.setIndex + 1} of {currentExercise.sets} · target {currentExercise.reps} reps
      </p>

      {currentExercise.cue && <p className="workout-session-cue">{currentExercise.cue}</p>}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {phase === "rest" && (
        <div className="workout-session-rest-banner">
          <span>
            Resting · up next {currentExercise.name} · set {currentStep.setIndex + 1} of {currentExercise.sets}
          </span>
          <button type="button" className="workout-skip-rest" onClick={handleSkipRest}>
            Skip
          </button>
        </div>
      )}

      <div className="workout-set-table">
        <div className="workout-set-table-header">
          <span>Set</span>
          <span>{settings.units}</span>
          <span>Reps</span>
          <span></span>
        </div>
        {setRows.map((row) => (
          <div key={row.num} className="workout-set-row">
            <span className="workout-set-num">{row.num}</span>
            {row.editable ? (
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            ) : (
              <span className={`workout-set-static${row.done ? "" : " workout-set-static--pending"}`}>
                {row.weightDisplay}
              </span>
            )}
            {row.editable ? (
              <input
                type="number"
                inputMode="numeric"
                placeholder={row.targetReps}
                value={reps}
                onChange={(e) => setReps(e.target.value)}
              />
            ) : (
              <span className={`workout-set-static${row.done ? "" : " workout-set-static--pending"}`}>
                {row.repsDisplay}
              </span>
            )}
            <button
              type="button"
              className={`workout-set-toggle${row.done ? " workout-set-toggle--done" : ""}`}
              disabled={!row.editable || row.done}
              aria-label="Mark set done"
              onClick={handleCompleteSet}
            >
              {row.done && "✓"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
