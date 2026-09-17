export function toYMD(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfWeekMonday(d) {
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

const WEEKDAY_INDEX_BY_KEY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// The next date (today included) matching a "mon".."sun" day key — used to
// turn a recurring schedule slot into a concrete date for AI generation.
export function nextDateForWeekday(dayKey, from = new Date()) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const diff = (WEEKDAY_INDEX_BY_KEY[dayKey] - start.getDay() + 7) % 7;
  return addDays(start, diff);
}

// Weeks (arrays of 7 Dates, Monday-first) covering the full month that
// `monthDate` falls in, including the lead-in/lead-out days from adjacent
// months needed to fill a rectangular grid.
export function monthGrid(monthDate) {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const gridStart = startOfWeekMonday(firstOfMonth);
  const weeks = [];
  let cursor = gridStart;
  for (let week = 0; week < 6; week++) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(days);
    // Stop once we've filled the month and the next week is entirely in the
    // following month.
    const lastDay = days[6];
    if (lastDay.getMonth() !== monthDate.getMonth() && lastDay > firstOfMonth) break;
  }
  return weeks;
}
