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

/** Reasoning effort level for models that support extended thinking. */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Logical provider identifier used for dispatching to concrete LLM clients. */
export type ProviderType = "openai" | "anthropic" | "openai-responses";

/** Built-in tools available with the OpenAI Responses API. */
export interface ResponseBuiltinTools {
  web_search?: boolean;
  web_search_preview?: boolean;
  image_generation?: boolean;
  code_interpreter?: boolean;
  file_search?: boolean;
  file_search_vector_store_ids?: string[];
  web_search_context_size?: "low" | "medium" | "high";
}

/** Built-in tools available with the Anthropic Messages API (server-side). */
export interface AnthropicBuiltinTools {
  web_search?: boolean;
  code_execution?: boolean;
}
export interface Citation {
  index: number;
  title: string;
  url: string;
}

/** Structured content block for rich assistant messages. */
export type ContentBlock =
  | { type: "text"; text: string; citations?: Citation[] }
  | { type: "image"; url: string; alt?: string }
  | { type: "code_input"; code: string }
  | { type: "code_output"; text: string }
  | { type: "search_indicator"; query: string; status: "searching" | "done" }
  | { type: "file_search_indicator"; query: string; status: "searching" | "done" };

/** Events emitted by built-in tools during streaming. */
export type BuiltinToolEvent =
  | { type: "web_search_start"; query: string }
  | { type: "web_search_done"; query: string }
  | { type: "image_generation_start" }
  | { type: "image_generation_done"; url: string }
  | { type: "code_interpreter_start"; code: string }
  | { type: "code_interpreter_done"; output: string }
  | { type: "file_search_start"; query: string }
  | { type: "file_search_done"; query: string }
  | { type: "citations"; citations: Citation[] };

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
  // Optional sampling params; undefined = not sent (provider default).
  temperature?: number;
  maxTokens?: number;
  // OpenAI Responses API specific
  responseBuiltinTools?: ResponseBuiltinTools;
  responseStore?: boolean;
  // Anthropic server-side tools
  anthropicBuiltinTools?: AnthropicBuiltinTools;
  // Reasoning effort control
  reasoningEffort?: ReasoningEffort;
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
  onBuiltinToolEvent?: (event: BuiltinToolEvent) => void;
  onDone: (fullContent: string, toolCalls: ToolCall[], reasoningContent?: string) => void;
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
