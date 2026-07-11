import { describe, it, expect } from "vitest";
import { parseSSEStream } from "./stream-parser";

function readerFrom(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }).getReader();
}

async function collect(chunks: string[]): Promise<string[]> {
  const out: string[] = [];
  for await (const data of parseSSEStream(readerFrom(chunks))) {
    out.push(data);
  }
  return out;
}

describe("parseSSEStream", () => {
  it("reassembles data lines split across chunks", async () => {
    expect(await collect(["data: he", "llo\ndata: world\n"])).toEqual([
      "hello",
      "world",
    ]);
  });

  it("ignores non-data lines and stops at [DONE]", async () => {
    expect(
      await collect(["event: x\ndata: a\n\ndata: [DONE]\ndata: b\n"]),
    ).toEqual(["a"]);
  });

  it("flushes a trailing data line when the stream ends without a newline", async () => {
    expect(await collect(["data: a\ndata: tail"])).toEqual(["a", "tail"]);
  });

  it("does not flush a trailing [DONE]", async () => {
    expect(await collect(["data: a\ndata: [DONE]"])).toEqual(["a"]);
  });
});
