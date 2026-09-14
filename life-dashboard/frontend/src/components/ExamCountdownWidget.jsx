import { useEffect, useState } from "react";
import { listItems } from "../api";
import { toYMD } from "../dateUtils";

const MS_PER_DAY = 86400000;

export default function ExamCountdownWidget() {
  const [nextExam, setNextExam] = useState(undefined); // undefined = loading, null = none
  const [error, setError] = useState(null);

  useEffect(() => {
    listItems("exams")
      .then((exams) => {
        const todayKey = toYMD(new Date());
        const upcoming = exams
          .filter((exam) => exam.date >= todayKey)
          .sort((a, b) => (a.date < b.date ? -1 : 1));
        setNextExam(upcoming[0] || null);
      })
      .catch((err) => setError(err.message));
  }, []);

  const daysAway = nextExam
    ? Math.round((new Date(`${nextExam.date}T00:00:00`) - new Date(`${toYMD(new Date())}T00:00:00`)) / MS_PER_DAY)
    : null;

  return (
    <section className="widget exam-widget">
      <div className="today-hero-label">Exam Countdown</div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {nextExam === undefined && !error && <p className="widget-loading">Loading…</p>}
      {nextExam === null && <p className="widget-empty">No exams scheduled.</p>}
      {nextExam && (
        <div>
          <div className="exam-countdown-days">
            {daysAway}
            <span className="exam-countdown-unit"> {daysAway === 1 ? "day" : "days"}</span>
          </div>
          <div className="exam-countdown-detail">
            {nextExam.subject} —{" "}
            {new Date(`${nextExam.date}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}
          </div>
        </div>
      )}
    </section>
  );
}
