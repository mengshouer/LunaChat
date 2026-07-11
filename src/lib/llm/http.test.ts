import { describe, it, expect, vi, afterEach } from "vitest";

async function freshFetchWithMode() {
  vi.resetModules();
  return (await import("./http")).fetchWithMode;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithMode auto mode", () => {
  it("rethrows an AbortError without marking the origin or falling back", async () => {
    const fetchWithMode = await freshFetchWithMode();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWithMode("https://api.x.com/v1/chat/completions", { body: {} }),
    ).rejects.toMatchObject({ name: "AbortError" });

    // Next request to the same origin still goes direct (origin not blacklisted)
    await fetchWithMode("https://api.x.com/v1/chat/completions", { body: {} });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.x.com/v1/chat/completions",
    );
  });

  it("rethrows when the signal is aborted even if the error is generic", async () => {
    const fetchWithMode = await freshFetchWithMode();
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWithMode("https://api.x.com/v1/chat/completions", {
        body: {},
        signal: controller.signal,
      }),
    ).rejects.toThrow("network");
    // Only the client attempt ran; no proxy fallback
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the proxy on a real client failure and remembers the origin", async () => {
    const fetchWithMode = await freshFetchWithMode();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithMode("https://api.x.com/v1/chat/completions", { body: {} });
    // Second call is the server proxy
    expect(fetchMock.mock.calls[1][0]).toBe("/api/llm");

    // Subsequent same-origin request skips the client attempt entirely
    await fetchWithMode("https://api.x.com/v1/chat/completions", { body: {} });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/llm");
  });
});

describe("fetchWithMode access token", () => {
  function withToken(token: string | null) {
    const store = new Map<string, string>();
    if (token) store.set("chat-app-access-token", token);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
  }

  it("attaches the token to same-origin relative /api requests (client mode)", async () => {
    const fetchWithMode = await freshFetchWithMode();
    withToken("secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithMode("/api/exa", { body: {}, requestMode: "client" });
    expect(fetchMock.mock.calls[0][1].headers["x-access-token"]).toBe("secret");
  });

  it("does not attach the token to external absolute urls (client mode)", async () => {
    const fetchWithMode = await freshFetchWithMode();
    withToken("secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithMode("https://api.x.com/v1/chat/completions", {
      body: {},
      requestMode: "client",
    });
    expect(
      fetchMock.mock.calls[0][1].headers["x-access-token"],
    ).toBeUndefined();
  });

  it("attaches the token to the /api/llm proxy (server mode)", async () => {
    const fetchWithMode = await freshFetchWithMode();
    withToken("secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithMode("https://api.x.com/v1/chat/completions", {
      body: {},
      requestMode: "server",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/llm");
    expect(fetchMock.mock.calls[0][1].headers["x-access-token"]).toBe("secret");
  });

  it("omits the header entirely when no token is set", async () => {
    const fetchWithMode = await freshFetchWithMode();
    withToken(null);
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithMode("/api/exa", { body: {}, requestMode: "client" });
    await fetchWithMode("https://api.x.com/v1/chat/completions", {
      body: {},
      requestMode: "server",
    });
    expect(
      fetchMock.mock.calls[0][1].headers["x-access-token"],
    ).toBeUndefined();
    expect(
      fetchMock.mock.calls[1][1].headers["x-access-token"],
    ).toBeUndefined();
  });
});

