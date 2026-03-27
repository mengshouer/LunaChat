import { streamOpenAI } from "./openai";
import { streamAnthropic } from "./anthropic";
import type { ProviderType, LLMClient } from "../types";

const providers: Record<ProviderType, LLMClient> = {
  openai: { stream: streamOpenAI },
  anthropic: { stream: streamAnthropic },
};

export function getLLMClient(provider: ProviderType): LLMClient {
  return providers[provider];
}
