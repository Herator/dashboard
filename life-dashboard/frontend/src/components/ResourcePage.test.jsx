import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResourcePage from "./ResourcePage";
import * as api from "../api";

const fields = [
  { name: "name", label: "Name", type: "text", required: true },
  { name: "quantity", label: "Quantity", type: "text" },
  { name: "checked", label: "Checked", type: "checkbox" },
];

describe("ResourcePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders items returned by listItems", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([{ id: 1, name: "Milk", quantity: "1 gal", checked: false }]);
    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);
    expect(await screen.findByText("Milk")).toBeInTheDocument();
  });

  it("submits the create form and refreshes the list", async () => {
    vi.spyOn(api, "listItems").mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 1, name: "Eggs", quantity: "1 dozen", checked: false },
    ]);
    const createSpy = vi.spyOn(api, "createItem").mockResolvedValue({ id: 1, name: "Eggs", quantity: "1 dozen", checked: false });
    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);

    await waitFor(() => expect(api.listItems).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByLabelText("Name"), "Eggs");
    await userEvent.type(screen.getByLabelText("Quantity"), "1 dozen");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("groceries", { name: "Eggs", quantity: "1 dozen", checked: false }));
    expect(await screen.findByText("Eggs")).toBeInTheDocument();
  });

  it("populates the form for editing and calls updateItem on submit", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([{ id: 1, name: "Milk", quantity: "1 gal", checked: false }]);
    const updateSpy = vi.spyOn(api, "updateItem").mockResolvedValue({ id: 1, name: "Milk", quantity: "2 gal", checked: false });
    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);

    await screen.findByText("Milk");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Milk");

    await userEvent.clear(screen.getByLabelText("Quantity"));
    await userEvent.type(screen.getByLabelText("Quantity"), "2 gal");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith("groceries", 1, { name: "Milk", quantity: "2 gal", checked: false }));
  });

  it("calls deleteItem and refreshes the list when Delete is clicked", async () => {
    vi.spyOn(api, "listItems").mockResolvedValueOnce([{ id: 1, name: "Milk", quantity: "1 gal", checked: false }]).mockResolvedValueOnce([]);
    const deleteSpy = vi.spyOn(api, "deleteItem").mockResolvedValue(null);
    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);

    await screen.findByText("Milk");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith("groceries", 1));
    await waitFor(() => expect(screen.queryByText("Milk")).not.toBeInTheDocument());
  });

  it("shows an error message when the API call fails", async () => {
    vi.spyOn(api, "listItems").mockRejectedValue(new Error("Request failed: 500"));
    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Request failed: 500");
  });

  it("converts a comma-separated list field to an array on submit", async () => {
    const listField = [{ name: "name", label: "Name", type: "text", required: true }, { name: "ingredients", label: "Ingredients", type: "list" }];
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    const createSpy = vi.spyOn(api, "createItem").mockResolvedValue({ id: 1, name: "Tacos", ingredients: ["beef", "salsa"] });
    render(<ResourcePage resourceKey="meal-plan" label="Meal Plan" fields={listField} />);

    await userEvent.type(screen.getByLabelText("Name"), "Tacos");
    await userEvent.type(screen.getByLabelText("Ingredients"), "beef, salsa");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("meal-plan", { name: "Tacos", ingredients: ["beef", "salsa"] }));
  });
});
