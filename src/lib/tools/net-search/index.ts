import type { ToolSpec } from "../http-tool";
import type { ToolCall } from "../../llm/types";
import type { ToolContext } from "../registry";
import type { SearchProvider, SearchProviderId } from "./types";
import { ExaSearchProvider } from "./providers/exa";
import { TavilySearchProvider } from "./providers/tavily";

export function hasSearchApiKey(context: ToolContext): boolean {
  switch (context.searchProvider) {
    case "exa":
      return Boolean(context.exaApiKey);
    case "tavily":
      return Boolean(context.tavilyApiKey);
  }
}

function createSearchProvider(
  id: SearchProviderId,
  context: ToolContext,
): SearchProvider {
  switch (id) {
    case "exa":
      return new ExaSearchProvider(context.exaApiKey, context.exaBaseUrl);
    case "tavily":
      return new TavilySearchProvider(
        context.tavilyApiKey,
        context.tavilyBaseUrl,
      );
  }
}

export function createNetSearchSpec(context: ToolContext): ToolSpec {
  const provider = createSearchProvider(context.searchProvider, context);

  return {
    definition: {
      type: "function",
      function: {
        name: "net_search",
        description:
          "Search the web for current information. Returns relevant web page titles, URLs and content snippets. Use this for current events, recent information, or fact verification.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
            maxResults: {
              type: "number",
              description:
                "Number of results to return (default: 5, max: 10)",
            },
          },
          required: ["query"],
        },
      },
    },
    execute: async (toolCall: ToolCall, runtimeContext: ToolContext) => {
      const { query, maxResults = 5 } = toolCall.args as {
        query: string;
        maxResults?: number;
      };
      const results = await provider.search(
        query,
        maxResults,
        runtimeContext.signal,
      );
      return JSON.stringify({ results }, null, 2);
    },
  };
}
