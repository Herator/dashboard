import { useState } from "react";
import WorkoutScheduleEditor from "../components/workout/WorkoutScheduleEditor";
import WorkoutLog from "../components/workout/WorkoutLog";
import WorkoutGenerateCard from "../components/workout/WorkoutGenerateCard";
import WorkoutLibrary from "../components/workout/WorkoutLibrary";
import WorkoutDetail from "../components/workout/WorkoutDetail";
import WorkoutSession from "../components/workout/WorkoutSession";

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

  function goToTab(next) {
    setTab(next);
    setSelected(null);
  }

  function exitSession() {
    setSessionWorkout(null);
    setSelected(null);
    bumpRefresh();
  }

  const screen = sessionWorkout ? "session" : selected ? "detail" : tab;

  return (
    <div className="workouts-shell">
      <aside className="workouts-nav">
        <div className="workouts-nav-brand">
          <span className="workouts-nav-dot" aria-hidden="true" />
          <span>Workouts</span>
        </div>
        <nav className="workouts-nav-links">
          <button
            type="button"
            className={`workouts-nav-link${tab === "home" && screen === "home" ? " workouts-nav-link--active" : ""}`}
            onClick={() => goToTab("home")}
          >
            Home
          </button>
          <button
            type="button"
            className={`workouts-nav-link${tab === "log" && screen === "log" ? " workouts-nav-link--active" : ""}`}
            onClick={() => goToTab("log")}
          >
            Log
          </button>
        </nav>
      </aside>

      <div className="workouts-main-wrap">
        {toast && <div className="workout-toast">{toast}</div>}

        <main className="workouts-main">
          {screen === "session" ? (
            <WorkoutSession workout={sessionWorkout} onExit={exitSession} onFinish={() => { exitSession(); showToast("Workout logged"); }} />
          ) : screen === "detail" ? (
            <WorkoutDetail
              workout={selected}
              onBack={() => setSelected(null)}
              onStart={(workout) => setSessionWorkout(workout)}
            />
          ) : screen === "log" ? (
            <>
              <h1>Workout log</h1>
              <WorkoutLog key={refreshKey} />
            </>
          ) : (
            <>
              <div className="workout-hero">
                <h1>What are we training today?</h1>
                <p className="workout-hero-sub">
                  Describe the workout you want — goal, time you have, equipment — and it'll build one for you.
                </p>
              </div>
              <WorkoutGenerateCard
                onGenerated={async () => {
                  bumpRefresh();
                  showToast("Workout generated");
                }}
              />
              <section>
                <h4 className="workouts-section-title">Your workouts</h4>
                <WorkoutLibrary key={refreshKey} onSelect={setSelected} />
              </section>
              <p className="widget-empty workout-schedule-hint">
                Set which days you train and what's on the plan — they show up automatically on the Home
                calendar.
              </p>
              <WorkoutScheduleEditor onWorkoutGenerated={bumpRefresh} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
