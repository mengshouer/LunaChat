import type { ContentBlock } from "./llm/types";

/** Create a simple text content block array from a plain string. */
export function textBlocks(text: string): ContentBlock[] {
  return [{ type: "text", text }];
}

/** Extract the combined text content from a ContentBlock array. */
export function blocksToText(blocks: ContentBlock[]): string {
  // Runtime guard: legacy messages may still have string content in IndexedDB
  if (typeof blocks === "string") return blocks as unknown as string;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Check if content blocks have any meaningful content (non-empty text or non-text blocks). */
export function hasContent(blocks: ContentBlock[]): boolean {
  if (typeof blocks === "string") return (blocks as unknown as string).length > 0;
  if (!Array.isArray(blocks)) return false;
  return blocks.some((b) => {
    if (b.type === "text") return b.text.length > 0;
    return true;
  });
}
