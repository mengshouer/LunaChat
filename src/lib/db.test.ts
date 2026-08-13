import { beforeEach, describe, expect, it } from "vitest";
import {
  addMessage,
  createThreadWithFirstMessage,
  db,
  deleteLastAssistantMessages,
  deleteThread,
  getMessages,
  type Message,
  type Thread,
} from "./db";

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return { id, title: id, createdAt: 1, updatedAt: 1, ...overrides };
}

function message(
  id: string,
  threadId: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    threadId,
    role: "user",
    content: id,
    createdAt: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  await db.open();
  await db.transaction("rw", [db.threads, db.messages], async () => {
    await db.threads.clear();
    await db.messages.clear();
  });
});

describe("addMessage", () => {
  it("binds the thread to a profile while appending the first message", async () => {
    await db.threads.add(thread("t1"));

    await addMessage(message("m1", "t1"), "profile-1");

    const stored = await db.threads.get("t1");
    expect(stored?.configId).toBe("profile-1");
    expect(stored?.activeLeafId).toBe("m1");
  });

  it("never rebinds a thread that already has a profile", async () => {
    await db.threads.add(thread("t1", { configId: "profile-1" }));

    await addMessage(message("m1", "t1"), "profile-2");

    expect((await db.threads.get("t1"))?.configId).toBe("profile-1");
  });

  it("leaves the binding alone when no profile is passed", async () => {
    await db.threads.add(thread("t1"));

    await addMessage(message("m1", "t1"));

    expect((await db.threads.get("t1"))?.configId).toBeUndefined();
  });

  it("rolls the message back when the thread is gone", async () => {
    await expect(addMessage(message("m1", "missing"), "profile-1")).rejects.toThrow(
      "Thread no longer exists",
    );

    expect(await db.messages.get("m1")).toBeUndefined();
  });

  it("keeps exactly one binding when two sends land together", async () => {
    await db.threads.add(thread("t1"));

    await Promise.all([
      addMessage(message("m1", "t1"), "profile-1"),
      addMessage(message("m2", "t1"), "profile-2"),
    ]);

    // Whichever transaction commits first owns the binding. What matters is
    // that the other one neither overwrites nor clears it, and that both
    // messages still land.
    expect(["profile-1", "profile-2"]).toContain(
      (await db.threads.get("t1"))?.configId,
    );
    expect(await db.messages.count()).toBe(2);
  });
});

describe("createThreadWithFirstMessage", () => {
  it("stores the thread pointing at its first message", async () => {
    await createThreadWithFirstMessage(thread("t1"), message("m1", "t1"));

    expect((await db.threads.get("t1"))?.activeLeafId).toBe("m1");
    expect((await getMessages("t1")).map((item) => item.id)).toEqual(["m1"]);
  });

  it("rejects a message that belongs to another thread", async () => {
    await expect(
      createThreadWithFirstMessage(thread("t1"), message("m1", "other")),
    ).rejects.toThrow("does not belong");

    expect(await db.threads.get("t1")).toBeUndefined();
  });

  it("rolls the message back when the thread id is taken", async () => {
    await db.threads.add(thread("t1"));

    await expect(
      createThreadWithFirstMessage(thread("t1"), message("m1", "t1")),
    ).rejects.toThrow();

    expect(await db.messages.get("m1")).toBeUndefined();
  });
});

describe("deleteLastAssistantMessages", () => {
  it("trims the trailing assistant and tool turn back to the user message", async () => {
    await db.threads.add(thread("t1", { activeLeafId: "a2" }));
    await db.messages.bulkAdd([
      message("u1", "t1", { createdAt: 1, parentId: null }),
      message("a1", "t1", { role: "assistant", createdAt: 2, parentId: "u1" }),
      message("tool1", "t1", { role: "tool", createdAt: 3, parentId: "a1" }),
      message("a2", "t1", { role: "assistant", createdAt: 4, parentId: "tool1" }),
    ]);

    await deleteLastAssistantMessages("t1");

    expect((await getMessages("t1")).map((item) => item.id)).toEqual(["u1"]);
    expect((await db.threads.get("t1"))?.activeLeafId).toBe("u1");
  });

  it("keeps messages on sibling branches", async () => {
    await db.threads.add(thread("t1", { activeLeafId: "a-kept" }));
    await db.messages.bulkAdd([
      message("u1", "t1", { createdAt: 1, parentId: null }),
      message("u2a", "t1", { createdAt: 2, parentId: "u1" }),
      message("a-other", "t1", {
        role: "assistant",
        createdAt: 3,
        parentId: "u2a",
      }),
      message("u2b", "t1", { createdAt: 4, parentId: "u1" }),
      message("a-kept", "t1", {
        role: "assistant",
        createdAt: 5,
        parentId: "u2b",
      }),
    ]);

    await deleteLastAssistantMessages("t1");

    expect((await getMessages("t1")).map((item) => item.id)).toEqual([
      "u1",
      "u2a",
      "a-other",
      "u2b",
    ]);
    expect((await db.threads.get("t1"))?.activeLeafId).toBe("u2b");
  });

  it("does nothing when the active branch ends on a user message", async () => {
    await db.threads.add(thread("t1", { activeLeafId: "u1" }));
    await db.messages.add(message("u1", "t1", { parentId: null }));

    await deleteLastAssistantMessages("t1");

    expect((await getMessages("t1")).map((item) => item.id)).toEqual(["u1"]);
    expect((await db.threads.get("t1"))?.activeLeafId).toBe("u1");
  });
});

describe("deleteThread", () => {
  it("removes the thread together with its messages only", async () => {
    await db.threads.bulkAdd([thread("t1"), thread("t2")]);
    await db.messages.bulkAdd([message("m1", "t1"), message("m2", "t2")]);

    await deleteThread("t1");

    expect(await db.threads.get("t1")).toBeUndefined();
    expect(await db.messages.get("m1")).toBeUndefined();
    expect(await db.messages.get("m2")).toBeDefined();
  });
});
