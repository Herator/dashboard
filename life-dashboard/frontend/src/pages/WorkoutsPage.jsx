import { useState } from "react";
import WorkoutScheduleEditor from "../components/WorkoutScheduleEditor";
import WorkoutLog from "../components/WorkoutLog";
import WorkoutGenerateCard from "../components/WorkoutGenerateCard";
import WorkoutLibrary from "../components/WorkoutLibrary";
import WorkoutDetail from "../components/WorkoutDetail";
import WorkoutSession from "../components/WorkoutSession";

export default function WorkoutsPage() {
  const [tab, setTab] = useState("home");
  // Bumped whenever a generate/schedule/session action changes workout rows,
  // so the Library and Log (separate component instances/tabs) refetch
  // instead of needing a manual page reload.
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState(null); // workout shown in Detail
  const [sessionWorkout, setSessionWorkout] = useState(null); // workout in a guided Session
  const [toast, setToast] = useState(null);

  function bumpRefresh() {
    setRefreshKey((k) => k + 1);
  }

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast((current) => (current === message ? null : current)), 3000);
  }

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

        <div className="workout-tabbar">
          <button
            type="button"
            className={`workout-tab${tab === "home" ? " workout-tab--active" : ""}`}
            onClick={() => setTab("home")}
          >
            Home
          </button>
          <button
            type="button"
            className={`workout-tab${tab === "log" ? " workout-tab--active" : ""}`}
            onClick={() => setTab("log")}
          >
            Log
          </button>
        </div>

        {tab === "home" ? (
          <>
            <WorkoutGenerateCard
              onGenerated={async () => {
                bumpRefresh();
                showToast("Workout generated");
              }}
            />
            <h2>Your workouts</h2>
            <WorkoutLibrary key={refreshKey} onSelect={setSelected} />
            <p className="widget-empty workout-schedule-hint">
              Set which days you train and what's on the plan — they show up automatically on the Home
              calendar.
            </p>
            <WorkoutScheduleEditor onWorkoutGenerated={bumpRefresh} />
          </>
        ) : (
          <>
            <h2>Workout Log</h2>
            <WorkoutLog key={refreshKey} />
          </>
        )}
      </div>

      {selected && !sessionWorkout && (
        <WorkoutDetail
          workout={selected}
          onBack={() => setSelected(null)}
          onStart={(workout) => {
            setSessionWorkout(workout);
            setSelected(null);
          }}
        />
      )}

      {sessionWorkout && (
        <WorkoutSession
          workout={sessionWorkout}
          onExit={() => {
            setSessionWorkout(null);
            bumpRefresh();
          }}
          onFinish={() => {
            setSessionWorkout(null);
            bumpRefresh();
            showToast("Workout logged");
          }}
        />
      )}

      {toast && <div className="workout-toast">{toast}</div>}
    </>
  );
}
