import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MealPlanPage from "./MealPlanPage";
import * as api from "../lib/api";
import { startOfWeekMonday, toYMD } from "../lib/dateUtils";

const MONDAY = toYMD(startOfWeekMonday(new Date()));

describe("MealPlanPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getMealPreferences").mockResolvedValue({ id: 1, likes: [], dislikes: [] });
  });

  it("renders an empty add-slot button for each day when there's no plan yet", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([]);

    render(<MealPlanPage />);

    expect(await screen.findByRole("heading", { name: "Meal Plan" })).toBeInTheDocument();
    expect(screen.getAllByText("+ Add Breakfast")).toHaveLength(7);
  });

  it("opens the recipe dialog for a filled meal slot and shows AI-generated steps", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([
      { id: 1, date: MONDAY, meal_slot: "dinner", name: "Tacos", ingredients: ["beef", "salsa"] },
    ]);
    vi.spyOn(api, "getMealRecipeSteps").mockResolvedValue({ steps: ["Cook beef.", "Assemble tacos."] });

    render(<MealPlanPage />);

    await userEvent.click(await screen.findByText("Tacos"));

    expect(await screen.findByRole("heading", { name: "Tacos" })).toBeInTheDocument();
    expect(await screen.findByText("Cook beef.")).toBeInTheDocument();
    expect(api.getMealRecipeSteps).toHaveBeenCalledWith(1);
  });

  it("edits a meal via the pencil icon without opening the recipe dialog", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([
      { id: 1, date: MONDAY, meal_slot: "dinner", name: "Tacos", ingredients: ["beef"] },
    ]);
    const updateSpy = vi.spyOn(api, "updateItem").mockResolvedValue({});

    render(<MealPlanPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit meal" }));

    const nameInput = await screen.findByLabelText("Name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Burritos");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        "meal-plan",
        1,
        expect.objectContaining({ name: "Burritos", meal_slot: "dinner", date: MONDAY })
      )
    );
    // The recipe dialog never opened.
    expect(screen.queryByRole("heading", { name: "Tacos" })).not.toBeInTheDocument();
  });

  it("deletes a meal via the trash icon", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([
      { id: 1, date: MONDAY, meal_slot: "dinner", name: "Tacos", ingredients: [] },
    ]);
    const deleteSpy = vi.spyOn(api, "deleteItem").mockResolvedValue(null);

    render(<MealPlanPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Delete meal" }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith("meal-plan", 1));
  });

  it("adds a like in the preferences dialog", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    const updatePrefsSpy = vi.spyOn(api, "updateMealPreferences").mockResolvedValue({});

    render(<MealPlanPage />);

    await userEvent.click(await screen.findByRole("button", { name: /Edit likes/ }));
    const input = await screen.findByPlaceholderText("Add something you like");
    await userEvent.type(input, "Salmon");
    await userEvent.click(screen.getByRole("button", { name: "Add likes" }));

    await waitFor(() =>
      expect(updatePrefsSpy).toHaveBeenCalledWith({ likes: ["Salmon"], dislikes: [] })
    );
  });
});
