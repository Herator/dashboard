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

  it("omits blank optional fields from the create payload", async () => {
    // Not a real RESOURCES entry (Packages has no page); these fields just
    // give ResourcePage a required field plus optional ones to exercise the
    // omit-blank-optional behaviour generically.
    const packageFields = [
      { name: "tracking_number", label: "Tracking Number", type: "text", required: true },
      { name: "carrier", label: "Carrier", type: "text" },
      { name: "status", label: "Status", type: "text" },
    ];
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    const createSpy = vi.spyOn(api, "createItem").mockResolvedValue({ id: 1, tracking_number: "1Z999", carrier: null, status: "unknown" });
    render(<ResourcePage resourceKey="packages" label="Packages" fields={packageFields} />);

    await userEvent.type(screen.getByLabelText("Tracking Number"), "1Z999");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    const [, payload] = createSpy.mock.calls[0];
    expect(payload).toEqual({ tracking_number: "1Z999" });
    expect(Object.keys(payload)).not.toContain("carrier");
    expect(Object.keys(payload)).not.toContain("status");
    expect("carrier" in payload).toBe(false);
    expect("status" in payload).toBe(false);
  });

  it("still sends an explicit null on update so a blank optional field is cleared", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([{ id: 1, name: "Milk", quantity: "1 gal", checked: false }]);
    const updateSpy = vi.spyOn(api, "updateItem").mockResolvedValue({ id: 1, name: "Milk", quantity: null, checked: false });
    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);

    await screen.findByText("Milk");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByLabelText("Quantity"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith("groceries", 1, { name: "Milk", quantity: null, checked: false }));
  });

  it("marks a required textarea field as required", async () => {
    const textareaField = [{ name: "plan_text", label: "Plan", type: "textarea", required: true }];
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    render(<ResourcePage resourceKey="workouts" label="Workouts" fields={textareaField} />);

    expect(await screen.findByLabelText("Plan")).toBeRequired();
  });

  it("renders AiEditBox when aiEditable is true", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    render(
      <ResourcePage
        resourceKey="meal-plan"
        label="Meal Plan"
        fields={fields}
        aiEditable={true}
        primaryField="name"
      />
    );
    expect(await screen.findByPlaceholderText(/tell the ai/i)).toBeInTheDocument();
  });

  it("does not render AiEditBox when aiEditable is not set", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);
    await screen.findByText("Groceries");
    expect(screen.queryByPlaceholderText(/tell the ai/i)).not.toBeInTheDocument();
  });

  it("toggles checkbox directly in the table row", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([
      { id: 1, name: "Milk", quantity: "1 gal", checked: false },
    ]);
    const updateSpy = vi.spyOn(api, "updateItem").mockResolvedValue({
      id: 1, name: "Milk", quantity: "1 gal", checked: true,
    });

    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);
    expect(await screen.findByText("Milk")).toBeInTheDocument();

    const tableCheckbox = screen.getByRole("checkbox", { name: /toggle checked/i });
    expect(tableCheckbox).not.toBeChecked();

    await userEvent.click(tableCheckbox);
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith("groceries", 1, expect.objectContaining({ checked: true }))
    );
  });

  it("renders Sync from Meal Plan button and triggers sync for groceries", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([]);
    const syncSpy = vi.spyOn(api, "syncGroceriesFromMealPlan").mockResolvedValue({
      week_of: "2026-09-07",
      added: [{ id: 2, name: "Apples" }],
    });

    render(<ResourcePage resourceKey="groceries" label="Groceries" fields={fields} />);
    const syncBtn = await screen.findByRole("button", { name: /sync from meal plan/i });
    expect(syncBtn).toBeInTheDocument();

    await userEvent.click(syncBtn);
    await waitFor(() => expect(syncSpy).toHaveBeenCalled());
    expect(await screen.findByText(/added 1 item/i)).toBeInTheDocument();
  });
});
