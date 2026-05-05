import type {
  ChatMessage,
  ProviderConfig,
  ToolCall,
  ToolDefinition,
  StreamCallbacks,
} from "../types";
import { parseSSEStream } from "../stream-parser";
import { fetchWithMode } from "../http";
import { resolveLLMEndpoint } from "../endpoints";
import { createLLMHeaders } from "../headers";

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | OpenAIContentPart[];
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  name?: string;
}

function toOpenAIMessages(
  messages: ChatMessage[],
  systemPrompt?: string,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  if (systemPrompt) {
    result.push({ role: "system", content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === "user") {
      // OpenAI only supports images via image_url; PDFs are handled via extracted text in content
      const imageParts: OpenAIContentPart[] = (msg.attachments ?? [])
        .filter((a) => a.mimeType.startsWith("image/"))
        .map((a) => ({
          type: "image_url" as const,
          image_url: { url: a.url },
        }));
      const parts: OpenAIContentPart[] = [
        ...imageParts,
        ...(msg.content ? [{ type: "text" as const, text: msg.content }] : []),
      ];
      result.push({
        role: "user",
        content: parts.length === 1 && parts[0].type === "text" ? msg.content : parts,
      });
    } else if (msg.role === "assistant") {
      const openaiMsg: OpenAIMessage = {
        role: "assistant",
        content: msg.content || null,
      };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        openaiMsg.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        }));
      }
      result.push(openaiMsg);
    } else if (msg.role === "tool") {
      result.push({
        role: "tool",
        content: msg.content,
        tool_call_id: msg.toolCallId,
        name: msg.name,
      });
    }
  }

  return result;
}

async function streamOpenAIFromResponse(
  response: Response,
  callbacks: StreamCallbacks,
): Promise<void> {
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok || contentType.includes("text/html")) {
    const errorText = await response.text();
    const message = errorText && errorText.trim().length > 0
      ? errorText
      : `OpenAI API error ${response.status}`;
    throw new Error(message);
  }

  const reader = response.body!.getReader();
  let fullContent = "";
  let reasoningContent = "";
  let insideThink = false;
  // Buffer for detecting partial <think> or </think> tags at chunk boundaries
  let tagBuffer = "";
  const toolCallsMap = new Map<
    number,
    { id: string; name: string; args: string }
  >();

  for await (const data of parseSSEStream(reader)) {
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;

      if (!delta) continue;

      // Support OpenAI-compatible reasoning fields (DeepSeek: reasoning_content, Ollama: reasoning)
      const thinkingToken = delta.reasoning_content || delta.reasoning;
      if (thinkingToken) {
        reasoningContent += thinkingToken;
        callbacks.onThinkingToken(thinkingToken);
      }

      if (delta.content) {
        // Parse <think> tags in streaming content
        let chunk = tagBuffer + delta.content;
        tagBuffer = "";

        while (chunk.length > 0) {
          if (insideThink) {
            const closeIdx = chunk.indexOf("</think>");
            if (closeIdx !== -1) {
              const thinkPart = chunk.slice(0, closeIdx);
              reasoningContent += thinkPart;
              callbacks.onThinkingToken(thinkPart);
              insideThink = false;
              chunk = chunk.slice(closeIdx + "</think>".length);
            } else {
              // Check for partial </think> at end
              if (chunk.length < "</think>".length && "</think>".startsWith(chunk)) {
                tagBuffer = chunk;
                chunk = "";
              } else {
                // Check if ends with partial tag
                let partialMatch = "";
                for (let i = 1; i < "</think>".length; i++) {
                  const tail = chunk.slice(-i);
                  if ("</think>".startsWith(tail)) {
                    partialMatch = tail;
                    break;
                  }
                }
                if (partialMatch) {
                  const safePart = chunk.slice(0, -partialMatch.length);
                  reasoningContent += safePart;
                  callbacks.onThinkingToken(safePart);
                  tagBuffer = partialMatch;
                } else {
                  reasoningContent += chunk;
                  callbacks.onThinkingToken(chunk);
                }
                chunk = "";
              }
            }
          } else {
            const openIdx = chunk.indexOf("<think>");
            if (openIdx !== -1) {
              const before = chunk.slice(0, openIdx);
              if (before) {
                fullContent += before;
                callbacks.onToken(before);
              }
              insideThink = true;
              chunk = chunk.slice(openIdx + "<think>".length);
            } else {
              // Check for partial <think> at end
              let partialMatch = "";
              for (let i = 1; i < "<think>".length; i++) {
                const tail = chunk.slice(-i);
                if ("<think>".startsWith(tail)) {
                  partialMatch = tail;
                  break;
                }
              }
              if (partialMatch) {
                const safePart = chunk.slice(0, -partialMatch.length);
                if (safePart) {
                  fullContent += safePart;
                  callbacks.onToken(safePart);
                }
                tagBuffer = partialMatch;
              } else {
                fullContent += chunk;
                callbacks.onToken(chunk);
              }
              chunk = "";
            }
          }
        }
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, {
              id: tc.id || "",
              name: tc.function?.name || "",
              args: "",
            });
          }
          const existing = toolCallsMap.get(idx)!;
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.args += tc.function.arguments;
        }
      }
    } catch {
      // skip malformed JSON lines
    }
  }

  // Flush any remaining tagBuffer
  if (tagBuffer) {
    if (insideThink) {
      reasoningContent += tagBuffer;
      callbacks.onThinkingToken(tagBuffer);
    } else {
      fullContent += tagBuffer;
      callbacks.onToken(tagBuffer);
    }
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

export async function streamOpenAI(
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
    messages: toOpenAIMessages(messages, systemPrompt),
    stream: true,
  };

  if (tools.length > 0) {
    body.tools = tools;
  }

  const response = await fetchWithMode(url, {
    body,
    headers: createLLMHeaders(config.provider, config.apiKey),
    signal,
    requestMode: config.requestMode,
  });

  await streamOpenAIFromResponse(response, callbacks);
}
