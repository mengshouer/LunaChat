import type {
  ChatMessage,
  ProviderConfig,
  ToolCall,
  ToolDefinition,
  StreamCallbacks,
} from "../types";
import { fetchWithMode } from "../http";
import { resolveLLMEndpoint } from "../endpoints";
import { createLLMHeaders } from "../headers";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: "text" | "tool_use" | "tool_result" | "image" | "document";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  source?: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === "user") {
      const mediaBlocks: AnthropicContentBlock[] = (msg.attachments ?? [])
        .filter((a) => a.url.startsWith("data:"))
        .map((a) => {
          const data = a.url.split(",")[1];
          if (a.mimeType === "application/pdf") {
            return {
              type: "document" as const,
              source: { type: "base64" as const, media_type: a.mimeType, data },
            };
          }
          return {
            type: "image" as const,
            source: { type: "base64" as const, media_type: a.mimeType, data },
          };
        });
      // Remove <file> tags for PDFs that are already sent as document blocks
      const pdfNames = new Set(
        (msg.attachments ?? [])
          .filter((a) => a.mimeType === "application/pdf")
          .map((a) => a.name),
      );
      let textContent = msg.content;
      if (pdfNames.size > 0) {
        textContent = textContent
          .replace(
            /<file name="([^"]+)" type="application\/pdf">[\s\S]*?<\/file>/g,
            (_, name) => (pdfNames.has(name) ? "" : `<file name="${name}">...</file>`),
          )
          .trim();
      }
      const blocks: AnthropicContentBlock[] = [
        ...mediaBlocks,
        ...(textContent ? [{ type: "text" as const, text: textContent }] : []),
      ];
      result.push({
        role: "user",
        content: blocks.length === 1 && blocks[0].type === "text" ? msg.content : blocks,
      });
      i++;
    } else if (msg.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (msg.content) {
        blocks.push({ type: "text", text: msg.content });
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.args,
          });
        }
      }
      result.push({
        role: "assistant",
        content: blocks.length > 0 ? blocks : msg.content,
      });
      i++;

      // Collect following tool results into a single user message
      const toolResults: AnthropicContentBlock[] = [];
      while (i < messages.length && messages[i].role === "tool") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: messages[i].toolCallId,
          content: messages[i].content,
        });
        i++;
      }
      if (toolResults.length > 0) {
        result.push({ role: "user", content: toolResults });
      }
    } else if (msg.role === "tool") {
      // Standalone tool results (shouldn't happen normally, but handle gracefully)
      result.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.toolCallId,
            content: msg.content,
          },
        ],
      });
      i++;
    } else {
      i++;
    }
  }

  return result;
}

function toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

async function streamAnthropicFromResponse(
  response: Response,
  callbacks: StreamCallbacks,
): Promise<void> {
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok || contentType.includes("text/html")) {
    const errorText = await response.text();
    const message = errorText && errorText.trim().length > 0
      ? errorText
      : `Anthropic API error ${response.status}`;
    throw new Error(message);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let reasoningContent = "";
  const toolCallsMap = new Map<
    number,
    { id: string; name: string; args: string }
  >();
  let currentBlockIndex = -1;
  // Track block types: "thinking" | "text" | "tool_use"
  const blockTypes = new Map<number, string>();

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) return;

    const data = trimmed.slice(6);
    if (data === "[DONE]") return;

    try {
      const event = JSON.parse(data);

      switch (event.type) {
        case "content_block_start": {
          currentBlockIndex = event.index;
          const blockType = event.content_block?.type;
          if (blockType) {
            blockTypes.set(currentBlockIndex, blockType);
          }
          if (blockType === "tool_use") {
            toolCallsMap.set(currentBlockIndex, {
              id: event.content_block.id || "",
              name: event.content_block.name || "",
              args: "",
            });
            // Early indication: name/id are complete at block start; args
            // stream in later. Empty args keep the UI rendering safe, and the
            // final onToolCall/onDone below still carries the parsed args.
            callbacks.onToolCall(
              Array.from(toolCallsMap.values()).map((tc) => ({
                id: tc.id,
                name: tc.name,
                args: {},
              })),
            );
          }
          break;
        }

        case "content_block_delta": {
          const delta = event.delta;
          if (delta?.type === "thinking_delta" && delta.thinking) {
            reasoningContent += delta.thinking;
            callbacks.onThinkingToken(delta.thinking);
          } else if (delta?.type === "text_delta" && delta.text) {
            fullContent += delta.text;
            callbacks.onToken(delta.text);
          } else if (delta?.type === "input_json_delta" && delta.partial_json) {
            const existing = toolCallsMap.get(currentBlockIndex);
            if (existing) {
              existing.args += delta.partial_json;
            }
          }
          break;
        }

        case "message_delta": {
          // Message complete
          break;
        }

        case "message_stop": {
          break;
        }
      }
    } catch {
      // skip malformed JSON
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      processLine(line);
    }
  }

  // Flush a trailing data line left in the buffer when the stream ends
  // without a final newline.
  if (buffer.trim()) {
    processLine(buffer);
  }

  const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.args);
    } catch {
      // pass
    }
    return { id: tc.id, name: tc.name, args };
  });

  if (toolCalls.length > 0) {
    callbacks.onToolCall(toolCalls);
  }

  callbacks.onDone(fullContent, toolCalls, reasoningContent || undefined);
}

export async function streamAnthropic(
  config: ProviderConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  callbacks: StreamCallbacks,
  systemPrompt?: string,
  signal?: AbortSignal,
): Promise<void> {
  const url = resolveLLMEndpoint(config.baseUrl, config.provider, "chat");

  const body: Record<string, unknown> = {
    model: config.model,
    messages: toAnthropicMessages(messages),
    max_tokens: config.maxTokens ?? 8192,
    stream: true,
  };

  if (config.temperature !== undefined) {
    body.temperature = config.temperature;
  }

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  if (tools.length > 0) {
    body.tools = toAnthropicTools(tools);
  }

  const response = await fetchWithMode(url, {
    body,
    headers: createLLMHeaders(config.provider, config.apiKey),
    signal,
    requestMode: config.requestMode,
  });

  await streamAnthropicFromResponse(response, callbacks);
}
