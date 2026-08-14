import type { ToolDefinition, ToolCall, ProviderType, ResponseBuiltinTools, AnthropicBuiltinTools } from "../llm/types";
import type { SearchProviderId } from "./net-search/types";
import type { Settings } from "../settings-types";
import { createNetSearchSpec, hasSearchApiKey } from "./net-search";

/**
 * Registry used by the react loop to
 * - expose all available tools to the model (definitions)
 * - route concrete tool calls to the correct implementation at runtime.
 */
export interface ToolRegistry {
  definitions: ToolDefinition[];
  execute: (toolCall: ToolCall, context: ToolContext) => Promise<string>;
}

/**
 * Shared context passed to tool executors. Extend this as you add more tools
 * that need extra configuration (API keys, base URLs, etc.).
 */
export interface ToolContext {
  searchEnabled: boolean;
  searchProvider: SearchProviderId;
  exaApiKey: string;
  exaBaseUrl: string;
  tavilyApiKey: string;
  tavilyBaseUrl: string;
  signal?: AbortSignal;
  // Provider info for mutual exclusion logic
  provider?: ProviderType;
  responseBuiltinTools?: ResponseBuiltinTools;
  anthropicBuiltinTools?: AnthropicBuiltinTools;
}

// Projects the search-related fields of Settings into a ToolContext. Single
// source of the mapping used by the chat loop and the search-toggle UI.
export function settingsToToolContext(
  settings: Settings,
  searchEnabled = settings.searchEnabledByDefault,
  signal?: AbortSignal,
): ToolContext {
  return {
    searchEnabled,
    searchProvider: settings.searchProvider,
    exaApiKey: settings.exaApiKey,
    exaBaseUrl: settings.exaBaseUrl,
    tavilyApiKey: settings.tavilyApiKey,
    tavilyBaseUrl: settings.tavilyBaseUrl,
    signal,
    provider: settings.provider,
    responseBuiltinTools: settings.responseBuiltinTools,
    anthropicBuiltinTools: settings.anthropicBuiltinTools,
  };
}

export function isSearchToolEnabled(context: ToolContext): boolean {
  return context.searchEnabled && hasSearchApiKey(context);
}

export function createToolRegistry(context: ToolContext): ToolRegistry {
  // In-memory list of concrete tool specs (definition + execute).
  const specs = [] as { definition: ToolDefinition; execute: (toolCall: ToolCall, ctx: ToolContext) => Promise<string> }[];
  const definitions: ToolDefinition[] = [];

  // Mutual exclusion: skip local net_search when built-in web_search is enabled
  const builtinWebSearch =
    (context.provider === "openai-responses" &&
      (context.responseBuiltinTools?.web_search || context.responseBuiltinTools?.web_search_preview)) ||
    (context.provider === "anthropic" && context.anthropicBuiltinTools?.web_search);

  if (isSearchToolEnabled(context) && !builtinWebSearch) {
    const netSearchSpec = createNetSearchSpec(context);
    specs.push(netSearchSpec);
    definitions.push(netSearchSpec.definition);
  }

  // Names of built-in tools that may be returned as regular tool_use by
  // proxies that don't support server-side execution.
  const builtinToolNames = new Set<string>();
  if (context.provider === "anthropic") {
    if (context.anthropicBuiltinTools?.web_search) builtinToolNames.add("web_search");
    if (context.anthropicBuiltinTools?.code_execution) builtinToolNames.add("code_execution");
  }

  async function execute(
    toolCall: ToolCall,
    ctx: ToolContext,
  ): Promise<string> {
    const spec = specs.find((s) => s.definition.function.name === toolCall.name);
    if (!spec) {
      // Built-in tool returned as regular tool_use by a proxy without
      // server-side execution — tell the model it's unavailable.
      if (builtinToolNames.has(toolCall.name)) {
        return JSON.stringify({
          error: `The ${toolCall.name} tool requires the official API endpoint with server-side execution. It is not available through this proxy. Please answer based on your existing knowledge.`,
        });
      }
      return JSON.stringify({ error: `Unknown tool: ${toolCall.name}` });
    }
    try {
      return await spec.execute(toolCall, ctx);
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      return JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { definitions, execute };
}
