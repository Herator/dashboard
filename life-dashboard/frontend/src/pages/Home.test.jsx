import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Home from "./Home";
import * as api from "../api";

describe("Home", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders quick links returned by the API", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([{ id: 1, label: "Immich", url: "https://photos.example.com" }]);
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    const link = await screen.findByRole("link", { name: "Immich" });
    expect(link).toHaveAttribute("href", "https://photos.example.com");
  });

  it("adds a quick link via the form", async () => {
    vi.spyOn(api, "listItems").mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 1, label: "Router", url: "https://192.168.1.1" },
    ]);
    const createSpy = vi.spyOn(api, "createItem").mockResolvedValue({ id: 1, label: "Router", url: "https://192.168.1.1" });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );

    await waitFor(() => expect(api.listItems).toHaveBeenCalledTimes(1));
    await userEvent.type(screen.getByPlaceholderText("Label (e.g. Immich)"), "Router");
    await userEvent.type(screen.getByPlaceholderText("URL"), "https://192.168.1.1");
    await userEvent.click(screen.getByRole("button", { name: "Add Link" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("quick-links", { label: "Router", url: "https://192.168.1.1" }));
  });

  it("renders a nav link for every resource", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(await screen.findByRole("link", { name: "Calendar" })).toHaveAttribute("href", "/events");
    expect(screen.getByRole("link", { name: "Meal Plan" })).toHaveAttribute("href", "/meal-plan");
    expect(screen.getByRole("link", { name: "Packages" })).toHaveAttribute("href", "/packages");
  });
});
