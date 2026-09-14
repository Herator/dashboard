// MET Norway (yr.no) symbol codes, e.g. "partlycloudy_day", "lightrainshowers_night".
// https://api.met.no/weatherapi/weathericon/2.0/legends
// Suffix (_day/_night/_polartwilight) only affects sun-vs-moon art we don't
// draw, so it's stripped before lookup — leaves ~30 base symbols instead of
// the 90+ suffixed combinations.
const BASE_LABELS = {
  clearsky: "Clear sky",
  fair: "Fair",
  partlycloudy: "Partly cloudy",
  cloudy: "Cloudy",
  fog: "Fog",
  rainshowers: "Rain showers",
  rainshowersandthunder: "Rain showers and thunder",
  lightrainshowers: "Light rain showers",
  lightrainshowersandthunder: "Light rain showers and thunder",
  heavyrainshowers: "Heavy rain showers",
  heavyrainshowersandthunder: "Heavy rain showers and thunder",
  sleetshowers: "Sleet showers",
  sleetshowersandthunder: "Sleet showers and thunder",
  lightsleetshowers: "Light sleet showers",
  heavysleetshowers: "Heavy sleet showers",
  snowshowers: "Snow showers",
  snowshowersandthunder: "Snow showers and thunder",
  lightsnowshowers: "Light snow showers",
  heavysnowshowers: "Heavy snow showers",
  rain: "Rain",
  rainandthunder: "Rain and thunder",
  lightrain: "Light rain",
  lightrainandthunder: "Light rain and thunder",
  heavyrain: "Heavy rain",
  heavyrainandthunder: "Heavy rain and thunder",
  sleet: "Sleet",
  sleetandthunder: "Sleet and thunder",
  lightsleet: "Light sleet",
  lightsleetandthunder: "Light sleet and thunder",
  heavysleet: "Heavy sleet",
  heavysleetandthunder: "Heavy sleet and thunder",
  snow: "Snow",
  snowandthunder: "Snow and thunder",
  lightsnow: "Light snow",
  lightsnowandthunder: "Light snow and thunder",
  heavysnow: "Heavy snow",
  heavysnowandthunder: "Heavy snow and thunder",
};

const PRECIPITATION_KEYWORDS = ["rain", "sleet", "snow", "thunder"];

export function describeWeatherCode(code) {
  if (!code) return { shape: "cloud", label: "Unknown" };
  const base = code.replace(/_(day|night|polartwilight)$/, "");
  const label = BASE_LABELS[base] || "Unknown";

  let shape = "cloud";
  if (PRECIPITATION_KEYWORDS.some((k) => base.includes(k))) shape = "rain";
  else if (base === "clearsky") shape = "sun";
  else if (base === "fair" || base === "partlycloudy") shape = "cloud-light";

  return { shape, label };
}
