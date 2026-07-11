import type { RequestMode } from "./types";
import { accessTokenHeader } from "../access-token";

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
        // A relative url targets this app's own /api routes (net_search hits
        // /api/exa, /api/tavily via callHttpTool requestMode:"client"); attach
        // the access token there. External absolute LLM urls never get it.
        ...(url.startsWith("/") ? accessTokenHeader() : {}),
        ...headers,
      },
      body: JSON.stringify(body),
      signal,
    });

  const server = () =>
    fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...accessTokenHeader() },
      body: JSON.stringify({ url, headers, body }),
      signal,
    });

  if (requestMode === "server") return server();
  if (requestMode === "client") return client();

  if (failedClientOrigins.has(origin)) return server();

  try {
    return await client();
  } catch (err) {
    // A user-initiated Stop rejects the fetch with an AbortError. That is not
    // an origin failure: don't remember it and don't fall back to the proxy,
    // just rethrow so the caller sees the abort.
    if (
      (err instanceof DOMException && err.name === "AbortError") ||
      signal?.aborted
    ) {
      throw err;
    }
    failedClientOrigins.add(origin);
    return server();
  }
}
