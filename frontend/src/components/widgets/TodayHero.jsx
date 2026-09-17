import { useEffect, useMemo, useState } from "react";
import { getExternalEvents, getWeather, listItems } from "../../lib/api";
import { describeWeatherCode } from "../../lib/weatherCodes";
import { DEFAULT_EVENT_COLOR } from "../../lib/eventColors";
import { addDays, toYMD } from "../../lib/dateUtils";
import WeatherIcon from "./WeatherIcon";

const MEAL_SLOTS = ["breakfast", "lunch", "dinner"];
const SLOT_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const DAY_KEYS_BY_GETDAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
// A week is plenty of lookahead for "next 3 things" without fetching the
// whole visible calendar range CalendarWidget needs.
const AGENDA_LOOKAHEAD_DAYS = 7;

function formatAgendaTime(iso, todayKey) {
  const date = new Date(iso);
  if (toYMD(date) === todayKey) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return `${date.toLocaleDateString([], { weekday: "short" })} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

// One glanceable strip combining today's weather, the next few agenda items,
// and today's meals — the three things a "what's happening today" glance at
// the fridge actually needs, instead of scanning the full calendar/meal grid.
export default function TodayHero() {
  const [weatherDay, setWeatherDay] = useState(null);
  const [upNext, setUpNext] = useState([]);
  const [meals, setMeals] = useState({});
  const [error, setError] = useState(null);

  const todayKey = useMemo(() => toYMD(new Date()), []);

  useEffect(() => {
    getWeather()
      .then((data) => setWeatherDay(data.days?.[0] || null))
      .catch((err) => setError(err.message));

    const now = new Date();
    const rangeEnd = addDays(now, AGENDA_LOOKAHEAD_DAYS);
    Promise.all([
      listItems("events"),
      getExternalEvents(todayKey, toYMD(rangeEnd)),
      listItems("workout-schedule"),
    ])
      .then(([events, externalData, workoutSchedule]) => {
        const entries = [
          ...events.map((ev) => ({
            id: `local-${ev.id}`,
            title: ev.title,
            start: ev.start,
            color: ev.color || DEFAULT_EVENT_COLOR,
          })),
          ...(externalData.events || []).map((ev, i) => ({
            id: `ext-${i}`,
            title: ev.title,
            start: ev.start,
            color: ev.color || DEFAULT_EVENT_COLOR,
          })),
        ];
        for (let d = 0; d <= AGENDA_LOOKAHEAD_DAYS; d++) {
          const date = addDays(now, d);
          const dayKey = DAY_KEYS_BY_GETDAY[date.getDay()];
          for (const slot of workoutSchedule) {
            if (slot.day_of_week !== dayKey) continue;
            const key = toYMD(date);
            entries.push({
              id: `workout-${slot.id}-${key}`,
              title: `${slot.label || "Workout"}`,
              start: `${key}T${slot.time}`,
              color: "var(--accent)",
            });
          }
        }
        const next = entries
          .filter((entry) => new Date(entry.start) >= now)
          .sort((a, b) => new Date(a.start) - new Date(b.start))
          .slice(0, 3);
        setUpNext(next);
      })
      .catch((err) => setError(err.message));

    listItems("meal-plan")
      .then((items) => {
        const todayMeals = {};
        for (const item of items) {
          if (item.date === todayKey) todayMeals[item.meal_slot] = item.name;
        }
        setMeals(todayMeals);
      })
      .catch((err) => setError(err.message));
  }, [todayKey]);

  const weatherIcon = weatherDay ? describeWeatherCode(weatherDay.code) : null;

  return (
    <section className="widget today-hero">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="today-hero-weather">
        {weatherDay ? (
          <>
            <WeatherIcon shape={weatherIcon.shape} large label={weatherIcon.label} />
            <div>
              <div className="today-hero-label">Today</div>
              <div className="today-hero-temp">
                {Math.round(weatherDay.temp_max)}°{" "}
                <span className="today-hero-temp-low">{Math.round(weatherDay.temp_min)}°</span>
              </div>
              <div className="today-hero-rain">{weatherDay.precipitation_chance}% rain</div>
            </div>
          </>
        ) : (
          <p className="widget-loading">Loading…</p>
        )}
      </div>

      <div>
        <div className="today-hero-label">Up Next</div>
        {upNext.length === 0 ? (
          <p className="widget-empty">Nothing scheduled.</p>
        ) : (
          <div className="today-hero-agenda">
            {upNext.map((ev) => (
              <div className="today-hero-agenda-item" key={ev.id}>
                <span className="calendar-legend-dot" style={{ background: ev.color }} />
                <span className="today-hero-agenda-time">{formatAgendaTime(ev.start, todayKey)}</span>
                <span>{ev.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="today-hero-label">Today's Meals</div>
        <div className="today-hero-meals">
          {MEAL_SLOTS.map((slot) => (
            <div className="today-hero-meal" key={slot}>
              <span className="today-hero-meal-slot">{SLOT_LABELS[slot]}</span>
              {meals[slot] ? ` · ${meals[slot]}` : <span className="meal-plan-empty"> · —</span>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
