import { useEffect, useState } from "react";
import { getWeather } from "../../lib/api";
import { describeWeatherCode } from "../../lib/weatherCodes";
import WeatherIcon from "./WeatherIcon";

const WEEKDAY_FORMAT = { weekday: "short" };

export default function WeatherWidget() {
  const [days, setDays] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getWeather()
      .then((data) => {
        if (!cancelled) setDays(data.days);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="widget weather-widget">
      <h2>This Week's Weather</h2>
      {error && (
        <p className="error" role="alert">
          Weather unavailable: {error}
        </p>
      )}
      {!error && !days && <p className="widget-loading">Loading forecast…</p>}
      {days && (
        <div className="weather-days">
          {days.map((day, i) => {
            const { shape, label } = describeWeatherCode(day.code);
            const date = new Date(`${day.date}T00:00:00`);
            return (
              <div className="weather-day" key={day.date}>
                <span className="weather-day-label">
                  {i === 0 ? "Today" : date.toLocaleDateString([], WEEKDAY_FORMAT)}
                </span>
                <WeatherIcon shape={shape} label={label} />
                <span className="weather-day-temps">
                  <strong>{Math.round(day.temp_max)}°</strong>{" "}
                  <span className="weather-day-low">{Math.round(day.temp_min)}°</span>
                </span>
                <span className="weather-day-precip">{day.precipitation_chance}%</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
