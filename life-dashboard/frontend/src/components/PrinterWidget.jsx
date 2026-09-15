import { useEffect, useState } from "react";
import { getPrinterStatus, getPrinterCameraUrl, listItems } from "../api";

// A wall-mounted dashboard tile that never closes doesn't need sub-second
// freshness; this just needs to notice a print finishing within a minute or
// so, and the backend caches the printer round-trip anyway.
const POLL_MS = 20000;

// Same normalization the backend's auto-add sync uses, so a spool that's
// currently loaded matches its inventory row regardless of case/whitespace.
function filamentKey(material, colorHex) {
  return `${material.trim().toLowerCase()}|${(colorHex || "").toLowerCase()}`;
}

function formatRemaining(min) {
  const hours = Math.floor(min / 60);
  const mins = min % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export default function PrinterWidget() {
  const [status, setStatus] = useState(null);
  const [spools, setSpools] = useState(null);
  const [error, setError] = useState(null);
  // Off by default: the camera is a persistent streamed connection to the
  // printer for as long as it's mounted, unlike everything else in this
  // widget which just polls occasionally. Only pay for it while watching.
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Re-fetches the inventory alongside every status poll, not just once on
    // mount: the backend auto-adds a spool to inventory the moment it sees
    // new AMS filament, and this is how that shows up without a page reload.
    function poll() {
      getPrinterStatus()
        .then((data) => {
          if (!cancelled) setStatus(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message);
        });
      listItems("filament")
        .then((data) => {
          if (!cancelled) setSpools(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message);
        });
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const loadedKeys = new Set(
    status?.online ? status.ams.map((tray) => filamentKey(tray.material, tray.color_hex)) : []
  );
  const offHandSpools = (spools || []).filter(
    (spool) => !loadedKeys.has(filamentKey(spool.material, spool.color_hex))
  );

  return (
    <section className="widget printer-widget">
      <div className="today-hero-label">3D Printer</div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!error && !status && <p className="widget-loading">Loading…</p>}
      {status && !status.online && <p className="widget-empty">Printer offline.</p>}
      {status?.online && (
        <div className="printer-status">
          <div className="printer-state">
            {status.state === "RUNNING" ? status.job_name || "Printing" : status.state}
          </div>
          {status.progress_pct != null && (
            <>
              <div className="printer-progress-track">
                <div className="printer-progress-fill" style={{ width: `${status.progress_pct}%` }} />
              </div>
              <div className="printer-progress-label">
                {status.progress_pct}%
                {status.remaining_min != null && ` · ${formatRemaining(status.remaining_min)} left`}
              </div>
            </>
          )}
          {status.ams.length > 0 && (
            <div className="printer-chip-row">
              {status.ams.map((tray, i) => (
                <span key={i} className="printer-chip" style={{ "--accent": tray.color_hex || "#888" }}>
                  <span className="calendar-dot" style={{ "--accent": tray.color_hex || "#888" }} />
                  {tray.material} {tray.color_name}
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            className="printer-camera-toggle"
            onClick={() => {
              setCameraError(false);
              setShowCamera((v) => !v);
            }}
          >
            {showCamera ? "Hide camera" : "Show camera"}
          </button>
          {showCamera && (
            <div className="printer-camera">
              {cameraError && <p className="widget-empty">Camera unavailable.</p>}
              {!cameraError && (
                <img
                  src={getPrinterCameraUrl()}
                  alt="Printer camera feed"
                  className="printer-camera-feed"
                  onError={() => setCameraError(true)}
                />
              )}
            </div>
          )}
        </div>
      )}

      <div className="today-hero-label printer-inventory-label">Filament on hand</div>
      {spools === null && !error && <p className="widget-loading">Loading…</p>}
      {spools && spools.length === 0 && <p className="widget-empty">No filament tracked yet.</p>}
      {spools && spools.length > 0 && offHandSpools.length === 0 && (
        <p className="widget-empty">Everything on hand is currently loaded.</p>
      )}
      {offHandSpools.length > 0 && (
        <div className="printer-chip-row">
          {offHandSpools.map((spool) => (
            <span key={spool.id} className="printer-chip">
              <span className="calendar-dot" style={{ "--accent": spool.color_hex }} />
              {spool.material} {spool.color_name}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
