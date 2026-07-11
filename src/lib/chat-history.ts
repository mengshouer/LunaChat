import type { Message as DBMessage } from "./db";
import type { ChatMessage, ToolCall } from "./llm/types";
import type { Attachment } from "./attachments";

// Normalizes a persisted active-branch path into a valid LLM replay sequence:
//   1. Drops error messages (persisted assistant messages with name==="error")
//      so error text is never fed back to the model.
//   2. Reorders tolerated legacy data: a tool message is placed immediately
//      after the assistant message whose toolCalls claim its toolCallId, even
//      if it was persisted before that carrier (the pre-fix bug ordering).
//   3. Synthesizes a placeholder tool result when a carrier's tool call has no
//      matching tool message (e.g. the tool phase was interrupted by Stop).
//      OpenAI and Anthropic both reject a tool_use/tool_calls with no result.
// New correctly-ordered data passes through unchanged (idempotent). Orphan
// tool messages (no carrier) keep their original position.
export function normalizeHistoryPath(path: DBMessage[]): DBMessage[] {
  const filtered = path.filter(
    (m) => !(m.role === "assistant" && m.name === "error"),
  );

  // First tool message per toolCallId.
  const toolByCallId = new Map<string, DBMessage>();
  for (const m of filtered) {
    if (m.role === "tool" && m.toolCallId && !toolByCallId.has(m.toolCallId)) {
      toolByCallId.set(m.toolCallId, m);
    }
  }

  // toolCallIds claimed by some assistant carrier.
  const claimed = new Set<string>();
  for (const m of filtered) {
    if (m.role === "assistant" && m.toolCalls) {
      for (const tc of m.toolCalls) claimed.add(tc.id);
    }
  }

  const result: DBMessage[] = [];
  for (const m of filtered) {
    // A claimed tool message is emitted next to its carrier, not here.
    if (m.role === "tool" && m.toolCallId && claimed.has(m.toolCallId)) {
      continue;
    }
    result.push(m);
    if (m.role === "assistant" && m.toolCalls?.length) {
      for (const tc of m.toolCalls) {
        const toolMsg = toolByCallId.get(tc.id);
        result.push(
          toolMsg ?? {
            // Memory-only stub for replay; never written back to the DB.
            id: `${tc.id}-interrupted`,
            threadId: m.threadId,
            role: "tool",
            content: JSON.stringify({
              error: "Tool execution was interrupted",
            }),
            toolCallId: tc.id,
            name: tc.name,
            createdAt: m.createdAt,
            parentId: m.id,
          },
        );
      }
    }
  }
  return result;
}

// Inlines extracted text from non-image attachments into the message content.
// Images are handled as multimodal blocks in the provider layer.
export function buildLLMContent(
  content: string,
  nonImageAttachments?: Attachment[],
): string {
  if (!nonImageAttachments || nonImageAttachments.length === 0) return content;
  const sections = nonImageAttachments.map((a) => {
    if (a.extractedText) {
      return `<file name="${a.name}" type="${a.mimeType}">\n${a.extractedText}\n</file>`;
    }
    return `<file name="${a.name}" type="${a.mimeType}">[binary file — content not available]</file>`;
  });
  const block = sections.join("\n\n");
  return content ? `${content}\n\n${block}` : block;
}

// Builds LLM conversation history from the active branch path.
// - Images and PDFs go into ChatMessage.attachments for multimodal provider blocks.
// - Text/other files are inlined into content via buildLLMContent.
export function buildHistory(path: DBMessage[]): ChatMessage[] {
  return normalizeHistoryPath(path).map((m) => {
    const multimodalAttachments = (m.attachments ?? []).filter(
      (a) =>
        a.mimeType.startsWith("image/") || a.mimeType === "application/pdf",
    );
    // All non-image attachments get their extractedText inlined into content.
    // This covers PDFs (for OpenAI) and text files.
    const textAttachments = (m.attachments ?? []).filter(
      (a) => !a.mimeType.startsWith("image/"),
    );
    return {
      role: m.role,
      content: buildLLMContent(m.content, textAttachments),
      toolCalls: m.toolCalls as ToolCall[] | undefined,
      toolCallId: m.toolCallId,
      name: m.name,
      ...(multimodalAttachments.length > 0
        ? {
            attachments: multimodalAttachments.map((a) => ({
              url: a.url,
              mimeType: a.mimeType,
              name: a.name,
            })),
          }
        : {}),
    };
  });
}
