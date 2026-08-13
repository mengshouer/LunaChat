import type { ToolDefinition, ToolCall } from "../llm/types";
import type { ToolContext } from "./registry";
import { fetchWithMode } from "../llm/http";

/**
 * Runtime representation of a tool: the JSON schema definition that is sent to the model,
 * plus an execute function that actually performs the tool call.
 */
export interface ToolSpec {
  definition: ToolDefinition;
  execute: (toolCall: ToolCall, context: ToolContext) => Promise<string>;
}

/** Parameters for a generic HTTP-based tool call. */
interface HttpToolParams {
  /** Target URL. For external APIs this is the real endpoint; for internal tools it can be a Next.js API route like /api/exa. */
  url: string;
  /** JSON-serializable request body. */
  body: unknown;
  /** Extra headers to send with the request (API keys, versions, etc.). */
  headers?: Record<string, string>;
  /**
   * How to send the request:
   * - client: browser -> url
   * - server: browser -> /api/llm proxy -> url
   * - auto: try client first, remember failing origins and fallback to server
   *
   * 对于需要后端密钥的外部 API，推荐使用 server；对于本项目自有的 /api/* 路由，通常使用 client。
   */
  requestMode?: "client" | "server" | "auto";
  signal?: AbortSignal;
}

/**
 * Helper used by HTTP-based tools. Handles requestMode + error handling + JSON / text decoding.
 */
export async function callHttpTool({
  url,
  body,
  headers,
  requestMode = "server",
  signal,
}: HttpToolParams): Promise<string> {
  const response = await fetchWithMode(url, {
    body,
    headers,
    requestMode,
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP tool request failed: ${response.status} ${errorText}`);
  }

  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    const data = await response.json();
    return JSON.stringify(data, null, 2);
  }

  const text = await response.text();
  return text;
}
