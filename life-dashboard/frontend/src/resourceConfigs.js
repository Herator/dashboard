export const RESOURCES = [
  {
    key: "events",
    label: "Calendar",
    fields: [
      { name: "source", label: "Source", type: "select", options: ["self", "girlfriend", "school"], required: true },
      { name: "title", label: "Title", type: "text", required: true },
      { name: "start", label: "Start", type: "datetime-local", required: true },
      { name: "end", label: "End", type: "datetime-local", required: true },
      { name: "location", label: "Location", type: "text" },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
  {
    key: "meal-plan",
    label: "Meal Plan",
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
    fields: [
      { name: "date", label: "Date", type: "date", required: true },
      { name: "plan_text", label: "Plan", type: "textarea", required: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
  {
    key: "assignments",
    label: "Assignments",
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "course", label: "Course", type: "text", required: true },
      { name: "due_date", label: "Due Date", type: "date", required: true },
      { name: "status", label: "Status", type: "select", options: ["not_started", "in_progress", "done"], required: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
  {
    key: "exams",
    label: "Exams",
    fields: [
      { name: "subject", label: "Subject", type: "text", required: true },
      { name: "date", label: "Date", type: "date", required: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
  {
    key: "reminders",
    label: "Reminders",
    fields: [
      { name: "text", label: "Text", type: "text", required: true },
      { name: "trigger_time", label: "Trigger Time", type: "datetime-local", required: true },
      { name: "sent", label: "Sent", type: "checkbox" },
    ],
  },
  {
    key: "packages",
    label: "Packages",
    fields: [
      { name: "tracking_number", label: "Tracking Number", type: "text", required: true },
      { name: "carrier", label: "Carrier", type: "text" },
      { name: "status", label: "Status", type: "text" },
    ],
  },
];
