import { useEffect, useState } from "react";
import { getMealPreferences, updateMealPreferences } from "../../lib/api";
import AiEditBox from "../AiEditBox";

function TagInput({ label, verb, values, onAdd, onRemove, variant }) {
  const [input, setInput] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    const v = input.trim();
    if (!v) return;
    onAdd(v);
    setInput("");
  }

  return (
    <div>
      <h4>{label}</h4>
      <div className="meal-tag-list">
        {values.map((v) => (
          <button key={v} type="button" className={`meal-tag meal-tag--${variant} meal-tag--removable`} onClick={() => onRemove(v)}>
            {v} ×
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="meal-prefs-add-form">
        <input placeholder={`Add something you ${verb}`} value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" aria-label={`Add ${label.toLowerCase()}`}>
          +
        </button>
      </form>
    </div>
  );
}

export default function MealPreferencesDialog({ onClose }) {
  const [likes, setLikes] = useState([]);
  const [dislikes, setDislikes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    getMealPreferences()
      .then((data) => {
        setLikes(data.likes);
        setDislikes(data.dislikes);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function persist(nextLikes, nextDislikes) {
    setLikes(nextLikes);
    setDislikes(nextDislikes);
    try {
      await updateMealPreferences({ likes: nextLikes, dislikes: nextDislikes });
    } catch (err) {
      setError(err.message);
    }
  }

  async function refetch() {
    const data = await getMealPreferences();
    setLikes(data.likes);
    setDislikes(data.dislikes);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal meal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Your preferences</h3>
          <button type="button" onClick={onClose} aria-label="Close preferences" className="modal-close">
            ×
          </button>
        </div>
        <p className="widget-empty">The AI takes these into account when it suggests or generates meals.</p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {!loading && (
          <div className="meal-prefs-sections">
            <TagInput
              label="Likes"
              verb="like"
              values={likes}
              variant="accent-2"
              onAdd={(v) => persist([...likes, v], dislikes)}
              onRemove={(v) => persist(likes.filter((x) => x !== v), dislikes)}
            />
            <TagInput
              label="Dislikes"
              verb="dislike"
              values={dislikes}
              variant="outline"
              onAdd={(v) => persist(likes, [...dislikes, v])}
              onRemove={(v) => persist(likes, dislikes.filter((x) => x !== v))}
            />
          </div>
        )}

        <div className="meal-dialog-section">
          <h4>Or tell the AI</h4>
          <AiEditBox
            resourceKey="meal-preferences"
            primaryField="likes"
            onApplied={refetch}
          />
        </div>

        <div className="meal-dialog-actions">
          <button type="button" className="meal-btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
