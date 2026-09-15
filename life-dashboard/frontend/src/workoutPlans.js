export const PLAN_OPTIONS = [
  "Push Day",
  "Pull Day",
  "Leg Day",
  "Chest Day",
  "Back Day",
  "Shoulder Day",
  "Arm Day",
  "Full Body",
  "Cardio",
  "Rest Day",
];


// Backend returns "HH:MM:SS"; the UI never needs seconds precision.
export function formatTime(value) {
  return (value || "").slice(0, 5);
}

// Pads/trims a per-set array to `length`, defaulting missing entries — used
// for `completed`/`weight`/`actual_reps`, which should all track `sets` 1:1
// but aren't trusted to stay in sync if `sets` is edited after the fact.
function padSetArray(arr, length, fallback) {
  return Array.from({ length }, (_, i) => arr?.[i] ?? fallback);
}

export function completedStates(exercise) {
  return padSetArray(exercise.completed, exercise.sets, false);
}

export function weightStates(exercise) {
  return padSetArray(exercise.weight, exercise.sets, null);
}

export function actualRepsStates(exercise) {
  return padSetArray(exercise.actual_reps, exercise.sets, null);
}

// Flat list of {exerciseIndex, setIndex} steps driving a guided
// one-set-at-a-time session, in exercise order.
export function sessionSteps(exercises) {
  const steps = [];
  exercises.forEach((exercise, exerciseIndex) => {
    for (let setIndex = 0; setIndex < exercise.sets; setIndex++) {
      steps.push({ exerciseIndex, setIndex });
    }
  });
  return steps;
}
