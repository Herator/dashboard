import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Home from "./Home";
import * as api from "../lib/api";

describe("Home", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getWeather").mockResolvedValue({ days: [] });
    vi.spyOn(api, "getExternalEvents").mockResolvedValue({ events: [] });
    vi.spyOn(api, "listItems").mockResolvedValue([]);
  });

  it("renders a nav link for the remaining resources only", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(await screen.findByRole("link", { name: "Meal Plan" })).toHaveAttribute("href", "/meal-plan");
    expect(screen.getByRole("link", { name: "Groceries" })).toHaveAttribute("href", "/groceries");
    expect(screen.getByRole("link", { name: "Workouts" })).toHaveAttribute("href", "/workouts");

    expect(screen.queryByRole("link", { name: "Calendar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Assignments" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Exams" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reminders" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Packages" })).not.toBeInTheDocument();
  });

  it("renders the Immich launcher pointing at the configured instance", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(await screen.findByRole("link", { name: "Immich" })).toHaveAttribute(
      "href",
      "https://immich.wakiquacki.com/photos"
    );
  });

  it("renders the weather, calendar and meal-plan widgets", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(await screen.findByText("This Week's Weather")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Calendar" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Meal Plan" })).toBeInTheDocument();
  });
});
