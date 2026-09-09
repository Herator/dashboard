import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listItems, createItem, deleteItem } from "../api";
import { RESOURCES } from "../resourceConfigs";

export default function Home() {
  const [links, setLinks] = useState([]);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState(null);

  async function refresh() {
    try {
      const data = await listItems("quick-links");
      setLinks(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAddLink(e) {
    e.preventDefault();
    setError(null);
    try {
      await createItem("quick-links", { label, url });
      setLabel("");
      setUrl("");
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteLink(id) {
    setError(null);
    try {
      await deleteItem("quick-links", id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="home">
      <h1>Life Dashboard</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section>
        <h2>Quick Links</h2>
        <div className="quick-links">
          {links.map((link) => (
            <div key={link.id} className="quick-link-tile">
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
              <button onClick={() => handleDeleteLink(link.id)}>Remove</button>
            </div>
          ))}
        </div>
        <form onSubmit={handleAddLink} className="quick-link-form">
          <input placeholder="Label (e.g. Immich)" value={label} required onChange={(e) => setLabel(e.target.value)} />
          <input placeholder="URL" type="url" value={url} required onChange={(e) => setUrl(e.target.value)} />
          <button type="submit">Add Link</button>
        </form>
      </section>

      <section>
        <h2>Sections</h2>
        <nav className="section-nav">
          {RESOURCES.map((resource) => (
            <Link key={resource.key} to={`/${resource.key}`} className="section-tile">
              {resource.label}
            </Link>
          ))}
        </nav>
      </section>
    </div>
  );
}
