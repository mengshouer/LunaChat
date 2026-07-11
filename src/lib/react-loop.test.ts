import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessage, StreamCallbacks } from "./llm/types";
import type { ToolRegistry, ToolContext } from "./tools/registry";

// Scripted stream: iteration 0 returns a tool call, iteration 1 returns text.
const streamMock = vi.fn();

vi.mock("./llm/providers", () => ({
  getLLMClient: () => ({ stream: streamMock }),
}));

import { runReactLoop } from "./react-loop";

const config = {
  provider: "openai" as const,
  baseUrl: "https://x",
  apiKey: "k",
  model: "m",
};

const toolContext = {} as ToolContext;

function makeRegistry(events: string[]): ToolRegistry {
  return {
    definitions: [],
    execute: async (tc) => {
      events.push(`execute:${tc.id}`);
      return `result-for-${tc.id}`;
    },
  };
}

function baseCallbacks(events: string[]) {
  return {
    onToken: () => {},
    onThinkingToken: () => {},
    onToolCallStart: () => {},
    onAssistantMessage: async (msg: ChatMessage) => {
      events.push(`assistant:${msg.toolCalls ? "tool" : "text"}`);
    },
    onToolResult: async (id: string) => {
      events.push(`toolResult:${id}`);
    },
    onDone: () => {
      events.push("done");
    },
  };
}

beforeEach(() => {
  streamMock.mockReset();
});

describe("runReactLoop ordering", () => {
  it("persists the assistant carrier before executing its tools", async () => {
    let call = 0;
    streamMock.mockImplementation(
      async (_c, _m, _t, callbacks: StreamCallbacks) => {
        if (call++ === 0) {
          callbacks.onToolCall([{ id: "tc1", name: "net_search", args: {} }]);
          callbacks.onDone("", [{ id: "tc1", name: "net_search", args: {} }]);
        } else {
          callbacks.onDone("final answer", []);
        }
      },
    );

    const events: string[] = [];
    await runReactLoop(
      config,
      [],
      makeRegistry(events),
      toolContext,
      "sys",
      baseCallbacks(events),
    );

    expect(events).toEqual([
      "assistant:tool",
      "execute:tc1",
      "toolResult:tc1",
      "assistant:text",
      "done",
    ]);
  });

  it("awaits onAssistantMessage before running tools", async () => {
    let call = 0;
    streamMock.mockImplementation(
      async (_c, _m, _t, callbacks: StreamCallbacks) => {
        if (call++ === 0) {
          callbacks.onDone("", [{ id: "tc1", name: "net_search", args: {} }]);
        } else {
          callbacks.onDone("done", []);
        }
      },
    );

    const events: string[] = [];
    const cbs = baseCallbacks(events);
    cbs.onAssistantMessage = async (msg: ChatMessage) => {
      await new Promise((r) => setTimeout(r, 5));
      events.push(`persisted:${msg.toolCalls ? "tool" : "text"}`);
    };

    await runReactLoop(config, [], makeRegistry(events), toolContext, "sys", cbs);

    // The delayed persist must complete before the tool executes
    expect(events.indexOf("persisted:tool")).toBeLessThan(
      events.indexOf("execute:tc1"),
    );
  });

  it("throws immediately on an already-aborted signal without any callback", async () => {
    const controller = new AbortController();
    controller.abort();
    const events: string[] = [];

    await expect(
      runReactLoop(
        config,
        [],
        makeRegistry(events),
        toolContext,
        "sys",
        baseCallbacks(events),
        controller.signal,
      ),
    ).rejects.toThrow("Aborted");
    expect(events).toEqual([]);
    expect(streamMock).not.toHaveBeenCalled();
  });
});
