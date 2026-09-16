import { describe, it, expect, vi, beforeEach } from "vitest";
import { listItems, getItem, createItem, updateItem, deleteItem, apiRequest } from "./api";

function mockFetchOnce(body, { ok = true, status = 200 } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listItems fetches the resource collection", async () => {
    mockFetchOnce([{ id: 1, label: "Immich", url: "https://photos.example.com" }]);
    const result = await listItems("quick-links");
    expect(result).toEqual([{ id: 1, label: "Immich", url: "https://photos.example.com" }]);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/quick-links/"),
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) })
    );
  });

  it("getItem fetches a single item by id", async () => {
    mockFetchOnce({ id: 1, label: "Immich", url: "https://photos.example.com" });
    const result = await getItem("quick-links", 1);
    expect(result.label).toBe("Immich");
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/quick-links/1"), expect.anything());
  });

  it("createItem POSTs the payload and returns the created item", async () => {
    mockFetchOnce({ id: 2, label: "Router", url: "https://192.168.1.1" });
    const result = await createItem("quick-links", { label: "Router", url: "https://192.168.1.1" });
    expect(result.id).toBe(2);
    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ label: "Router", url: "https://192.168.1.1" });
  });

  it("updateItem PUTs the payload", async () => {
    mockFetchOnce({ id: 2, label: "Router Admin", url: "https://192.168.1.1" });
    const result = await updateItem("quick-links", 2, { label: "Router Admin" });
    expect(result.label).toBe("Router Admin");
    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe("PUT");
  });

  it("deleteItem sends DELETE and returns null on 204", async () => {
    mockFetchOnce(null, { ok: true, status: 204 });
    const result = await deleteItem("quick-links", 2);
    expect(result).toBeNull();
    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe("DELETE");
  });

  it("exposes apiRequest for non-CRUD endpoints, sharing the base URL and error handling", async () => {
    mockFetchOnce({ ok: true });
    const result = await apiRequest("/api/ai/edit", { method: "POST", body: JSON.stringify({ text: "hi" }) });
    expect(result).toEqual({ ok: true });
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("http://localhost:8080/api/ai/edit");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("apiRequest rejects with a readable error on a non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: "boom" }),
    });
    await expect(apiRequest("/api/ai/edit", { method: "POST" })).rejects.toThrow();
  });

  it("rejects with a readable error message on a non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: [{ msg: "Field required" }] }),
    });
    await expect(createItem("meal-plan", {})).rejects.toThrow();
  });
});
