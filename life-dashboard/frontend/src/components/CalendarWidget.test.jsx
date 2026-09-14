import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CalendarWidget from "./CalendarWidget";
import * as api from "../api";
import { toYMD } from "../dateUtils";

function mockListItems({ events = [], feeds = [], workoutSchedule = [] } = {}) {
  vi.spyOn(api, "listItems").mockImplementation((resource) => {
    if (resource === "events") return Promise.resolve(events);
    if (resource === "calendar-feeds") return Promise.resolve(feeds);
    if (resource === "workout-schedule") return Promise.resolve(workoutSchedule);
    return Promise.resolve([]);
  });
}

describe("CalendarWidget", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "getExternalEvents").mockResolvedValue({ events: [] });
  });

  it("clicking a day opens a modal showing that day's event", async () => {
    const todayStr = toYMD(new Date());
    mockListItems({
      events: [
        {
          id: 1,
          source: "self",
          title: "Dentist",
          start: `${todayStr}T09:00:00`,
          end: `${todayStr}T10:00:00`,
          location: null,
          notes: null,
          color: "#4a9eff",
        },
      ],
    });

    render(<CalendarWidget />);

    await userEvent.click(await screen.findByTestId(`calendar-day-${todayStr}`));
    expect(await screen.findByText("Dentist")).toBeInTheDocument();
  });

  it("double-clicking a day opens the add-event form directly", async () => {
    const todayStr = toYMD(new Date());
    mockListItems({});
    const createSpy = vi.spyOn(api, "createItem").mockResolvedValue({});

    render(<CalendarWidget />);

    const dayCell = await screen.findByTestId(`calendar-day-${todayStr}`);
    await userEvent.dblClick(dayCell);

    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Title"), "New Event");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        "events",
        expect.objectContaining({ title: "New Event", start: `${todayStr}T09:00` })
      )
    );
  });

  it("deletes an event from its edit form", async () => {
    const todayStr = toYMD(new Date());
    const event = {
      id: 1,
      source: "self",
      title: "Cancel me",
      start: `${todayStr}T09:00:00`,
      end: `${todayStr}T10:00:00`,
      location: null,
      notes: null,
      color: "#4a9eff",
    };
    mockListItems({ events: [event] });
    const deleteSpy = vi.spyOn(api, "deleteItem").mockResolvedValue(null);

    render(<CalendarWidget />);

    await userEvent.click(await screen.findByTestId(`calendar-day-${todayStr}`));
    await userEvent.click(await screen.findByText("Cancel me"));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith("events", 1));
  });

  it("adds a calendar subscription via the manage-calendars modal", async () => {
    mockListItems({});
    const createSpy = vi.spyOn(api, "createItem").mockResolvedValue({});

    render(<CalendarWidget />);

    await userEvent.click(screen.getByTitle("Subscribe to a calendar"));
    await userEvent.click(screen.getByRole("button", { name: "+ Subscribe to a calendar" }));
    await userEvent.type(screen.getByLabelText("Name"), "Girlfriend");
    await userEvent.type(screen.getByLabelText("Calendar link (iCal/ICS URL)"), "https://example.com/gf.ics");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        "calendar-feeds",
        expect.objectContaining({ name: "Girlfriend", url: "https://example.com/gf.ics" })
      )
    );
  });

  it("shows a scheduled workout on every matching weekday of the current month", async () => {
    const today = new Date();
    const todayStr = toYMD(today);
    const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const todayDayKey = dayKeys[today.getDay()];
    mockListItems({
      workoutSchedule: [{ id: 1, day_of_week: todayDayKey, time: "07:00:00", label: "Strength Training" }],
    });

    render(<CalendarWidget />);

    await userEvent.click(await screen.findByTestId(`calendar-day-${todayStr}`));
    expect(await screen.findByText(/Strength Training/)).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
  });

  it("shows a per-feed error when a subscription fails to load", async () => {
    mockListItems({ feeds: [{ id: 1, name: "Broken Feed", url: "https://example.com/bad.ics", color: "#feca57" }] });
    api.getExternalEvents.mockResolvedValue({
      events: [],
      errors: [{ feed_id: 1, feed_name: "Broken Feed", detail: "404 Not Found" }],
    });

    render(<CalendarWidget />);

    await userEvent.click(screen.getByTitle("Subscribe to a calendar"));
    expect(await screen.findByText(/Couldn't load this calendar: 404 Not Found/)).toBeInTheDocument();
  });
});
