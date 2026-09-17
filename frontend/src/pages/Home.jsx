import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RESOURCES } from "../resourceConfigs";
import TodayHero from "../components/widgets/TodayHero";
import WeatherWidget from "../components/widgets/WeatherWidget";
import CalendarWidget from "../components/widgets/CalendarWidget";
import MealPlanWidget from "../components/widgets/MealPlanWidget";
import ExamCountdownWidget from "../components/widgets/ExamCountdownWidget";
import PrinterWidget from "../components/widgets/PrinterWidget";

// A fixed launcher for the self-hosted Immich instance. Not part of the
// RESOURCES list: it's an external link, not an internal CRUD page. Styled
// as its own hero tile rather than folded into the plain section-nav grid,
// since it's the one external app pinned to the dashboard.
const IMMICH_LINK = {
  url: "https://immich.wakiquacki.com/photos",
  icon: "🖼️",
  subtitle: "Photos",
};

function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Tick on the minute boundary rather than every second: the display only
    // shows minutes, so a 1s interval is 59 wasted renders out of 60 on a
    // screen that stays on all day.
    let timer;
    function schedule() {
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, 60000 - (Date.now() % 60000));
    }
    schedule();
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="clock">
      <time className="clock-time" dateTime={now.toISOString()}>
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </time>
      <span className="clock-date">
        {now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
      </span>
    </div>
  );
}

export default function Home() {
  return (
    <div className="home">
      <header className="home-header">
        <h1>Life Dashboard</h1>
        <Clock />
      </header>

      <TodayHero />
      <WeatherWidget />

      <div className="dashboard-grid">
        <div className="dashboard-main">
          <CalendarWidget />
          <MealPlanWidget />
        </div>

        <aside className="dashboard-sidebar">
          <a href={IMMICH_LINK.url} target="_blank" rel="noreferrer" aria-label="Immich" className="immich-hero">
            <span className="immich-hero-icon" aria-hidden="true">
              {IMMICH_LINK.icon}
            </span>
            <span className="immich-hero-text">
              <span className="immich-hero-title">Immich</span>
              <span className="immich-hero-subtitle">{IMMICH_LINK.subtitle}</span>
            </span>
          </a>
          <nav className="section-nav section-nav--sidebar">
            {RESOURCES.map((resource) => (
              <Link
                key={resource.key}
                to={`/${resource.key}`}
                className="section-tile"
                style={resource.accent ? { "--accent": resource.accent } : undefined}
              >
                <span className="tile-icon" aria-hidden="true">
                  {resource.icon}
                </span>
                {resource.label}
              </Link>
            ))}
          </nav>
          <ExamCountdownWidget />
          <PrinterWidget />
        </aside>
      </div>
    </div>
  );
}
