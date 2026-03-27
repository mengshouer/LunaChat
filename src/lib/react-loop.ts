import type { ChatMessage, ToolCall, ProviderConfig, StreamCallbacks } from "./llm/types";
import type { ToolRegistry, ToolContext } from "./tools/registry";
import { getLLMClient } from "./llm/providers";

const MAX_ITERATIONS = 10;

export interface ReactLoopCallbacks {
  onToken: (token: string) => void;
  onThinkingToken: (token: string) => void;
  onToolCallStart: (toolCalls: ToolCall[]) => void;
  onToolResult: (toolCallId: string, name: string, result: string) => void;
  onDone: (finalContent: string, reasoningContent?: string) => void;
  onError: (error: Error) => void;
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

    await streamFn(
      config,
      conversationMessages,
      toolRegistry.definitions,
      {
        onToken: (token) => {
          iterContent += token;
          callbacks.onToken(token);
        },
        onThinkingToken: (token) => {
          callbacks.onThinkingToken(token);
        },
        onToolCall: (tcs) => {
          iterToolCalls = tcs;
          callbacks.onToolCallStart(tcs);
        },
        onDone: (content, toolCalls, reasoningContent) => {
          iterContent = content;
          iterToolCalls = toolCalls;
          iterReasoningContent = reasoningContent;
        },
        onError: callbacks.onError,
      } satisfies StreamCallbacks,
      systemPrompt,
      signal,
    );

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: iterContent,
      toolCalls: iterToolCalls.length > 0 ? iterToolCalls : undefined,
    };
    // Attach reasoningContent to the message for the caller to use
    (assistantMsg as ChatMessage & { reasoningContent?: string }).reasoningContent = iterReasoningContent;
    assistantMessages.push(assistantMsg);
    conversationMessages.push(assistantMsg);

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
      callbacks.onToolResult(tc.id, tc.name, result);
    }
  }

  const lastMsg = assistantMessages[assistantMessages.length - 1];
  callbacks.onDone(
    lastMsg?.content || "",
    (lastMsg as ChatMessage & { reasoningContent?: string })?.reasoningContent,
  );
  return { assistantMessages, toolMessages };
}
