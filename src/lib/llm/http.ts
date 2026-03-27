import type { RequestMode } from "./types";

const failedClientOrigins = new Set<string>();

function getOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

interface LLMRequestInit {
  body: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  requestMode?: RequestMode;
}

export async function fetchWithMode(
  url: string,
  init: LLMRequestInit,
): Promise<Response> {
  const { body, headers = {}, signal, requestMode = "auto" } = init;
  const origin = getOrigin(url);

  const client = () =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal,
    });

  const server = () =>
    fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, headers, body }),
      signal,
    });

  if (requestMode === "server") return server();
  if (requestMode === "client") return client();

  if (failedClientOrigins.has(origin)) return server();

  try {
    return await client();
  } catch {
    failedClientOrigins.add(origin);
    return server();
  }
}
