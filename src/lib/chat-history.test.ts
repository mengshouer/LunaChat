import { describe, it, expect } from "vitest";
import type { Message } from "./db";
import type { Attachment } from "./attachments";
import { textBlocks, blocksToText } from "./content-blocks";
import { buildHistory, normalizeHistoryPath } from "./chat-history";

function msg(partial: Partial<Omit<Message, "content">> & { id: string; content?: string }): Message {
  const { content: rawContent, ...rest } = partial;
  return {
    threadId: "t1",
    role: "user",
    content: textBlocks(rawContent ?? ""),
    createdAt: 0,
    ...rest,
  };
}

function attachment(partial: Partial<Attachment> & { name: string }): Attachment {
  return {
    id: partial.name,
    kind: "file",
    url: "data:text/plain;base64,AAAA",
    mimeType: "text/plain",
    ...partial,
  };
}

describe("buildHistory attachment handling", () => {
  it("inlines non-image extractedText as a <file> block", () => {
    const path = [
      msg({
        id: "u1",
        content: "hi",
        attachments: [
          attachment({
            name: "notes.txt",
            mimeType: "text/plain",
            extractedText: "hello world",
          }),
        ],
      }),
    ];
    expect(buildHistory(path)[0].content).toBe(
      'hi\n\n<file name="notes.txt" type="text/plain">\nhello world\n</file>',
    );
  });

  it("marks a non-image attachment without extractedText as binary", () => {
    const path = [
      msg({
        id: "u1",
        content: "",
        attachments: [
          attachment({ name: "blob.bin", mimeType: "application/octet-stream" }),
        ],
      }),
    ];
    expect(buildHistory(path)[0].content).toBe(
      '<file name="blob.bin" type="application/octet-stream">[binary file — content not available]</file>',
    );
  });

  it("routes images and PDFs into attachments, not content", () => {
    const path = [
      msg({
        id: "u1",
        content: "look",
        attachments: [
          attachment({
            name: "pic.png",
            mimeType: "image/png",
            url: "data:image/png;base64,IMG",
          }),
          attachment({
            name: "doc.pdf",
            mimeType: "application/pdf",
            url: "data:application/pdf;base64,PDF",
            extractedText: "pdf text",
          }),
        ],
      }),
    ];
    const built = buildHistory(path)[0];
    expect(built.attachments).toEqual([
      { url: "data:image/png;base64,IMG", mimeType: "image/png", name: "pic.png" },
      {
        url: "data:application/pdf;base64,PDF",
        mimeType: "application/pdf",
        name: "doc.pdf",
      },
    ]);
    // PDF is non-image, so its extractedText is still inlined into content
    expect(built.content).toContain('<file name="doc.pdf"');
  });

  it("omits the attachments field when there are none", () => {
    const built = buildHistory([msg({ id: "u1", content: "plain" })])[0];
    expect(built.content).toBe("plain");
    expect(built.attachments).toBeUndefined();
  });
});

function carrier(
  id: string,
  calls: { id: string; name: string }[],
  extra?: Partial<Omit<Message, "content">> & { content?: string },
): Message {
  return msg({
    id,
    role: "assistant",
    toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: {} })),
    ...extra,
  });
}

function tool(id: string, callId: string, extra?: Partial<Omit<Message, "content">> & { content?: string }): Message {
  return msg({
    id,
    role: "tool",
    toolCallId: callId,
    content: `result:${callId}`,
    name: "net_search",
    ...extra,
  });
}

describe("normalizeHistoryPath", () => {
  it("leaves correctly-ordered data unchanged (idempotent)", () => {
    const path = [
      msg({ id: "u1", role: "user" }),
      carrier("a1", [{ id: "tc1", name: "net_search" }]),
      tool("t1", "tc1"),
      msg({ id: "a2", role: "assistant", content: "final" }),
    ];
    expect(normalizeHistoryPath(path)).toEqual(path);
  });

  it("moves a legacy tool message to sit after its assistant carrier", () => {
    const path = [
      msg({ id: "u1", role: "user" }),
      tool("t1", "tc1"),
      carrier("a1", [{ id: "tc1", name: "net_search" }]),
      msg({ id: "a2", role: "assistant", content: "final" }),
    ];
    expect(normalizeHistoryPath(path).map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "t1",
      "a2",
    ]);
  });

  it("reorders multi-round legacy interleaving", () => {
    const path = [
      msg({ id: "u1", role: "user" }),
      tool("t1", "tc1"),
      tool("t2", "tc2"),
      carrier("a1", [{ id: "tc1", name: "net_search" }]),
      carrier("a2", [{ id: "tc2", name: "net_search" }]),
      msg({ id: "a3", role: "assistant", content: "final" }),
    ];
    expect(normalizeHistoryPath(path).map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "t1",
      "a2",
      "t2",
      "a3",
    ]);
  });

  it("synthesizes a stub result when a carrier's tool call has no result", () => {
    const path = [
      msg({ id: "u1", role: "user" }),
      carrier("a1", [{ id: "tc1", name: "net_search" }]),
    ];
    const out = normalizeHistoryPath(path);
    expect(out).toHaveLength(3);
    const stub = out[2];
    expect(stub.role).toBe("tool");
    expect(stub.toolCallId).toBe("tc1");
    expect(stub.name).toBe("net_search");
    expect(JSON.parse(blocksToText(stub.content))).toEqual({
      error: "Tool execution was interrupted",
    });
  });

  it("drops error assistant messages", () => {
    const path = [
      msg({ id: "u1", role: "user" }),
      msg({ id: "e1", role: "assistant", name: "error", content: "boom" }),
    ];
    expect(normalizeHistoryPath(path).map((m) => m.id)).toEqual(["u1"]);
  });

  it("drops an assistant message with blank content and no tool calls", () => {
    // A thinking-only partial persisted by Stop: reasoning but no content.
    const path = [
      msg({ id: "u1", role: "user", content: "hi" }),
      msg({
        id: "p1",
        role: "assistant",
        content: "",
        reasoningContent: "half a thought",
      }),
      msg({ id: "u2", role: "user", content: "go on" }),
    ];
    expect(normalizeHistoryPath(path).map((m) => m.id)).toEqual(["u1", "u2"]);
  });

  it("drops a whitespace-only assistant message", () => {
    const path = [
      msg({ id: "u1", role: "user", content: "hi" }),
      msg({ id: "p1", role: "assistant", content: "  \n\t " }),
    ];
    expect(normalizeHistoryPath(path).map((m) => m.id)).toEqual(["u1"]);
  });

  it("keeps an empty-content assistant carrier that has tool calls", () => {
    const path = [
      msg({ id: "u1", role: "user" }),
      carrier("a1", [{ id: "tc1", name: "net_search" }]),
      tool("t1", "tc1"),
    ];
    expect(normalizeHistoryPath(path).map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "t1",
    ]);
  });

  it("keeps an orphan tool message (no carrier) in place", () => {
    const path = [
      msg({ id: "u1", role: "user" }),
      tool("t1", "orphan"),
      msg({ id: "a1", role: "assistant", content: "hi" }),
    ];
    expect(normalizeHistoryPath(path).map((m) => m.id)).toEqual([
      "u1",
      "t1",
      "a1",
    ]);
  });
});

describe("buildHistory replay normalization", () => {
  it("excludes error messages from the built history", () => {
    const built = buildHistory([
      msg({ id: "u1", role: "user", content: "hi" }),
      msg({ id: "e1", role: "assistant", name: "error", content: "boom" }),
    ]);
    expect(built.map((m) => m.content)).toEqual(["hi"]);
  });
});
