import type { Message } from "@/lib/db";
import type { ToolCall } from "@/lib/llm/types";
import { CommandBar } from "./shared";
import { MarkdownText } from "../markdown-text";
import { ToolCalls, ToolResult } from "./tool-calls";
import { ThinkingBlock } from "./thinking-block";
import { cn } from "@/lib/utils";

export function AssistantMessage({
  message,
  isLoading,
  isLastMessage,
  handleRegenerate,
  handleFork,
  hideToolCalls,
  toolResultByCallId,
}: {
  message: Message;
  isLoading: boolean;
  isLastMessage: boolean;
  handleRegenerate: () => void;
  handleFork?: () => void;
  hideToolCalls: boolean;
  toolResultByCallId?: Record<string, Message>;
}) {
  const isToolResult = message.role === "tool";

  if (isToolResult && hideToolCalls) {
    return null;
  }

  if (isToolResult) {
    return (
      <div className="flex items-start mr-auto gap-2 group">
        <ToolResult message={message} />
      </div>
    );
  }

  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
  const isErrorMessage = message.name === "error";

  // Tool-call-only step: nothing visible remains when tools are hidden,
  // so skip entirely instead of leaving an empty block in the gap-4 list.
  if (
    hideToolCalls &&
    hasToolCalls &&
    !message.content &&
    !message.reasoningContent
  ) {
    return null;
  }

  return (
    <div className="flex items-start mr-auto gap-2 group min-w-0 max-w-full">
      <div className="flex flex-col gap-2 min-w-0 max-w-full break-words">
        {message.reasoningContent && (
          <ThinkingBlock
            content={message.reasoningContent}
            isStreaming={false}
            duration={message.thinkingDuration}
          />
        )}
        {message.content && message.content.length > 0 && (
          <div className="py-1 max-w-full break-words">
            {isErrorMessage ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-3 py-2 text-sm">
                <MarkdownText>{message.content}</MarkdownText>
              </div>
            ) : (
              <MarkdownText>{message.content}</MarkdownText>
            )}
          </div>
        )}
        {(!message.content || message.content.length === 0) &&
          !hasToolCalls && (
            <div className="py-1">
              <MarkdownText>{"**Error:** Unknown error"}</MarkdownText>
            </div>
          )}

        {!hideToolCalls && hasToolCalls && (
          <ToolCalls
            toolCalls={message.toolCalls!}
            resultsById={toolResultByCallId}
          />
        )}

        {/* A message carrying toolCalls is an intermediate ReAct step — the
            reply continues in a later assistant message, so offering
            copy/fork/regenerate here would act on an unfinished reply. */}
        {!hasToolCalls && (
          <div
            className={cn(
              "flex gap-2 items-center mr-auto transition-opacity",
              "can-hover:opacity-0 group-focus-within:opacity-100 can-hover:group-hover:opacity-100",
            )}
          >
            <CommandBar
              content={message.content}
              isLoading={isLoading}
              isAiMessage={true}
              handleRegenerate={isLastMessage ? handleRegenerate : undefined}
              handleFork={handleFork}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function AssistantMessageLoading() {
  return (
    <div className="flex items-start mr-auto gap-2">
      <div className="flex items-center gap-1 rounded-2xl bg-muted px-4 py-2 h-8">
        <div className="w-1.5 h-1.5 rounded-full bg-foreground/50 animate-[pulse_1.5s_ease-in-out_infinite]"></div>
        <div className="w-1.5 h-1.5 rounded-full bg-foreground/50 animate-[pulse_1.5s_ease-in-out_0.5s_infinite]"></div>
        <div className="w-1.5 h-1.5 rounded-full bg-foreground/50 animate-[pulse_1.5s_ease-in-out_1s_infinite]"></div>
      </div>
    </div>
  );
}

export function StreamingMessage({
  content,
  toolCalls,
  thinkingContent,
  thinkingStartTime,
}: {
  content: string;
  toolCalls: ToolCall[];
  thinkingContent?: string;
  thinkingStartTime?: number | null;
}) {
  return (
    <div className="flex items-start mr-auto gap-2">
      <div className="flex flex-col gap-2">
        {(thinkingContent || thinkingStartTime) && (
          <ThinkingBlock
            content={thinkingContent || ""}
            isStreaming={true}
            startTime={thinkingStartTime}
          />
        )}
        {content && (
          <div className="py-1">
            <MarkdownText>{content}</MarkdownText>
          </div>
        )}
        {toolCalls.length > 0 && <ToolCalls toolCalls={toolCalls} />}
      </div>
    </div>
  );
}
