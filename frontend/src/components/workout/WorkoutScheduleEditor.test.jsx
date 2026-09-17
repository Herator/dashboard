import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkoutScheduleEditor from "./WorkoutScheduleEditor";
import * as api from "../../lib/api";
import { toYMD } from "../../lib/dateUtils";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const today = new Date();
const todayKey = DAY_KEYS[today.getDay()];
const todayYMD = toYMD(today);
const todayLabel = today.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

describe("WorkoutScheduleEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("pre-fills the AI generate box with the plan and the day's next date", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([
      { id: 1, day_of_week: todayKey, time: "07:00:00", label: "Push Day", notes: null },
    ]);

    render(<WorkoutScheduleEditor />);

    await userEvent.click(await screen.findByText("Push Day"));

    expect(screen.getByRole("heading", { name: "Generate this workout" })).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/Tell the AI what to change/);
    expect(input).toHaveValue(`Give me a Push Day workout for ${todayLabel}`);
  });

  it("does not show the generate box for a Rest Day", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([
      { id: 1, day_of_week: todayKey, time: "07:00:00", label: "Rest Day", notes: null },
    ]);

    render(<WorkoutScheduleEditor />);

    await userEvent.click(await screen.findByText("Rest Day"));

    expect(screen.queryByRole("heading", { name: "Generate this workout" })).not.toBeInTheDocument();
  });

  it("scopes the AI suggestion to the target date when Suggest is clicked", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([
      { id: 1, day_of_week: todayKey, time: "07:00:00", label: "Push Day", notes: null },
    ]);
    const previewSpy = vi.spyOn(api, "previewAiEdit").mockResolvedValue({
      created: [],
      updated: [],
      deleted: [],
      items: [],
    });

    render(<WorkoutScheduleEditor />);

    await userEvent.click(await screen.findByText("Push Day"));
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));

    await waitFor(() =>
      expect(previewSpy).toHaveBeenCalledWith(
        "workouts",
        expect.objectContaining({ date_from: todayYMD, date_to: todayYMD })
      )
    );
  });
});
