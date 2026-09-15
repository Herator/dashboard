import { useEffect, useRef, useState } from "react";
import { updateItem } from "../api";
import { completedStates, weightStates, actualRepsStates, sessionSteps } from "../workoutPlans";
import { getWorkoutSettings } from "../workoutSettings";

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

  const nextStep = phase === "rest" ? steps[stepIndex] : null;
  const nextExercise = nextStep ? exercises[nextStep.exerciseIndex] : null;

  return (
    <div className="workout-session">
      <div className="workout-session-side">
        <button type="button" className="workout-session-exit" onClick={onExit}>
          Exit
        </button>
        <div className="workout-session-strip">
          {exercises.map((exercise, i) => (
            <span
              key={i}
              className={`workout-pill workout-pill--${exerciseStatus(exercise, i, currentStep)}`}
            >
              {exercise.name}
            </span>
          ))}
        </div>
      </div>

      <div className="workout-session-main">
        <div className="workout-session-header">
          <h2 className="workout-session-name">{workout.plan_text}</h2>
          <div className="workout-session-meta">
            <span className="workout-session-step">
              Step {stepIndex + 1} of {steps.length}
            </span>
            <span className="workout-session-timer">{formatClock(elapsed)}</span>
          </div>
        </div>

        <div className="workout-session-progress">
          <div
            className="workout-session-progress-fill"
            style={{ width: `${(stepIndex / steps.length) * 100}%` }}
          />
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {phase === "exercise" ? (
          <div className="workout-session-exercise">
            {currentExercise.muscle && <span className="workout-tag">{currentExercise.muscle}</span>}
            <h2>{currentExercise.name}</h2>
            {currentExercise.cue && <p className="workout-session-cue">{currentExercise.cue}</p>}
            <p className="workout-session-set-label">
              Set {currentStep.setIndex + 1} of {currentExercise.sets} · target {currentExercise.reps} reps
            </p>
            <div className="workout-session-inputs">
              <label>
                Reps
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder={currentExercise.reps}
                  value={reps}
                  onChange={(e) => setReps(e.target.value)}
                />
              </label>
              <label>
                Weight ({settings.units})
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                />
              </label>
            </div>
            <button type="button" className="workout-start-button" onClick={handleCompleteSet}>
              {isLastStep ? "Finish workout" : "Complete set"}
            </button>
          </div>
        ) : (
          <div className="workout-session-rest">
            <span className="workout-session-rest-label">REST</span>
            <span className="workout-rest-countdown">{formatClock(restRemaining)}</span>
            <p className="workout-session-up-next">
              Up next: {nextExercise.name} · Set {nextStep.setIndex + 1} of {nextExercise.sets}
            </p>
            <button type="button" className="workout-skip-rest" onClick={handleSkipRest}>
              Skip rest
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
