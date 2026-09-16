const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.detail ? JSON.stringify(body.detail) : `Request failed: ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

// Public low-level helper: non-CRUD endpoints (e.g. the upcoming
// `POST /api/ai/edit`) reuse the same base URL and error handling instead of
// duplicating it.
export { request as apiRequest };

export function listItems(resource) {
  return request(`/api/${resource}/`);
}

export function getItem(resource, id) {
  return request(`/api/${resource}/${id}`);
}

export function createItem(resource, data) {
  return request(`/api/${resource}/`, { method: "POST", body: JSON.stringify(data) });
}

export function updateItem(resource, id, data) {
  return request(`/api/${resource}/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function deleteItem(resource, id) {
  return request(`/api/${resource}/${id}`, { method: "DELETE" });
}

export function previewAiEdit(resource, payload) {
  return request(`/api/${resource}/ai-edit/preview`, { method: "POST", body: JSON.stringify(payload) });
}

export function applyAiEdit(resource, payload) {
  return request(`/api/${resource}/ai-edit/apply`, { method: "POST", body: JSON.stringify(payload) });
}

export function syncGroceriesFromMealPlan(weekOf) {
  const query = weekOf ? `?week_of=${encodeURIComponent(weekOf)}` : "";
  return request(`/api/groceries/sync-meal-plan${query}`, { method: "POST" });
}

export function getWeather() {
  return request(`/api/weather/`);
}

export function getExternalEvents(start, end) {
  return request(`/api/external-events/?start=${start}&end=${end}`);
}

// The camera feed is an <img src> target, not a JSON fetch, so it needs the
// raw URL rather than going through the `request()` helper.
export function getPrinterCameraUrl() {
  return `${API_BASE}/api/printer/camera`;
}

export function getPrinterStatus() {
  return request(`/api/printer/status`);
}
