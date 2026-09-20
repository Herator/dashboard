import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GroceryPage, { categorize } from "./GroceryPage";
import * as api from "../lib/api";
import { startOfWeekMonday, toYMD } from "../lib/dateUtils";

const MONDAY = toYMD(startOfWeekMonday(new Date()));

describe("categorize", () => {
  it("matches known keywords and falls back to Annet", () => {
    expect(categorize("Kyllingfilet")).toBe("Kjøtt");
    expect(categorize("Melk")).toBe("Meieri");
    expect(categorize("Widget")).toBe("Annet");
  });
});

describe("GroceryPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows only the current week's items, grouped by category, and sums checked prices", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([
      { id: 1, name: "Melk", category: "Meieri", checked: false, price: "24,90", weight: "", week_of: MONDAY },
      { id: 2, name: "Ris", category: "Tørrvarer", checked: true, price: "30.00", weight: "", week_of: MONDAY },
      { id: 3, name: "Old item", category: "Annet", checked: false, price: "", weight: "", week_of: "2000-01-03" },
    ]);

    render(<GroceryPage />);

    expect(await screen.findByText("Melk")).toBeInTheDocument();
    expect(screen.getByText("Ris")).toBeInTheDocument();
    expect(screen.queryByText("Old item")).not.toBeInTheDocument();
    expect(screen.getByText("55 kr")).toBeInTheDocument(); // 24.90 + 30.00 rounded
  });

  it("filters by search text", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([
      { id: 1, name: "Melk", category: "Meieri", checked: false, price: "", weight: "", week_of: MONDAY },
      { id: 2, name: "Ris", category: "Tørrvarer", checked: false, price: "", weight: "", week_of: MONDAY },
    ]);

    render(<GroceryPage />);
    await screen.findByText("Melk");

    await userEvent.type(screen.getByPlaceholderText("Søk etter varer…"), "ri");

    expect(screen.queryByText("Melk")).not.toBeInTheDocument();
    expect(screen.getByText("Ris")).toBeInTheDocument();
  });

  it("adds a new item to the current week with the picked category", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    const createSpy = vi.spyOn(api, "createItem").mockResolvedValue({});

    render(<GroceryPage />);
    await screen.findByText("Ingen varer samsvarer med søket.");

    await userEvent.type(screen.getByPlaceholderText("Legg til en vare…"), "Spinat");
    await userEvent.click(screen.getByText("+ Legg til"));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        "groceries",
        expect.objectContaining({ name: "Spinat", week_of: MONDAY, checked: false })
      )
    );
  });
});
