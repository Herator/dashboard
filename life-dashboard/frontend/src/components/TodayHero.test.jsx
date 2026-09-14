import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import TodayHero from "./TodayHero";
import * as api from "../api";
import { toYMD } from "../dateUtils";

describe("TodayHero", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows today's weather, the next agenda item, and today's meals", async () => {
    const todayStr = toYMD(new Date());
    vi.spyOn(api, "getWeather").mockResolvedValue({
      days: [{ date: todayStr, code: "clearsky_day", temp_max: 18, temp_min: 9, precipitation_chance: 2 }],
    });
    vi.spyOn(api, "getExternalEvents").mockResolvedValue({ events: [] });
    vi.spyOn(api, "listItems").mockImplementation((resource) => {
      if (resource === "events") {
        return Promise.resolve([
          {
            id: 1,
            source: "school",
            title: "Chem quiz",
            start: `${todayStr}T23:59:00`,
            end: `${todayStr}T23:59:00`,
          },
        ]);
      }
      if (resource === "meal-plan") {
        return Promise.resolve([{ id: 1, date: todayStr, meal_slot: "dinner", name: "Salmon, rice" }]);
      }
      return Promise.resolve([]);
    });

    render(<TodayHero />);

    expect(await screen.findByText("18°")).toBeInTheDocument();
    expect(screen.getByText("2% rain")).toBeInTheDocument();
    expect(screen.getByText("Chem quiz")).toBeInTheDocument();
    expect(screen.getByText(/Salmon, rice/)).toBeInTheDocument();
  });
});
