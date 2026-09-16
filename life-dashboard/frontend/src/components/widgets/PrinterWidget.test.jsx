import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PrinterWidget from "./PrinterWidget";
import * as api from "../../lib/api";

describe("PrinterWidget", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows printer offline when the backend reports no connection", async () => {
    vi.spyOn(api, "getPrinterStatus").mockResolvedValue({ online: false });
    vi.spyOn(api, "listItems").mockResolvedValue([]);

    render(<PrinterWidget />);

    expect(await screen.findByText("Printer offline.")).toBeInTheDocument();
  });

  it("renders progress and AMS trays with color names when printing", async () => {
    vi.spyOn(api, "getPrinterStatus").mockResolvedValue({
      online: true,
      state: "RUNNING",
      progress_pct: 42,
      remaining_min: 37,
      job_name: "benchy",
      ams: [{ material: "PLA", color_hex: "#FF0000", color_name: "Red" }],
    });
    vi.spyOn(api, "listItems").mockResolvedValue([
      { id: 1, material: "PETG", color_name: "Black", color_hex: "#000000" },
    ]);

    render(<PrinterWidget />);

    expect(await screen.findByText("benchy")).toBeInTheDocument();
    expect(screen.getByText("42% · 37m left")).toBeInTheDocument();
    expect(screen.getByText("PLA Red")).toBeInTheDocument();
    expect(screen.getByText("PETG Black")).toBeInTheDocument();
  });

  it("hides an on-hand spool from inventory while it's loaded in the printer", async () => {
    vi.spyOn(api, "getPrinterStatus").mockResolvedValue({
      online: true,
      state: "RUNNING",
      progress_pct: 10,
      remaining_min: 90,
      job_name: "vase",
      ams: [{ material: "PLA", color_hex: "#FF0000", color_name: "Red" }],
    });
    vi.spyOn(api, "listItems").mockResolvedValue([
      { id: 1, material: "PLA", color_name: "Red", color_hex: "#FF0000" }, // loaded, should be hidden
      { id: 2, material: "PETG", color_name: "Black", color_hex: "#000000" }, // not loaded
    ]);

    render(<PrinterWidget />);

    expect(await screen.findByText("PETG Black")).toBeInTheDocument();
    // Two "PLA Red" texts would appear (AMS chip + inventory chip) if not filtered.
    expect(screen.getAllByText("PLA Red")).toHaveLength(1);
  });

  it("only mounts the camera feed after Show camera is clicked", async () => {
    vi.spyOn(api, "getPrinterStatus").mockResolvedValue({
      online: true,
      state: "IDLE",
      progress_pct: null,
      remaining_min: null,
      job_name: null,
      ams: [],
    });
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    vi.spyOn(api, "getPrinterCameraUrl").mockReturnValue("http://localhost:8080/api/printer/camera");

    render(<PrinterWidget />);
    const toggle = await screen.findByRole("button", { name: "Show camera" });
    expect(screen.queryByAltText("Printer camera feed")).not.toBeInTheDocument();

    await userEvent.click(toggle);

    expect(screen.getByAltText("Printer camera feed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide camera" })).toBeInTheDocument();
  });
});
