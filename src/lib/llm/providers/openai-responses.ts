import type {
  ChatMessage,
  ProviderConfig,
  ToolCall,
  ToolDefinition,
  StreamCallbacks,
  ResponseBuiltinTools,
  Citation,
} from "../types";
import { parseSSEStream } from "../stream-parser";
import { fetchWithMode } from "../http";
import { resolveLLMEndpoint } from "../endpoints";
import { createLLMHeaders } from "../headers";

// --- Request body types ---

type InputItem =
  | { type: "message"; role: "user" | "assistant"; content: InputContent[] }
  | { type: "function_call"; id: string; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

type InputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

interface ResponsesToolDef {
  type: string;
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  vector_store_ids?: string[];
  search_context_size?: string;
}

// --- Conversion helpers ---

function toInputItems(
  messages: ChatMessage[],
): InputItem[] {
  const items: InputItem[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const content: InputContent[] = [];
      for (const att of msg.attachments ?? []) {
        if (att.mimeType.startsWith("image/")) {
          content.push({ type: "input_image", image_url: att.url });
        }
      }
      if (msg.content) {
        content.push({ type: "input_text", text: msg.content });
      }
      items.push({ type: "message", role: "user", content });
    } else if (msg.role === "assistant") {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        // Each tool call becomes a function_call item
        for (const tc of msg.toolCalls) {
          items.push({
            type: "function_call",
            id: `fc_${tc.id}`,
            call_id: tc.id,
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          });
        }
      }
      if (msg.content) {
        items.push({
          type: "message",
          role: "assistant",
          content: [{ type: "input_text", text: msg.content }],
        });
      }
    } else if (msg.role === "tool") {
      items.push({
        type: "function_call_output",
        call_id: msg.toolCallId || "",
        output: msg.content,
      });
    }
  }

  return items;
}

function buildTools(
  builtinTools: ResponseBuiltinTools | undefined,
  functionTools: ToolDefinition[],
): ResponsesToolDef[] {
  const tools: ResponsesToolDef[] = [];

  if (builtinTools?.web_search) {
    tools.push({
      type: "web_search",
      ...(builtinTools.web_search_context_size
        ? { search_context_size: builtinTools.web_search_context_size }
        : {}),
    });
  }
  if (builtinTools?.web_search_preview) {
    tools.push({
      type: "web_search_preview",
      ...(builtinTools.web_search_context_size
        ? { search_context_size: builtinTools.web_search_context_size }
        : {}),
    });
  }
  if (builtinTools?.image_generation) tools.push({ type: "image_generation" });
  if (builtinTools?.code_interpreter) tools.push({ type: "code_interpreter" });
  if (builtinTools?.file_search) {
    const ids = builtinTools.file_search_vector_store_ids?.filter(Boolean);
    tools.push({
      type: "file_search",
      ...(ids && ids.length > 0 ? { vector_store_ids: ids } : {}),
    });
  }

  for (const ft of functionTools) {
    tools.push({
      type: "function",
      name: ft.function.name,
      description: ft.function.description,
      parameters: ft.function.parameters,
    });
  }

  return tools;
}

// --- Streaming parser ---

async function streamResponsesFromResponse(
  response: Response,
  callbacks: StreamCallbacks,
): Promise<void> {
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok || contentType.includes("text/html")) {
    const errorText = await response.text();
    const message = errorText && errorText.trim().length > 0
      ? errorText
      : `OpenAI Responses API error ${response.status}`;
    throw new Error(message);
  }

  const reader = response.body!.getReader();
  let fullContent = "";
  // Key by item_id (fc_xxx), store call_id separately for function_call_output
  const toolCallsMap = new Map<string, { id: string; callId: string; name: string; args: string }>();
  const currentCitations: Citation[] = [];
  let citationIndex = 0;

  for await (const data of parseSSEStream(reader)) {
    try {
      const event = JSON.parse(data);
      const eventType: string = event.type ?? "";

      switch (eventType) {
        // Text output deltas
        case "response.output_text.delta": {
          const delta = event.delta ?? "";
          fullContent += delta;
          callbacks.onToken(delta);
          break;
        }

        // Text output done - may contain annotations/citations
        case "response.output_text.done": {
          const annotations = event.annotations ?? [];
          for (const ann of annotations) {
            if (ann.type === "url_citation") {
              citationIndex++;
              currentCitations.push({
                index: citationIndex,
                title: ann.title || ann.url || "",
                url: ann.url || "",
              });
            }
          }
          break;
        }

        // Web search events
        case "response.web_search_call.in_progress": {
          const query = event.query ?? event.action?.query ?? "";
          callbacks.onBuiltinToolEvent?.({
            type: "web_search_start",
            query,
          });
          break;
        }
        case "response.web_search_call.completed": {
          const query = event.query ?? "";
          callbacks.onBuiltinToolEvent?.({
            type: "web_search_done",
            query,
          });
          break;
        }

        // File search events
        case "response.file_search_call.in_progress": {
          const query = event.query ?? "";
          callbacks.onBuiltinToolEvent?.({
            type: "file_search_start",
            query,
          });
          break;
        }
        case "response.file_search_call.completed": {
          const query = event.query ?? "";
          callbacks.onBuiltinToolEvent?.({
            type: "file_search_done",
            query,
          });
          break;
        }

        // Image generation events
        case "response.image_generation.in_progress": {
          callbacks.onBuiltinToolEvent?.({ type: "image_generation_start" });
          break;
        }
        case "response.image_generation.done": {
          // The result contains base64 image data or a URL
          const imageData = event.result ?? event.image ?? "";
          let imageUrl: string;
          if (imageData.startsWith("data:") || imageData.startsWith("http")) {
            imageUrl = imageData;
          } else {
            // Assume base64
            imageUrl = `data:image/png;base64,${imageData}`;
          }
          callbacks.onBuiltinToolEvent?.({
            type: "image_generation_done",
            url: imageUrl,
          });
          break;
        }

        // Code interpreter events
        case "response.code_interpreter_call.in_progress": {
          const code = event.code ?? event.input ?? "";
          callbacks.onBuiltinToolEvent?.({
            type: "code_interpreter_start",
            code,
          });
          break;
        }
        case "response.code_interpreter_call.code.delta": {
          // Streaming code input - we accumulate
          break;
        }
        case "response.code_interpreter_call.completed": {
          const output = event.output ?? event.result ?? "";
          callbacks.onBuiltinToolEvent?.({
            type: "code_interpreter_done",
            output: typeof output === "string" ? output : JSON.stringify(output),
          });
          break;
        }

        // Function call (custom tool) argument deltas
        case "response.function_call_arguments.delta": {
          // item_id is the stable key (fc_xxx); call_id may not be present here
          const itemId = event.item_id ?? event.call_id ?? "";
          const delta = event.delta ?? "";
          if (!toolCallsMap.has(itemId)) {
            toolCallsMap.set(itemId, {
              id: itemId,
              callId: event.call_id ?? itemId,
              name: event.name ?? "",
              args: "",
            });
          }
          const existing = toolCallsMap.get(itemId)!;
          if (event.name) existing.name = event.name;
          if (event.call_id) existing.callId = event.call_id;
          existing.args += delta;
          break;
        }
        case "response.function_call_arguments.done": {
          const itemId = event.item_id ?? event.call_id ?? "";
          if (!toolCallsMap.has(itemId)) {
            toolCallsMap.set(itemId, {
              id: itemId,
              callId: event.call_id ?? itemId,
              name: event.name ?? "",
              args: event.arguments ?? "",
            });
          } else {
            const existing = toolCallsMap.get(itemId)!;
            if (event.name) existing.name = event.name;
            if (event.call_id) existing.callId = event.call_id;
            if (event.arguments) existing.args = event.arguments;
          }
          break;
        }

        // Output item added - captures function call names
        case "response.output_item.added": {
          const item = event.item ?? {};
          if (item.type === "function_call") {
            // Use item.id (fc_xxx) as the stable map key
            const itemId = item.id ?? item.call_id ?? "";
            if (!toolCallsMap.has(itemId)) {
              toolCallsMap.set(itemId, {
                id: itemId,
                callId: item.call_id ?? itemId,
                name: item.name ?? "",
                args: "",
              });
            } else {
              const existing = toolCallsMap.get(itemId)!;
              if (item.name) existing.name = item.name;
              if (item.call_id) existing.callId = item.call_id;
            }
            // Early indication
            callbacks.onToolCall(
              Array.from(toolCallsMap.values()).map((tc) => ({
                id: tc.callId,
                name: tc.name,
                args: {},
              })),
            );
          }
          break;
        }

        // Response completed
        case "response.completed": {
          // Final processing handled below
          break;
        }

        default:
          // Ignore unknown events
          break;
      }
    } catch {
      // skip malformed JSON lines
    }
  }

  // Build final tool calls — use call_id as the external id (needed for function_call_output)
  const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.args);
    } catch {
      // pass
    }
    return { id: tc.callId, name: tc.name, args };
  });

  if (toolCalls.length > 0) {
    callbacks.onToolCall(toolCalls);
  }

  // Emit collected citations
  if (currentCitations.length > 0) {
    callbacks.onBuiltinToolEvent?.({
      type: "citations",
      citations: currentCitations,
    });
  }

  callbacks.onDone(fullContent, toolCalls, undefined);
}

export async function streamOpenAIResponses(
  config: ProviderConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  callbacks: StreamCallbacks,
  systemPrompt?: string,
  signal?: AbortSignal,
): Promise<void> {
  const url = resolveLLMEndpoint(config.baseUrl, config.provider, "chat");

  const builtinTools = config.responseBuiltinTools;
  const responsesTools = buildTools(builtinTools, tools);

  const body: Record<string, unknown> = {
    model: config.model,
    input: toInputItems(messages),
    stream: true,
    store: config.responseStore ?? true,
  };

  if (systemPrompt) {
    body.instructions = systemPrompt;
  }

  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (config.maxTokens !== undefined) body.max_output_tokens = config.maxTokens;
  if (config.reasoningEffort && config.reasoningEffort !== "none") {
    body.reasoning = { effort: config.reasoningEffort };
  }

  if (responsesTools.length > 0) {
    body.tools = responsesTools;
  }

  const response = await fetchWithMode(url, {
    body,
    headers: createLLMHeaders(config.provider, config.apiKey),
    signal,
    requestMode: config.requestMode,
  });

  await streamResponsesFromResponse(response, callbacks);
}
