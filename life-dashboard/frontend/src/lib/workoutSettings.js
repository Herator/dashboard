const KEY = "workout-settings";
const DEFAULTS = { units: "kg", restSeconds: 60, autoRest: true };

// Per-viewer preferences (weight unit, rest duration, auto-advance rest).
// No user-accounts system exists in this app, so localStorage is the whole
// story — not synced, not shared, good enough for a single-user dashboard.
export function getWorkoutSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function setWorkoutSettings(partial) {
  const next = { ...getWorkoutSettings(), ...partial };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing / storage disabled: setting just won't persist.
  }
  return next;
}
