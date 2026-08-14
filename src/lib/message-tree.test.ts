import { describe, it, expect } from "vitest";
import type { Message } from "./db";
import { textBlocks } from "./content-blocks";
import {
  chainByCreation,
  getActivePath,
  getSiblings,
  findLatestLeaf,
} from "./message-tree";

function msg(partial: Partial<Message> & { id: string }): Message {
  return {
    threadId: "t1",
    role: "user",
    content: textBlocks(partial.id),
    createdAt: 0,
    ...partial,
  };
}

describe("getActivePath", () => {
  it("walks from the active leaf up to the root in chronological order", () => {
    const all = [
      msg({ id: "u1", createdAt: 1 }),
      msg({ id: "a1", role: "assistant", createdAt: 2, parentId: "u1" }),
      msg({ id: "u2", createdAt: 3, parentId: "a1" }),
      msg({ id: "u2b", createdAt: 5, parentId: "a1" }),
      msg({ id: "a2", role: "assistant", createdAt: 4, parentId: "u2" }),
    ];
    expect(getActivePath(all, "a2").map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "u2",
      "a2",
    ]);
  });

  it("falls back to the newest message as leaf when activeLeafId is missing or stale", () => {
    const all = [
      msg({ id: "u1", createdAt: 1 }),
      msg({ id: "a1", role: "assistant", createdAt: 2, parentId: "u1" }),
      msg({ id: "u2b", createdAt: 5, parentId: "a1" }),
    ];
    expect(getActivePath(all).map((m) => m.id)).toEqual(["u1", "a1", "u2b"]);
    expect(getActivePath(all, "missing").map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "u2b",
    ]);
  });

  it("breaks createdAt ties by id when picking the fallback leaf", () => {
    const all = [
      msg({ id: "a", createdAt: 1 }),
      msg({ id: "b", createdAt: 1, parentId: "a" }),
      msg({ id: "c", createdAt: 1, parentId: "a" }),
    ];
    expect(getActivePath(all).map((m) => m.id)).toEqual(["a", "c"]);
  });

  it("returns empty for empty input", () => {
    expect(getActivePath([], "x")).toEqual([]);
  });
});

describe("getSiblings", () => {
  it("returns same-parent same-role messages sorted by creation, including self", () => {
    const u2 = msg({ id: "u2", createdAt: 3, parentId: "a1" });
    const all = [
      msg({ id: "u1", createdAt: 1 }),
      msg({ id: "a1", role: "assistant", createdAt: 2, parentId: "u1" }),
      u2,
      msg({ id: "u2b", createdAt: 5, parentId: "a1" }),
      msg({ id: "t1", role: "tool", createdAt: 4, parentId: "a1" }),
    ];
    expect(getSiblings(all, u2).map((m) => m.id)).toEqual(["u2", "u2b"]);
  });

  it("treats null and undefined parentId as the same root", () => {
    const r1 = msg({ id: "r1", createdAt: 1, parentId: null });
    const all = [r1, msg({ id: "r2", createdAt: 2 })];
    expect(getSiblings(all, r1).map((m) => m.id)).toEqual(["r1", "r2"]);
  });
});

describe("findLatestLeaf", () => {
  it("descends picking the most recently created child at each level", () => {
    const all = [
      msg({ id: "u1", createdAt: 1 }),
      msg({ id: "a1", role: "assistant", createdAt: 2, parentId: "u1" }),
      msg({ id: "a1b", role: "assistant", createdAt: 6, parentId: "u1" }),
      msg({ id: "u2", createdAt: 7, parentId: "a1b" }),
    ];
    expect(findLatestLeaf(all, "u1")).toBe("u2");
  });

  it("returns the node itself when it has no children", () => {
    const all = [msg({ id: "u1", createdAt: 1 })];
    expect(findLatestLeaf(all, "u1")).toBe("u1");
  });
});

describe("chainByCreation", () => {
  it("sorts by creation (id tiebreak) and chains parentIds", () => {
    const list = [
      msg({ id: "c", createdAt: 3 }),
      msg({ id: "a", createdAt: 1 }),
      msg({ id: "b", createdAt: 2 }),
    ];
    const chained = chainByCreation(list);
    expect(chained.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(chained.map((m) => m.parentId)).toEqual([null, "a", "b"]);
  });
});
