import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MealPlanWidget from "./MealPlanWidget";
import * as api from "../../lib/api";
import { startOfWeekMonday, toYMD } from "../../lib/dateUtils";

describe("MealPlanWidget", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("places a meal in its day/slot cell for the current week", async () => {
    const monday = toYMD(startOfWeekMonday(new Date()));
    vi.spyOn(api, "listItems").mockResolvedValue([
      { id: 1, date: monday, meal_slot: "dinner", name: "Tacos", ingredients: [] },
    ]);

    render(
      <MemoryRouter>
        <MealPlanWidget />
      </MemoryRouter>
    );

    expect(await screen.findByText("Tacos")).toBeInTheDocument();
  });
});
