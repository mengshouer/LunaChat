import type { ToolDefinition, ToolCall } from "../llm/types";
import type { SearchProviderId } from "./net-search/types";
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
}

export function createToolRegistry(context: ToolContext): ToolRegistry {
  // In-memory list of concrete tool specs (definition + execute).
  const specs = [] as { definition: ToolDefinition; execute: (toolCall: ToolCall, ctx: ToolContext) => Promise<string> }[];
  const definitions: ToolDefinition[] = [];

  if (context.searchEnabled && hasSearchApiKey(context)) {
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
      return JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { definitions, execute };
}
