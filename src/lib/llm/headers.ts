import type { ProviderType } from "./types";

export function createLLMHeaders(
  provider: ProviderType,
  apiKey: string,
): Record<string, string> {
  const trimmedApiKey = apiKey.trim();

  if (provider === "anthropic") {
    return {
      ...(trimmedApiKey ? { "x-api-key": trimmedApiKey } : {}),
    };
  }

  return trimmedApiKey ? { Authorization: `Bearer ${trimmedApiKey}` } : {};
}
