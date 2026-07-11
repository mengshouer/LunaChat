import type { ChatMessage, ToolCall, ProviderConfig, StreamCallbacks } from "./llm/types";
import type { ToolRegistry, ToolContext } from "./tools/registry";
import { getLLMClient } from "./llm/providers";

const MAX_ITERATIONS = 10;

export interface ReactLoopCallbacks {
  onToken: (token: string) => void;
  onThinkingToken: (token: string) => void;
  onToolCallStart: (toolCalls: ToolCall[]) => void;
  // Called after each iteration's stream ends, BEFORE its tools run. The
  // caller awaits it to persist the assistant message first, so the DB
  // parentId chain stays ordered assistant → tool → next assistant.
  onAssistantMessage: (msg: ChatMessage) => Promise<void>;
  onToolResult: (toolCallId: string, name: string, result: string) => Promise<void>;
  onDone: (finalContent: string, reasoningContent?: string) => void;
}

export async function runReactLoop(
  config: ProviderConfig,
  messages: ChatMessage[],
  toolRegistry: ToolRegistry,
  toolContext: ToolContext,
  systemPrompt: string,
  callbacks: ReactLoopCallbacks,
  signal?: AbortSignal,
): Promise<{
  assistantMessages: ChatMessage[];
  toolMessages: ChatMessage[];
}> {
  const assistantMessages: ChatMessage[] = [];
  const toolMessages: ChatMessage[] = [];
  const conversationMessages = [...messages];

  const client = getLLMClient(config.provider);
  const streamFn = client.stream;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    let iterContent = "";
    let iterToolCalls: ToolCall[] = [];
    let iterReasoningContent: string | undefined;
    // Per-iteration thinking window: first thinking token → first content
    // token (or stream end), so tool execution time is never included.
    let thinkingStart: number | null = null;
    let thinkingEnd: number | null = null;

    await streamFn(
      config,
      conversationMessages,
      toolRegistry.definitions,
      {
        onToken: (token) => {
          if (thinkingStart !== null && thinkingEnd === null) {
            thinkingEnd = Date.now();
          }
          iterContent += token;
          callbacks.onToken(token);
        },
        onThinkingToken: (token) => {
          if (thinkingStart === null) {
            thinkingStart = Date.now();
          }
          callbacks.onThinkingToken(token);
        },
        onToolCall: (tcs) => {
          iterToolCalls = tcs;
          callbacks.onToolCallStart(tcs);
        },
        onDone: (content, toolCalls, reasoningContent) => {
          if (thinkingStart !== null && thinkingEnd === null) {
            thinkingEnd = Date.now();
          }
          iterContent = content;
          iterToolCalls = toolCalls;
          iterReasoningContent = reasoningContent;
        },
      } satisfies StreamCallbacks,
      systemPrompt,
      signal,
    );

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: iterContent,
      toolCalls: iterToolCalls.length > 0 ? iterToolCalls : undefined,
      reasoningContent: iterReasoningContent,
      thinkingDuration:
        thinkingStart !== null && thinkingEnd !== null
          ? thinkingEnd - thinkingStart
          : undefined,
    };
    assistantMessages.push(assistantMsg);
    conversationMessages.push(assistantMsg);
    // Persist this iteration's assistant message before running its tools, so
    // the assistant carrier is stored ahead of its tool results.
    await callbacks.onAssistantMessage(assistantMsg);

    if (iterToolCalls.length === 0) {
      callbacks.onDone(iterContent, iterReasoningContent);
      return { assistantMessages, toolMessages };
    }

    // Execute tools
    for (const tc of iterToolCalls) {
      if (signal?.aborted) throw new Error("Aborted");

      let result: string;
      try {
        result = await toolRegistry.execute(tc, toolContext);
      } catch (err) {
        result = JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const toolMsg: ChatMessage = {
        role: "tool",
        content: result,
        toolCallId: tc.id,
        name: tc.name,
      };
      toolMessages.push(toolMsg);
      conversationMessages.push(toolMsg);
      // Await so the parentId chain in the caller is strictly ordered.
      await callbacks.onToolResult(tc.id, tc.name, result);
    }
  }

  const lastMsg = assistantMessages[assistantMessages.length - 1];
  callbacks.onDone(lastMsg?.content || "", lastMsg?.reasoningContent);
  return { assistantMessages, toolMessages };
}
