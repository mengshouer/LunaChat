import type { ProviderType } from "./types";

export function createLLMHeaders(
  provider: ProviderType,
  apiKey: string,
): Record<string, string> {
  const trimmedApiKey = apiKey.trim();

  if (provider === "anthropic") {
    return {
      // Required by the official API; harmless for compatible proxies.
      "anthropic-version": "2023-06-01",
      // Official API rejects browser-originated requests (CORS) without this.
      "anthropic-dangerous-direct-browser-access": "true",
      ...(trimmedApiKey ? { "x-api-key": trimmedApiKey } : {}),
    };
  }

  return trimmedApiKey ? { Authorization: `Bearer ${trimmedApiKey}` } : {};
}
