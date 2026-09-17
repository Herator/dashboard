import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkoutsPage from "./WorkoutsPage";
import * as api from "../lib/api";

describe("WorkoutsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the sidebar nav and the weekly day cards on the Home tab", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([]);

    render(<WorkoutsPage />);

    expect(screen.getByText("Workouts")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Weekly Training Schedule" })).toBeInTheDocument();
    // Seven day cards, one per weekday, each an empty "+ Add" slot.
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(await screen.findByText(day)).toBeInTheDocument();
    }
    expect(screen.getAllByText("+ Add")).toHaveLength(7);
  });

  it("switches to the Log tab and shows the workout log", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([]);

    render(<WorkoutsPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Log" }));

    expect(screen.getByRole("heading", { name: "Workout log" })).toBeInTheDocument();
    // The Workout Log's manual add form also renders.
    expect(screen.getByLabelText("Plan")).toBeInTheDocument();
  });

  it("creates the recommended Push/Pull/Legs schedule when clicked", async () => {
    const recommended = [
      { id: 1, day_of_week: "mon", time: "07:00:00", label: "Push Day", notes: null },
      { id: 2, day_of_week: "wed", time: "07:00:00", label: "Pull Day", notes: null },
      { id: 3, day_of_week: "fri", time: "07:00:00", label: "Leg Day", notes: null },
    ];
    vi.spyOn(api, "listItems").mockImplementation((resource) => {
      if (resource !== "workout-schedule") return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const createSpy = vi.spyOn(api, "createItem").mockResolvedValue({});

    render(<WorkoutsPage />);

    const button = await screen.findByRole("button", { name: "Use recommended (Push/Pull/Legs)" });
    // Once clicked, the follow-up refresh should see the newly created rows.
    api.listItems.mockImplementation((resource) =>
      resource === "workout-schedule" ? Promise.resolve(recommended) : Promise.resolve([])
    );
    await userEvent.click(button);

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(3));
    const calls = createSpy.mock.calls.map(([resource, payload]) => [resource, payload.day_of_week, payload.label]);
    expect(calls).toEqual([
      ["workout-schedule", "mon", "Push Day"],
      ["workout-schedule", "wed", "Pull Day"],
      ["workout-schedule", "fri", "Leg Day"],
    ]);

    // Once the schedule isn't empty, the recommended shortcut goes away.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Use recommended (Push/Pull/Legs)" })).not.toBeInTheDocument()
    );
    expect(await screen.findByText("Push Day")).toBeInTheDocument();
    // All three recommended slots share the same 07:00 time — no seconds shown.
    expect(screen.getAllByText("07:00")).toHaveLength(3);
  });

  it("opens the day editor and saves a custom plan without seconds in the time", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    const createSpy = vi.spyOn(api, "createItem").mockResolvedValue({});

    render(<WorkoutsPage />);

    const dayCards = await screen.findAllByText("+ Add");
    await userEvent.click(dayCards[1]); // Tuesday

    const modal = screen.getByRole("heading", { name: "Tue training" }).closest(".modal");
    await userEvent.selectOptions(within(modal).getByLabelText("Workout Plan"), "Cardio");
    const timeInput = within(modal).getByLabelText("Time");
    await userEvent.clear(timeInput);
    await userEvent.type(timeInput, "06:30");
    await userEvent.click(within(modal).getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        "workout-schedule",
        expect.objectContaining({ day_of_week: "tue", label: "Cardio", time: "06:30:00" })
      )
    );
  });
});
