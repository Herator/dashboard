// Calendar, Exams, Reminders and Packages are intentionally not here: they
// have no standalone page/nav tile. Calendar is managed directly from the
// CalendarWidget on Home; Exams, Reminders and Packages are unused and
// hidden from the UI (their backend routes are untouched, so no data is
// lost if they come back later).
export const RESOURCES = [
  {
    key: "meal-plan",
    label: "Meal Plan",
    icon: "🍽️",
    accent: "#ff9f43",
    aiEditable: true,
    primaryField: "name",
    fields: [
      { name: "date", label: "Date", type: "date", required: true },
      { name: "meal_slot", label: "Meal", type: "select", options: ["breakfast", "lunch", "dinner", "snack"], required: true },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "ingredients", label: "Ingredients (comma-separated)", type: "list" },
    ],
  },
  {
    key: "groceries",
    label: "Groceries",
    icon: "🛒",
    accent: "#2ed573",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "quantity", label: "Quantity", type: "text" },
      { name: "checked", label: "Checked", type: "checkbox" },
      { name: "week_of", label: "Week Of", type: "date", required: true },
    ],
  },
  {
    key: "workouts",
    label: "Workouts",
    icon: "💪",
    accent: "#ff6b6b",
    aiEditable: true,
    primaryField: "plan_text",
    fields: [
      { name: "date", label: "Date", type: "date", required: true },
      { name: "plan_text", label: "Plan", type: "textarea", required: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
  {
    key: "assignments",
    label: "Assignments",
    icon: "📝",
    accent: "#a55eea",
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "course", label: "Course", type: "text", required: true },
      { name: "due_date", label: "Due Date", type: "date", required: true },
      { name: "status", label: "Status", type: "select", options: ["not_started", "in_progress", "done"], required: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
];
