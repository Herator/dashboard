import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AiEditBox from "./AiEditBox";
import * as api from "../api";

describe("AiEditBox", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a preview summary after Suggest, without applying anything yet", async () => {
    vi.spyOn(api, "previewAiEdit").mockResolvedValue({
      created: [{ name: "Chicken stir fry" }],
      updated: [],
      deleted: [],
      items: [{ date: "2026-09-10", meal_slot: "dinner", name: "Chicken stir fry" }],
    });
    const applySpy = vi.spyOn(api, "applyAiEdit");
    const onApplied = vi.fn();

    render(<AiEditBox resourceKey="meal-plan" primaryField="name" onApplied={onApplied} />);

    await userEvent.type(
      screen.getByPlaceholderText(/tell the ai/i),
      "add chicken stir fry for dinner"
    );
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));

    expect(await screen.findByText(/create 1/i)).toBeInTheDocument();
    expect(screen.getByText(/chicken stir fry/i)).toBeInTheDocument();
    expect(applySpy).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("calls applyAiEdit with the previewed items when Apply is clicked, then calls onApplied", async () => {
    const previewItems = [{ date: "2026-09-10", meal_slot: "dinner", name: "Chicken stir fry" }];
    vi.spyOn(api, "previewAiEdit").mockResolvedValue({
      created: [{ name: "Chicken stir fry" }],
      updated: [],
      deleted: [],
      items: previewItems,
    });
    const applySpy = vi.spyOn(api, "applyAiEdit").mockResolvedValue([{ id: 1, name: "Chicken stir fry" }]);
    const onApplied = vi.fn().mockResolvedValue(undefined);

    render(<AiEditBox resourceKey="meal-plan" primaryField="name" onApplied={onApplied} />);

    await userEvent.type(screen.getByPlaceholderText(/tell the ai/i), "add chicken stir fry");
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));
    await screen.findByText(/create 1/i);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(applySpy).toHaveBeenCalledWith("meal-plan", { items: previewItems })
    );
    await waitFor(() => expect(onApplied).toHaveBeenCalled());

    // The preview panel should be gone and the message input cleared after apply.
    expect(screen.queryByText(/create 1/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/tell the ai/i)).toHaveValue("");
  });

  it("discards the preview without calling applyAiEdit when Cancel is clicked", async () => {
    vi.spyOn(api, "previewAiEdit").mockResolvedValue({
      created: [],
      updated: [],
      deleted: [{ name: "Leftover soup" }],
      items: [],
    });
    const applySpy = vi.spyOn(api, "applyAiEdit");

    render(<AiEditBox resourceKey="meal-plan" primaryField="name" onApplied={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/tell the ai/i), "remove lunch");
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));
    await screen.findByText(/delete 1/i);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/delete 1/i)).not.toBeInTheDocument();
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("shows an error message when preview fails", async () => {
    vi.spyOn(api, "previewAiEdit").mockRejectedValue(
      new Error("AI editing is not configured: ANTHROPIC_API_KEY is not set.")
    );

    render(<AiEditBox resourceKey="meal-plan" primaryField="name" onApplied={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/tell the ai/i), "anything");
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ANTHROPIC_API_KEY");
  });

  it("shows 'No changes' when the preview is empty on all three counts", async () => {
    vi.spyOn(api, "previewAiEdit").mockResolvedValue({
      created: [], updated: [], deleted: [], items: [],
    });

    render(<AiEditBox resourceKey="meal-plan" primaryField="name" onApplied={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/tell the ai/i), "nothing to do here");
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));

    expect(await screen.findByText(/no changes/i)).toBeInTheDocument();
  });
});
