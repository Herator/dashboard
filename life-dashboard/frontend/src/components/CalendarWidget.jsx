import { useEffect, useMemo, useState } from "react";
import { listItems, createItem, updateItem, deleteItem, getExternalEvents } from "../api";
import { monthGrid, startOfWeekMonday, addDays, toYMD } from "../dateUtils";
import { DEFAULT_EVENT_COLOR } from "../eventColors";
import { RESOURCES } from "../resourceConfigs";
import { planIcon } from "../workoutPlans";
import ColorSwatchPicker from "./ColorSwatchPicker";

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SOURCE_OPTIONS = ["self", "girlfriend", "school"];
// Date#getDay() is 0=Sunday..6=Saturday; WorkoutSchedule.day_of_week uses the
// same three-letter keys the backend enum does.
const DAY_KEYS_BY_GETDAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WORKOUT_COLOR = RESOURCES.find((r) => r.key === "workouts")?.accent || "#ff6b6b";
const HOUR_HEIGHT = 48; // px per hour in the week timeline
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Lays a day's events out like Google Calendar's day view: overlapping
// events split into side-by-side columns, sized to the widest concurrent
// overlap they're part of. Zero/negative-duration items (e.g. workout
// schedule markers, which have no real end time) get a minimum 30min
// span so they're still visible as a block rather than collapsing to 0px.
function layoutDayEvents(items) {
  const events = items.map((item) => {
    const startMs = new Date(item.start).getTime();
    let endMs = new Date(item.end).getTime();
    if (endMs <= startMs) endMs = startMs + 30 * 60000;
    return { item, startMs, endMs };
  });
  events.sort((a, b) => a.startMs - b.startMs);

  const result = [];
  let cluster = [];
  let clusterEnd = -Infinity;

  function flushCluster() {
    if (cluster.length === 0) return;
    const columnsEnd = [];
    for (const ev of cluster) {
      let col = columnsEnd.findIndex((end) => end <= ev.startMs);
      if (col === -1) {
        col = columnsEnd.length;
        columnsEnd.push(ev.endMs);
      } else {
        columnsEnd[col] = ev.endMs;
      }
      ev.col = col;
    }
    const cols = columnsEnd.length;
    for (const ev of cluster) result.push({ ...ev, cols });
    cluster = [];
  }

  for (const ev of events) {
    if (ev.startMs >= clusterEnd) flushCluster();
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.endMs);
  }
  flushCluster();

  return result;
}

function WeekTimeline({ days, todayKey, itemsByDate, now, onSlotClick, onEventClick }) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="week-timeline-scroll">
      <div className="week-timeline" style={{ "--hour-height": `${HOUR_HEIGHT}px` }}>
        <div className="week-timeline-corner" />
        {days.map((date) => {
          const key = toYMD(date);
          return (
            <div key={key} className={`week-day-header${key === todayKey ? " week-day-header--today" : ""}`}>
              <span className="week-day-name">{date.toLocaleDateString([], { weekday: "short" })}</span>
              <span className="week-day-num">{date.getDate()}</span>
            </div>
          );
        })}
        <div className="week-hours-col">
          {HOURS.map((h) => (
            <span key={h} className="week-hour-label" style={{ top: h * HOUR_HEIGHT }}>
              {`${String(h).padStart(2, "0")}:00`}
            </span>
          ))}
        </div>
        {days.map((date) => {
          const key = toYMD(date);
          const dayStartMs = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
          const laidOut = layoutDayEvents(itemsByDate.get(key) || []);
          return (
            <div
              key={key}
              data-testid={`calendar-day-${key}`}
              className="week-day-col"
              onClick={() => onSlotClick(key)}
            >
              {key === todayKey && (
                <div className="week-now-line" style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}>
                  <span className="week-now-dot" />
                </div>
              )}
              {laidOut.map(({ item, startMs, endMs, col, cols }, i) => {
                const top = ((startMs - dayStartMs) / 3600000) * HOUR_HEIGHT;
                const height = Math.max(((endMs - startMs) / 3600000) * HOUR_HEIGHT, 20);
                const widthPct = 100 / cols;
                return (
                  <button
                    type="button"
                    key={i}
                    className="week-event"
                    style={{
                      top,
                      height,
                      left: `${col * widthPct}%`,
                      width: `calc(${widthPct}% - 2px)`,
                      background: item.color,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(item, key);
                    }}
                  >
                    <span className="week-event-title">{item.title}</span>
                    <span className="week-event-time">
                      {formatTime(item.start)}–{formatTime(item.end)}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function emptyForm(dateKey) {
  return {
    source: "self",
    title: "",
    startTime: "09:00",
    endTime: "10:00",
    location: "",
    notes: "",
    color: DEFAULT_EVENT_COLOR,
    date: dateKey,
  };
}

function eventToForm(event) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    source: event.source,
    title: event.title,
    startTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
    location: event.location || "",
    notes: event.notes || "",
    color: event.color || DEFAULT_EVENT_COLOR,
    date: toYMD(start),
  };
}

export default function CalendarWidget() {
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState("month"); // "month" | "week"
  const [events, setEvents] = useState([]);
  const [externalEvents, setExternalEvents] = useState([]);
  const [feedErrors, setFeedErrors] = useState([]);
  const [feeds, setFeeds] = useState([]);
  const [workoutSchedule, setWorkoutSchedule] = useState([]);
  const [error, setError] = useState(null);

  // { date, mode: "agenda" | "form", editingId } | null
  const [dayModal, setDayModal] = useState(null);
  const [form, setForm] = useState(null);
  const [feedsModalOpen, setFeedsModalOpen] = useState(false);
  const [feedForm, setFeedForm] = useState(null);

  function refreshEvents() {
    return listItems("events")
      .then(setEvents)
      .catch((err) => setError(err.message));
  }

  function refreshFeeds() {
    return listItems("calendar-feeds")
      .then(setFeeds)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    refreshEvents();
    refreshFeeds();
    listItems("workout-schedule")
      .then(setWorkoutSchedule)
      .catch((err) => setError(err.message));
  }, []);

  const weeks = useMemo(() => {
    if (viewMode === "week") {
      const start = startOfWeekMonday(monthDate);
      return [Array.from({ length: 7 }, (_, i) => addDays(start, i))];
    }
    return monthGrid(monthDate);
  }, [monthDate, viewMode]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const rangeStartKey = toYMD(weeks[0][0]);
  const rangeEndKey = toYMD(weeks[weeks.length - 1][6]);

  useEffect(() => {
    getExternalEvents(rangeStartKey, rangeEndKey)
      .then((data) => {
        setExternalEvents(data.events);
        setFeedErrors(data.errors || []);
      })
      .catch((err) => setError(err.message));
  }, [rangeStartKey, rangeEndKey]);

  const itemsByDate = useMemo(() => {
    const map = new Map();
    function add(key, entry) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    }
    for (const ev of events) {
      add(toYMD(new Date(ev.start)), {
        kind: "local",
        id: ev.id,
        title: ev.title,
        start: ev.start,
        end: ev.end,
        location: ev.location,
        notes: ev.notes,
        source: ev.source,
        color: ev.color || DEFAULT_EVENT_COLOR,
      });
    }
    for (const ev of externalEvents) {
      add(toYMD(new Date(ev.start)), {
        kind: "external",
        title: ev.title,
        start: ev.start,
        end: ev.end,
        feedName: ev.feed_name,
        color: ev.color,
      });
    }
    // Recurring training slots aren't stored as dated rows — compute which
    // days in the visible month grid match each schedule entry's weekday,
    // the same way subscribed external calendars are merged in above.
    for (const date of weeks.flat()) {
      const dayKey = DAY_KEYS_BY_GETDAY[date.getDay()];
      for (const slot of workoutSchedule) {
        if (slot.day_of_week !== dayKey) continue;
        const key = toYMD(date);
        add(key, {
          kind: "workout",
          title: `${planIcon(slot.label)} ${slot.label || "Workout"}`,
          start: `${key}T${slot.time}`,
          end: `${key}T${slot.time}`,
          color: WORKOUT_COLOR,
        });
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.start) - new Date(b.start));
    }
    return map;
  }, [events, externalEvents, workoutSchedule, weeks]);

  const todayKey = toYMD(new Date());
  const monthLabel =
    viewMode === "week"
      ? `${weeks[0][0].toLocaleDateString([], { month: "short", day: "numeric" })} – ${weeks[0][6].toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`
      : monthDate.toLocaleDateString([], { month: "long", year: "numeric" });

  function shiftPeriod(delta) {
    setMonthDate((prev) =>
      viewMode === "week"
        ? addDays(prev, delta * 7)
        : new Date(prev.getFullYear(), prev.getMonth() + delta, 1)
    );
  }

  function openAgenda(dateKey) {
    setDayModal({ date: dateKey, mode: "agenda" });
    setForm(null);
  }

  function openAddForm(dateKey) {
    setDayModal({ date: dateKey, mode: "form", editingId: null });
    setForm(emptyForm(dateKey));
  }

  function openEditForm(event) {
    setDayModal((prev) => ({ ...prev, mode: "form", editingId: event.id }));
    setForm(eventToForm(event));
  }

  function closeModal() {
    setDayModal(null);
    setForm(null);
  }

  function updateField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const payload = {
      source: form.source,
      title: form.title,
      start: `${form.date}T${form.startTime}`,
      end: `${form.date}T${form.endTime}`,
      location: form.location || null,
      notes: form.notes || null,
      color: form.color,
    };
    try {
      if (dayModal.editingId) {
        await updateItem("events", dayModal.editingId, payload);
      } else {
        await createItem("events", payload);
      }
      closeModal();
      await refreshEvents();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    setError(null);
    try {
      await deleteItem("events", id);
      closeModal();
      await refreshEvents();
    } catch (err) {
      setError(err.message);
    }
  }

  function openFeedsModal() {
    setFeedsModalOpen(true);
    setFeedForm(null);
  }

  function openAddFeedForm() {
    setFeedForm({ name: "", url: "", color: DEFAULT_EVENT_COLOR });
  }

  async function handleAddFeed(e) {
    e.preventDefault();
    setError(null);
    try {
      await createItem("calendar-feeds", feedForm);
      setFeedForm(null);
      await refreshFeeds();
      const data = await getExternalEvents(rangeStartKey, rangeEndKey);
      setExternalEvents(data.events);
      setFeedErrors(data.errors || []);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteFeed(id) {
    setError(null);
    try {
      await deleteItem("calendar-feeds", id);
      await refreshFeeds();
      setExternalEvents((prev) => prev.filter((ev) => ev.feed_id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  const modalDayItems = dayModal ? itemsByDate.get(dayModal.date) || [] : [];
  const modalDayLabel = dayModal
    ? new Date(`${dayModal.date}T00:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })
    : "";

  return (
    <section className="widget calendar-widget">
      <div className="widget-header">
        <h2>Calendar</h2>
        <div className="calendar-nav">
          <button type="button" onClick={() => shiftPeriod(-1)} aria-label={`Previous ${viewMode}`}>
            ‹
          </button>
          <span className="calendar-month-label">{monthLabel}</span>
          <button type="button" onClick={() => shiftPeriod(1)} aria-label={`Next ${viewMode}`}>
            ›
          </button>
          <button
            type="button"
            className="calendar-view-toggle"
            onClick={() => setViewMode((m) => (m === "month" ? "week" : "month"))}
          >
            {viewMode === "month" ? "Week" : "Month"}
          </button>
          <button type="button" className="calendar-manage-btn" onClick={openFeedsModal} title="Subscribe to a calendar">
            🔗
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {viewMode === "week" ? (
        <WeekTimeline
          days={weeks[0]}
          todayKey={todayKey}
          itemsByDate={itemsByDate}
          now={now}
          onSlotClick={openAddForm}
          onEventClick={(item, key) => (item.kind === "local" ? openEditForm(item) : openAgenda(key))}
        />
      ) : (
        <>
          <div className="calendar-legend">
            <span className="calendar-legend-item">
              <span className="calendar-legend-dot" style={{ background: "var(--accent)" }} />
              Personal
            </span>
            <span className="calendar-legend-item">
              <span className="calendar-legend-dot" style={{ background: "var(--accent-school)" }} />
              School
            </span>
          </div>
          <div className="calendar-grid">
            {WEEKDAY_HEADERS.map((d) => (
              <div key={d} className="calendar-weekday">
                {d}
              </div>
            ))}
            {weeks.flat().map((date) => {
              const key = toYMD(date);
              const dayItems = itemsByDate.get(key) || [];
              const inMonth = date.getMonth() === monthDate.getMonth();
              const classes = ["calendar-day"];
              if (!inMonth) classes.push("calendar-day--outside");
              if (key === todayKey) classes.push("calendar-day--today");
              const primary = dayItems[0];
              return (
                <button
                  type="button"
                  key={key}
                  data-testid={`calendar-day-${key}`}
                  className={classes.join(" ")}
                  onClick={() => openAgenda(key)}
                  onDoubleClick={() => openAddForm(key)}
                >
                  <span className="calendar-day-number">{date.getDate()}</span>
                  {primary && (
                    <span className="calendar-day-title" style={{ color: primary.color }}>
                      {primary.title}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {dayModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {dayModal.mode === "agenda" && (
              <>
                <div className="modal-header">
                  <h3>{modalDayLabel}</h3>
                  <button type="button" onClick={closeModal} aria-label="Close" className="modal-close">
                    ×
                  </button>
                </div>
                <button type="button" className="calendar-add-event-btn" onClick={() => openAddForm(dayModal.date)}>
                  + Add event
                </button>
                {modalDayItems.length === 0 ? (
                  <p className="widget-empty">Nothing scheduled.</p>
                ) : (
                  <ul className="calendar-agenda">
                    {modalDayItems.map((item, i) => (
                      <li key={i}>
                        {item.kind === "local" ? (
                          <button type="button" className="calendar-agenda-item" onClick={() => openEditForm(item)}>
                            <span className="calendar-dot" style={{ "--accent": item.color }} />
                            <span className="calendar-agenda-time">
                              {new Date(item.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <span className="calendar-agenda-title">{item.title}</span>
                          </button>
                        ) : (
                          <span className="calendar-agenda-item calendar-agenda-item--external">
                            <span className="calendar-dot" style={{ "--accent": item.color }} />
                            <span className="calendar-agenda-time">
                              {new Date(item.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <span className="calendar-agenda-title">{item.title}</span>
                            <span className="calendar-agenda-feed">
                              {item.kind === "workout" ? "Scheduled" : item.feedName}
                            </span>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {dayModal.mode === "form" && form && (
              <>
                <div className="modal-header">
                  <h3>{modalDayLabel}</h3>
                  <button type="button" onClick={closeModal} aria-label="Close" className="modal-close">
                    ×
                  </button>
                </div>
                <form onSubmit={handleSubmit} className="calendar-event-form">
                  <label>
                    Title
                    <input value={form.title} required onChange={(e) => updateField("title", e.target.value)} />
                  </label>
                  <div className="calendar-event-form-row">
                    <label>
                      Source
                      <select value={form.source} onChange={(e) => updateField("source", e.target.value)}>
                        {SOURCE_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Start
                      <input
                        type="time"
                        value={form.startTime}
                        required
                        onChange={(e) => updateField("startTime", e.target.value)}
                      />
                    </label>
                    <label>
                      End
                      <input
                        type="time"
                        value={form.endTime}
                        required
                        onChange={(e) => updateField("endTime", e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    Location
                    <input value={form.location} onChange={(e) => updateField("location", e.target.value)} />
                  </label>
                  <label>
                    Notes
                    <textarea value={form.notes} onChange={(e) => updateField("notes", e.target.value)} />
                  </label>
                  <label>
                    Color
                    <ColorSwatchPicker value={form.color} onChange={(color) => updateField("color", color)} />
                  </label>
                  <div className="calendar-event-form-actions">
                    <button type="submit">{dayModal.editingId ? "Save" : "Add"}</button>
                    <button type="button" onClick={closeModal}>
                      Cancel
                    </button>
                    {dayModal.editingId && (
                      <button type="button" className="calendar-event-delete" onClick={() => handleDelete(dayModal.editingId)}>
                        Delete
                      </button>
                    )}
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {feedsModalOpen && (
        <div className="modal-overlay" onClick={() => setFeedsModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Subscribed calendars</h3>
              <button type="button" onClick={() => setFeedsModalOpen(false)} aria-label="Close" className="modal-close">
                ×
              </button>
            </div>
            {feeds.length === 0 && !feedForm && <p className="widget-empty">No subscriptions yet.</p>}
            {feeds.length > 0 && (
              <ul className="feed-list">
                {feeds.map((feed) => {
                  const feedError = feedErrors.find((e) => e.feed_id === feed.id);
                  return (
                    <li key={feed.id}>
                      <div className="feed-row">
                        <span className="calendar-dot" style={{ "--accent": feed.color }} />
                        <span className="feed-name">{feed.name}</span>
                        <button type="button" onClick={() => handleDeleteFeed(feed.id)}>
                          Remove
                        </button>
                      </div>
                      {feedError && (
                        <p className="feed-error" role="alert">
                          Couldn't load this calendar: {feedError.detail}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {feedForm ? (
              <form onSubmit={handleAddFeed} className="calendar-event-form">
                <label>
                  Name
                  <input
                    value={feedForm.name}
                    required
                    placeholder="e.g. Girlfriend"
                    onChange={(e) => setFeedForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </label>
                <label>
                  Calendar link (iCal/ICS URL)
                  <input
                    type="url"
                    value={feedForm.url}
                    required
                    placeholder="https://calendar.google.com/.../basic.ics"
                    onChange={(e) => setFeedForm((prev) => ({ ...prev, url: e.target.value }))}
                  />
                </label>
                <label>
                  Color
                  <ColorSwatchPicker
                    value={feedForm.color}
                    onChange={(color) => setFeedForm((prev) => ({ ...prev, color }))}
                  />
                </label>
                <div className="calendar-event-form-actions">
                  <button type="submit">Add</button>
                  <button type="button" onClick={() => setFeedForm(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={openAddFeedForm}>
                + Subscribe to a calendar
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
