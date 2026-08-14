import { streamOpenAI } from "./openai";
import { streamOpenAIResponses } from "./openai-responses";
import { streamAnthropic } from "./anthropic";
import type { ProviderType, LLMClient } from "../types";

const providers: Record<ProviderType, LLMClient> = {
  openai: { stream: streamOpenAI },
  "openai-responses": { stream: streamOpenAIResponses },
  anthropic: { stream: streamAnthropic },
};

export function getLLMClient(provider: ProviderType): LLMClient {
  return providers[provider];
}
