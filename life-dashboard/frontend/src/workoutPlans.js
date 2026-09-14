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

const PLAN_ICONS = {
  "Push Day": "🏋️",
  "Pull Day": "🚣",
  "Leg Day": "🦵",
  "Chest Day": "💪",
  "Back Day": "🔙",
  "Shoulder Day": "🤸",
  "Arm Day": "💪",
  "Full Body": "🔥",
  Cardio: "🏃",
  "Rest Day": "😴",
};

export function planIcon(label) {
  return PLAN_ICONS[label] || "🏋️";
}

// Backend returns "HH:MM:SS"; the UI never needs seconds precision.
export function formatTime(value) {
  return (value || "").slice(0, 5);
}
