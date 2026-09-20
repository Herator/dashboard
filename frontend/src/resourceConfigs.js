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
      { name: "amount_used", label: "Amount Used", type: "text" },
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
      { name: "price", label: "Price (NOK)", type: "text" },
      { name: "weight", label: "Weight/Volume", type: "text" },
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
    key: "filament",
    label: "Filament",
    icon: "🧵",
    accent: "#54a0ff",
    fields: [
      { name: "material", label: "Material", type: "text", required: true },
      { name: "color_name", label: "Color", type: "text", required: true },
      { name: "color_hex", label: "Swatch", type: "color" },
      { name: "brand", label: "Brand", type: "text" },
      { name: "weight_total_g", label: "Weight (g)", type: "number" },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
];
