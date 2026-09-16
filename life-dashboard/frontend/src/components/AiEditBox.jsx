import { useState } from "react";
import { previewAiEdit, applyAiEdit } from "../lib/api";

function describe(item, primaryField) {
  if (!item) return "";
  return item[primaryField] ?? `#${item.id ?? "?"}`;
}

export default function AiEditBox({ resourceKey, primaryField, onApplied, dateFrom, dateTo, initialMessage = "" }) {
  const [message, setMessage] = useState(initialMessage);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSuggest(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await previewAiEdit(resourceKey, { message, date_from: dateFrom, date_to: dateTo });
      setPreview(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    setError(null);
    setLoading(true);
    try {
      await applyAiEdit(resourceKey, { items: preview.items, date_from: dateFrom, date_to: dateTo });
      setPreview(null);
      setMessage("");
      await onApplied();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setPreview(null);
  }

  const hasNoChanges =
    preview && preview.created.length === 0 && preview.updated.length === 0 && preview.deleted.length === 0;

  return (
    <div className="ai-edit-box">
      <form onSubmit={handleSuggest} className="ai-edit-form">
        <input
          placeholder="Tell the AI what to change… e.g. swap Tuesday dinner for chicken"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={loading || !!preview}
        />
        <button type="submit" disabled={loading || !message || !!preview}>
          Suggest
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {preview && (
        <div className="ai-edit-preview">
          <h3>AI Preview</h3>
          {hasNoChanges && <p>No changes.</p>}
          {preview.created.length > 0 && (
            <p>
              ➕ Create {preview.created.length}: {preview.created.map((i) => describe(i, primaryField)).join(", ")}
            </p>
          )}
          {preview.updated.length > 0 && (
            <p>
              ✏️ Update {preview.updated.length}: {preview.updated.map((u) => describe(u.after, primaryField)).join(", ")}
            </p>
          )}
          {preview.deleted.length > 0 && (
            <p>
              🗑 Delete {preview.deleted.length}: {preview.deleted.map((i) => describe(i, primaryField)).join(", ")}
            </p>
          )}
          <div className="ai-edit-actions">
            <button type="button" onClick={handleCancel} disabled={loading}>
              Cancel
            </button>
            <button type="button" onClick={handleApply} disabled={loading}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
