/** A single tool invocation requested by the model. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Minimal chat message shape used inside the react loop and providers. */
export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  // image attachments forwarded as multimodal blocks; non-image files are summarised in content
  attachments?: { url: string; mimeType: string; name: string }[];
  // Extended-thinking output of this assistant message and how long the
  // thinking phase lasted (ms), measured per loop iteration.
  reasoningContent?: string;
  thinkingDuration?: number;
}

/** Logical provider identifier used for dispatching to concrete LLM clients. */
export type ProviderType = "openai" | "anthropic";

/**
 * How HTTP requests to the LLM / tools should be made:
 * - client: browser fetch directly to baseUrl
 * - server: always go through our Next.js proxy
 * - auto: try client first, on failure remember the origin and fallback to server
 */
export type RequestMode = "client" | "server" | "auto";

/** Configuration required to talk to a specific LLM provider. */
export interface ProviderConfig {
  provider: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  requestMode?: RequestMode;
}

/** JSON schema of a single callable tool exposed to the LLM. */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Streaming callbacks used by provider implementations to report progress. */
export interface StreamCallbacks {
  onToken: (token: string) => void;
  onThinkingToken: (token: string) => void;
  onToolCall: (toolCalls: ToolCall[]) => void;
  onDone: (fullContent: string, toolCalls: ToolCall[], reasoningContent?: string) => void;
  onError: (error: Error) => void;
}

/**
 * Minimal interface each concrete LLM client (OpenAI, Anthropic, etc.) must implement.
 *
 * New providers should implement this and register themselves in src/lib/llm/providers.ts.
 */
export interface LLMClient {
  stream: (
    config: ProviderConfig,
    messages: ChatMessage[],
    tools: ToolDefinition[],
    callbacks: StreamCallbacks,
    systemPrompt?: string,
    signal?: AbortSignal,
  ) => Promise<void>;
}
