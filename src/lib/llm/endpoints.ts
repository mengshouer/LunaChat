import type { ProviderType } from "./types";

type EndpointKind = "chat" | "models";

function appendPath(raw: string, path: string): string {
  return raw.replace(/\/+$/, "") + path;
}

function replaceLastPathSegment(url: URL, segment: string): string {
  const parts = url.pathname.split("/").filter(Boolean);
  parts[parts.length - 1] = segment;
  url.pathname = "/" + parts.join("/");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function replaceChatCompletions(url: URL): string {
  const parts = url.pathname.split("/").filter(Boolean);
  parts.splice(parts.length - 2, 2, "models");
  url.pathname = "/" + parts.join("/");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function resolveLLMEndpoint(
  baseUrl: string,
  provider: ProviderType,
  kind: EndpointKind,
): string {
  const raw = baseUrl.trim().replace(/\/+$/, "");
  if (!raw) return "";

  const chatPath = provider === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
  const modelsPath = "/v1/models";

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  const hasPath = pathname !== "";

  if (kind === "chat") {
    if (!hasPath || pathname === "/") return appendPath(raw, chatPath);
    if (pathname === "/v1") return appendPath(raw, provider === "anthropic" ? "/messages" : "/chat/completions");
    return raw;
  }

  if (!hasPath || pathname === "/") return appendPath(raw, modelsPath);
  if (pathname === "/v1") return appendPath(raw, "/models");
  if (pathname.endsWith("/models")) return raw;
  if (pathname.endsWith("/chat/completions")) return replaceChatCompletions(url);
  if (pathname.endsWith("/messages")) return replaceLastPathSegment(url, "models");

  return appendPath(raw, "/models");
}
