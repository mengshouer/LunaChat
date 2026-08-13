import type { ToolDefinition, ToolCall } from "../llm/types";
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
  };
}

export function isSearchToolEnabled(context: ToolContext): boolean {
  return context.searchEnabled && hasSearchApiKey(context);
}

export function createToolRegistry(context: ToolContext): ToolRegistry {
  // In-memory list of concrete tool specs (definition + execute).
  const specs = [] as { definition: ToolDefinition; execute: (toolCall: ToolCall, ctx: ToolContext) => Promise<string> }[];
  const definitions: ToolDefinition[] = [];

  if (isSearchToolEnabled(context)) {
    const netSearchSpec = createNetSearchSpec(context);
    specs.push(netSearchSpec);
    definitions.push(netSearchSpec.definition);
  }

  async function execute(
    toolCall: ToolCall,
    ctx: ToolContext,
  ): Promise<string> {
    const spec = specs.find((s) => s.definition.function.name === toolCall.name);
    if (!spec) {
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
