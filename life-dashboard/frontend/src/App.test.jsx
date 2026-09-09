import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import * as api from "./api";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  // `MemoryRouter` ignores `window.location`/`window.history` entirely — it always
  // starts from `initialEntries` (defaulting to ["/"]). Seed it from the current
  // window location so tests can drive routes via `window.history.pushState`.
  function BrowserRouter({ children }) {
    return (
      <actual.MemoryRouter initialEntries={[window.location.pathname + window.location.search]}>
        {children}
      </actual.MemoryRouter>
    );
  }
  return { ...actual, BrowserRouter };
});

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    window.history.pushState({}, "", "/");
  });

  it("renders the Home page at /", async () => {
    render(<App />);
    expect(await screen.findByText("Life Dashboard")).toBeInTheDocument();
  });

  it("renders the Groceries ResourcePage at /groceries", async () => {
    window.history.pushState({}, "", "/groceries");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Groceries" })).toBeInTheDocument();
  });
});
