import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import WeatherWidget from "./WeatherWidget";
import * as api from "../api";

describe("WeatherWidget", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a temperature for each forecast day", async () => {
    vi.spyOn(api, "getWeather").mockResolvedValue({
      days: [
        { date: "2026-09-13", code: "clearsky_day", temp_max: 20, temp_min: 10, precipitation_chance: 0 },
        { date: "2026-09-14", code: "rain", temp_max: 15, temp_min: 8, precipitation_chance: 70 },
      ],
    });

    render(<WeatherWidget />);

    expect(await screen.findByText("Today")).toBeInTheDocument();
    expect(screen.getByText("20°")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
  });

  it("shows an error message when the forecast fails to load", async () => {
    vi.spyOn(api, "getWeather").mockRejectedValue(new Error("Request failed: 502"));

    render(<WeatherWidget />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed: 502");
  });
});
