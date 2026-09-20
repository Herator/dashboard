import { useEffect, useMemo, useState } from "react";
import { listItems, createItem, updateItem, deleteItem, syncGroceriesFromMealPlan } from "../lib/api";
import { startOfWeekMonday, toYMD } from "../lib/dateUtils";

const CATEGORIES = ["Grønt", "Meieri", "Kjøtt", "Bakevarer", "Tørrvarer", "Frossent", "Annet"];

const LIQUID_WORDS = ["melk", "juice", "buljong", "olje", "saus", "vann", "fløte", "yoghurt", "vin", "eddik"];
function isLiquid(name) {
  const n = name.toLowerCase();
  return LIQUID_WORDS.some((w) => n.includes(w));
}

const KEYWORD_MAP = [
  [["spinat", "tomat", "salat", "løk", "hvitløk", "paprika", "gulrot", "potet", "eple", "banan", "agurk"], "Grønt"],
  [["melk", "ost", "yoghurt", "smør", "egg", "fløte"], "Meieri"],
  [["kylling", "biff", "svin", "kalkun", "bacon", "pølse", "laks", "reker"], "Kjøtt"],
  [["brød", "bagel", "lompe"], "Bakevarer"],
  [["ris", "pasta", "bønner", "mel", "sukker", "olje", "saus", "frokostblanding", "havregryn", "buljong"], "Tørrvarer"],
  [["frossen", "frossent", "is", "pizza"], "Frossent"],
];

export function categorize(name) {
  const n = name.toLowerCase();
  for (const [words, cat] of KEYWORD_MAP) {
    if (words.some((w) => n.includes(w))) return cat;
  }
  return "Annet";
}

// Norwegian "42,90" or plain "42.90" — either way, the leading numeric run.
function parsePrice(price) {
  if (!price) return 0;
  const match = price.replace(",", ".").match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
}

export default function GroceryPage() {
  const weekOf = toYMD(startOfWeekMonday(new Date()));
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("Alle");
  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newCategory, setNewCategory] = useState(CATEGORIES[0]);
  const [syncMessage, setSyncMessage] = useState(null);
  const [syncing, setSyncing] = useState(false);

  async function refresh() {
    try {
      const all = await listItems("groceries");
      setItems(all.filter((it) => it.week_of === weekOf));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      await createItem("groceries", {
        name,
        quantity: newQty.trim() || null,
        category: newCategory || categorize(name),
        checked: false,
        week_of: weekOf,
      });
      setNewName("");
      setNewQty("");
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggle(item) {
    try {
      const updated = await updateItem("groceries", item.id, { checked: !item.checked });
      setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)));
    } catch (err) {
      setError(err.message);
    }
  }

  // Local input stays snappy on every keystroke; the PUT only fires once the
  // field loses focus, so logging a price doesn't spam the API per digit.
  function handleFieldChange(id, field, value) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  }

  async function handleFieldCommit(item, field) {
    try {
      const updated = await updateItem("groceries", item.id, { [field]: item[field] });
      setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(item) {
    try {
      await deleteItem("groceries", item.id);
      setItems((prev) => prev.filter((it) => it.id !== item.id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await syncGroceriesFromMealPlan(weekOf);
      setSyncMessage(`La til ${res.added.length} vare(r) fra ukens måltidsplan.`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (activeCategory !== "Alle" && (it.category || "Annet") !== activeCategory) return false;
      if (q && !it.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, activeCategory]);

  const groups = useMemo(() => {
    const byCategory = new Map(CATEGORIES.map((c) => [c, []]));
    for (const it of filtered) {
      const cat = it.category || "Annet";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(it);
    }
    return [...byCategory.entries()].filter(([, list]) => list.length > 0);
  }, [filtered]);

  const totalCount = items.length;
  const checkedCount = items.filter((it) => it.checked).length;
  const totalPrice = items.reduce((sum, it) => sum + parsePrice(it.price), 0);

  return (
    <div className="grocery-page">
      <header className="grocery-header">
        <span className="grocery-badge" aria-hidden="true">
          🛒
        </span>
        <div>
          <h1>Innkjøpsliste</h1>
          <p className="grocery-subtitle">Handle, kryss av, og logg pris og vekt underveis.</p>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="grocery-toolbar">
        <input
          type="text"
          placeholder="Søk etter varer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="grocery-search"
        />
        <button type="button" onClick={handleSync} disabled={syncing}>
          ⟳ Synk fra måltidsplan
        </button>
      </div>

      {syncMessage && <div className="grocery-sync-tag">{syncMessage}</div>}

      <div className="grocery-chips">
        {["Alle", ...CATEGORIES].map((cat) => (
          <button
            key={cat}
            type="button"
            className={`grocery-chip${cat === activeCategory ? " grocery-chip--active" : ""}`}
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      <form className="grocery-add-form" onSubmit={handleAdd}>
        <input
          type="text"
          placeholder="Legg til en vare…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="grocery-add-name"
        />
        <input
          type="text"
          placeholder="Antall"
          value={newQty}
          onChange={(e) => setNewQty(e.target.value)}
          className="grocery-add-qty"
        />
        <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="grocery-add-category">
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        <button type="submit">+ Legg til</button>
      </form>

      <div className="grocery-groups">
        {groups.map(([cat, list]) => (
          <div key={cat}>
            <div className="grocery-group-header">
              <h3>{cat}</h3>
              <span>{list.length} vare(r)</span>
            </div>
            <div className="grocery-group-items">
              {list.map((item) => (
                <div key={item.id} className={`grocery-item${item.checked ? " grocery-item--checked" : ""}`}>
                  <button
                    type="button"
                    aria-label="Merk som kjøpt"
                    className={`grocery-check${item.checked ? " grocery-check--on" : ""}`}
                    onClick={() => handleToggle(item)}
                  >
                    {item.checked && "✓"}
                  </button>
                  <div className="grocery-item-name">
                    <div className={item.checked ? "grocery-item-name-text grocery-item-name-text--checked" : "grocery-item-name-text"}>
                      {item.name}
                    </div>
                    {item.quantity && <div className="grocery-item-qty">{item.quantity}</div>}
                  </div>
                  <label className="grocery-field">
                    Pris (NOK)
                    <input
                      type="text"
                      placeholder="0,00 kr"
                      value={item.price || ""}
                      onChange={(e) => handleFieldChange(item.id, "price", e.target.value)}
                      onBlur={() => handleFieldCommit(item, "price")}
                    />
                  </label>
                  <label className="grocery-field">
                    {isLiquid(item.name) ? "Volum" : "Vekt"}
                    <input
                      type="text"
                      placeholder={isLiquid(item.name) ? "0 L" : "0 kg"}
                      value={item.weight || ""}
                      onChange={(e) => handleFieldChange(item.id, "weight", e.target.value)}
                      onBlur={() => handleFieldCommit(item, "weight")}
                    />
                  </label>
                  <button type="button" aria-label="Slett vare" className="grocery-delete" onClick={() => handleDelete(item)}>
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && <p className="grocery-empty">Ingen varer samsvarer med søket.</p>}

      <div className="grocery-summary">
        <div>
          <div className="grocery-summary-label">Varer</div>
          <div className="grocery-summary-value">{totalCount}</div>
        </div>
        <div>
          <div className="grocery-summary-label">Kjøpt så langt</div>
          <div className="grocery-summary-value">
            {checkedCount} / {totalCount}
          </div>
        </div>
        <div>
          <div className="grocery-summary-label">Totalt brukt</div>
          <div className="grocery-summary-value grocery-summary-value--accent">{totalPrice.toFixed(0)} kr</div>
        </div>
      </div>
    </div>
  );
}
