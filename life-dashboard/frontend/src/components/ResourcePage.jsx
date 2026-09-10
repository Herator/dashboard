import { useEffect, useState } from "react";
import { listItems, createItem, updateItem, deleteItem } from "../api";
import AiEditBox from "./AiEditBox";

function emptyForm(fields) {
  const form = {};
  for (const field of fields) {
    form[field.name] = field.type === "checkbox" ? false : "";
  }
  return form;
}

// `omitBlankOptional` is used for create (POST) only: a blank optional field is
// left out of the payload entirely so the backend's own column default applies.
// Sending an explicit `null` there would 422 for any field whose model
// annotation is non-Optional-with-a-default (e.g. `Package.status: str = "unknown"`).
// On update (PUT) the default (false) is kept: an explicit `null` is how a user
// clears a previously-set optional value.
function toPayload(fields, form, { omitBlankOptional = false } = {}) {
  const payload = {};
  for (const field of fields) {
    if (field.type === "list") {
      payload[field.name] = form[field.name]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (field.type === "checkbox") {
      payload[field.name] = !!form[field.name];
    } else if (form[field.name] === "") {
      if (omitBlankOptional && !field.required) continue;
      payload[field.name] = null;
    } else {
      payload[field.name] = form[field.name];
    }
  }
  return payload;
}

function toFormValues(fields, item) {
  const form = {};
  for (const field of fields) {
    const value = item[field.name];
    if (field.type === "list") {
      form[field.name] = Array.isArray(value) ? value.join(", ") : "";
    } else {
      form[field.name] = value ?? "";
    }
  }
  return form;
}

export default function ResourcePage({ resourceKey, label, fields, aiEditable, primaryField }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(() => emptyForm(fields));
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const data = await listItems(resourceKey);
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceKey]);

  function handleChange(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      if (editingId) {
        await updateItem(resourceKey, editingId, toPayload(fields, form));
      } else {
        await createItem(resourceKey, toPayload(fields, form, { omitBlankOptional: true }));
      }
      setForm(emptyForm(fields));
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(item) {
    setEditingId(item.id);
    setForm(toFormValues(fields, item));
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm(fields));
  }

  async function handleDelete(id) {
    setError(null);
    try {
      await deleteItem(resourceKey, id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="resource-page">
      <h1>{label}</h1>
      {aiEditable && (
        <AiEditBox resourceKey={resourceKey} primaryField={primaryField} onApplied={refresh} />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit} className="resource-form">
        {fields.map((field) => (
          <label key={field.name} htmlFor={`field-${field.name}`}>
            {field.label}
            {field.type === "select" ? (
              <select
                id={`field-${field.name}`}
                value={form[field.name]}
                required={field.required}
                onChange={(e) => handleChange(field.name, e.target.value)}
              >
                <option value="" disabled>
                  Select…
                </option>
                {field.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : field.type === "checkbox" ? (
              <input
                id={`field-${field.name}`}
                type="checkbox"
                checked={!!form[field.name]}
                onChange={(e) => handleChange(field.name, e.target.checked)}
              />
            ) : field.type === "textarea" ? (
              <textarea
                id={`field-${field.name}`}
                value={form[field.name]}
                required={field.required}
                onChange={(e) => handleChange(field.name, e.target.value)}
              />
            ) : (
              <input
                id={`field-${field.name}`}
                type={field.type === "list" ? "text" : field.type}
                value={form[field.name]}
                required={field.required}
                onChange={(e) => handleChange(field.name, e.target.value)}
              />
            )}
          </label>
        ))}
        <button type="submit">{editingId ? "Save" : "Add"}</button>
        {editingId && (
          <button type="button" onClick={cancelEdit}>
            Cancel
          </button>
        )}
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="resource-table">
          <thead>
            <tr>
              {fields.map((field) => (
                <th key={field.name}>{field.label}</th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                {fields.map((field) => (
                  <td key={field.name}>
                    {field.type === "list"
                      ? (item[field.name] || []).join(", ")
                      : field.type === "checkbox"
                        ? item[field.name]
                          ? "Yes"
                          : "No"
                        : String(item[field.name] ?? "")}
                  </td>
                ))}
                <td>
                  <button onClick={() => startEdit(item)}>Edit</button>
                  <button onClick={() => handleDelete(item.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
