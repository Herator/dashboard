import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkoutLog from "./WorkoutLog";
import * as api from "../api";

const WORKOUT_WITH_EXERCISES = {
  id: 1,
  date: "2026-09-21",
  plan_text: "Push Day",
  notes: null,
  exercises: [
    { name: "Bench Press", sets: 3, reps: "8", completed: [false, false, false] },
    { name: "Overhead Press", sets: 2, reps: "10", completed: [false, false] },
  ],
};

describe("WorkoutLog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows exercises in order with one checkbox per set", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([WORKOUT_WITH_EXERCISES]);

    render(<WorkoutLog />);

    expect(await screen.findByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("Overhead Press")).toBeInTheDocument();

    // Exercises render in the order given, not resorted alphabetically.
    const names = screen.getAllByText(/Press$/).map((el) => el.textContent);
    expect(names).toEqual(["Bench Press", "Overhead Press"]);

    expect(screen.getByLabelText("Bench Press set 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Bench Press set 3")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bench Press set 4")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Overhead Press set 2")).toBeInTheDocument();

    expect(screen.getByText("0/5 sets")).toBeInTheDocument();
  });

  it("checking off a set persists the update and shows progress", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([WORKOUT_WITH_EXERCISES]);
    const updateSpy = vi.spyOn(api, "updateItem").mockResolvedValue({});

    render(<WorkoutLog />);

    const checkbox = await screen.findByLabelText("Bench Press set 1");
    await userEvent.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(await screen.findByText("1/5 sets")).toBeInTheDocument();

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        "workouts",
        1,
        expect.objectContaining({
          exercises: [
            { name: "Bench Press", sets: 3, reps: "8", completed: [true, false, false] },
            { name: "Overhead Press", sets: 2, reps: "10", completed: [false, false] },
          ],
        })
      )
    );
  });

  it("reverts the checkbox if the update fails", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([WORKOUT_WITH_EXERCISES]);
    vi.spyOn(api, "updateItem").mockRejectedValue(new Error("network error"));

    render(<WorkoutLog />);

    const checkbox = await screen.findByLabelText("Bench Press set 1");
    await userEvent.click(checkbox);

    expect(await screen.findByRole("alert")).toHaveTextContent("network error");
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });

  it("shows notes instead of a checklist for a workout with no structured exercises", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([
      { id: 2, date: "2026-09-22", plan_text: "Rest Day", notes: "Just stretching", exercises: [] },
    ]);

    render(<WorkoutLog />);

    expect(await screen.findByText("Just stretching")).toBeInTheDocument();
  });
});
