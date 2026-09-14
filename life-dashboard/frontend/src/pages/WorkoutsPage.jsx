import { useState } from "react";
import WorkoutScheduleEditor from "../components/WorkoutScheduleEditor";
import WorkoutLog from "../components/WorkoutLog";

export default function WorkoutsPage() {
  // Bumped whenever the schedule editor's "Generate this workout" AI box
  // applies a change, so the Workout Log below (a separate component
  // instance) picks up the new/updated row without a manual page reload.
  const [logKey, setLogKey] = useState(0);

  return (
    <>
      <div className="resource-page">
        <div className="workout-hero">
          <span className="workout-hero-icon" aria-hidden="true">
            💪
          </span>
          <div>
            <h1>Workouts</h1>
            <p className="workout-hero-subtitle">Plan your split, log your sessions.</p>
          </div>
        </div>
        <p className="widget-empty workout-schedule-hint">
          Set which days you train and what's on the plan — they show up automatically on the Home calendar.
        </p>
        <WorkoutScheduleEditor onWorkoutGenerated={() => setLogKey((k) => k + 1)} />
      </div>

      <div className="resource-page">
        <h2>Workout Log</h2>
        <WorkoutLog key={logKey} />
      </div>
    </>
  );
}
