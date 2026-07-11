import { describe, it, expect } from "vitest";
import { createThinkTagParser, type ThinkSegment } from "./think-tag-parser";

// Feed a token stream through the parser and collapse adjacent same-type
// segments so assertions read like the logical text/thinking split.
function run(chunks: string[]): ThinkSegment[] {
  const parser = createThinkTagParser();
  const raw: ThinkSegment[] = [];
  for (const c of chunks) raw.push(...parser.push(c));
  raw.push(...parser.flush());
  const merged: ThinkSegment[] = [];
  for (const seg of raw) {
    if (!seg.value) continue;
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) last.value += seg.value;
    else merged.push({ ...seg });
  }
  return merged;
}

describe("createThinkTagParser", () => {
  it("splits text and thinking within a single chunk", () => {
    expect(run(["a<think>b</think>c"])).toEqual([
      { type: "text", value: "a" },
      { type: "thinking", value: "b" },
      { type: "text", value: "c" },
    ]);
  });

  it("handles an open tag split across chunks", () => {
    expect(run(["a<thi", "nk>b</think>c"])).toEqual([
      { type: "text", value: "a" },
      { type: "thinking", value: "b" },
      { type: "text", value: "c" },
    ]);
  });

  it("handles a close tag split across three chunks", () => {
    expect(run(["<think>reason", "<", "/think>answer"])).toEqual([
      { type: "thinking", value: "reason" },
      { type: "text", value: "answer" },
    ]);
  });

  it("flushes an unterminated thinking buffer as thinking", () => {
    expect(run(["<think>abc"])).toEqual([{ type: "thinking", value: "abc" }]);
  });

  it("flushes a dangling partial open tag as text", () => {
    // "<thi" looks like the start of <think> but the stream ends; the parser
    // emits "hello" during push and the buffered "<thi" on flush (merged here).
    expect(run(["hello<thi"])).toEqual([
      { type: "text", value: "hello<thi" },
    ]);
  });

  it("passes through plain text untouched", () => {
    expect(run(["just ", "plain ", "text"])).toEqual([
      { type: "text", value: "just plain text" },
    ]);
  });
});
