import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ExamCountdownWidget from "./ExamCountdownWidget";
import * as api from "../api";
import { addDays, toYMD } from "../dateUtils";

describe("ExamCountdownWidget", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the days-away count for the nearest upcoming exam", async () => {
    const examDate = toYMD(addDays(new Date(), 6));
    vi.spyOn(api, "listItems").mockResolvedValue([{ id: 1, subject: "Chemistry final", date: examDate }]);

    render(<ExamCountdownWidget />);

    expect(await screen.findByText("6")).toBeInTheDocument();
    expect(screen.getByText(/Chemistry final/)).toBeInTheDocument();
  });

  it("shows an empty state when no exams are scheduled", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([]);

    render(<ExamCountdownWidget />);

    expect(await screen.findByText("No exams scheduled.")).toBeInTheDocument();
  });
});
