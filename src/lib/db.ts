import Dexie, { type EntityTable } from "dexie";
import type { Attachment } from "./attachments";
import { getActivePath, chainByCreation } from "./message-tree";
import type { AppConfigRecord } from "./settings-types";

export interface Thread {
  id: string;
  title: string;
  configId?: string;
  // Explicit per-thread runtime choice. Missing means use the profile default.
  searchEnabled?: boolean;
  createdAt: number;
  updatedAt: number;
  // Last message id of the active branch (message tree via Message.parentId)
  activeLeafId?: string;
}

export interface Message {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCallData[];
  toolCallId?: string;
  name?: string;
  createdAt: number;
  attachments?: Attachment[];
  reasoningContent?: string;
  thinkingDuration?: number;
  // Previous message on the same branch; null/undefined = root.
  // Sibling user messages (same parentId) are alternative branches.
  parentId?: string | null;
}

export interface ToolCallData {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

class ChatDB extends Dexie {
  threads!: EntityTable<Thread, "id">;
  messages!: EntityTable<Message, "id">;
  appConfig!: EntityTable<AppConfigRecord, "id">;

  constructor() {
    super("chat-app-db");
    this.version(1).stores({
      threads: "id, createdAt, updatedAt",
      messages: "id, threadId, [threadId+createdAt], createdAt",
    });
    this.version(2).stores({});
    this.version(3).stores({
      threads: "id, configId, createdAt, updatedAt",
    });
    // v4: message branching — chain existing linear threads via parentId
    // (createdAt order) and point each thread at its current leaf.
    this.version(4)
      .stores({})
      .upgrade(async (tx) => {
        const messages = (await tx.table("messages").toArray()) as Message[];
        const byThread = new Map<string, Message[]>();
        for (const m of messages) {
          const list = byThread.get(m.threadId);
          if (list) list.push(m);
          else byThread.set(m.threadId, [m]);
        }
        for (const [threadId, list] of byThread) {
          const chained = chainByCreation(list);
          await tx.table("messages").bulkPut(chained);
          await tx.table("threads").update(threadId, {
            activeLeafId: chained[chained.length - 1].id,
          });
        }
      });
    // v5: move profiles/config/encryption metadata into the same database so
    // config restore and chat import can share one transaction.
    this.version(5).stores({
      appConfig: "id",
    });
  }
}

export const db = new ChatDB();

export async function createThread(
  id: string,
  title: string = "New Chat",
  configId?: string,
): Promise<Thread> {
  const now = Date.now();
  const thread: Thread = {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    ...(configId ? { configId } : {}),
  };
  await db.threads.add(thread);
  return thread;
}

export async function listThreads(): Promise<Thread[]> {
  return db.threads.orderBy("updatedAt").reverse().toArray();
}

export async function getThread(id: string): Promise<Thread | undefined> {
  return db.threads.get(id);
}

export async function updateThread(
  id: string,
  updates: Partial<
    Pick<
      Thread,
      "title" | "updatedAt" | "configId" | "activeLeafId" | "searchEnabled"
    >
  >,
): Promise<void> {
  await db.threads.update(id, { ...updates, updatedAt: Date.now() });
}

export async function setThreadConfigId(
  threadId: string,
  configId: string,
): Promise<void> {
  await db.threads.update(threadId, { configId });
}

export async function setThreadSearchEnabled(
  threadId: string,
  searchEnabled: boolean,
): Promise<void> {
  await db.threads.update(threadId, { searchEnabled });
}

// Move the active branch pointer without bumping updatedAt, so switching
// branches does not reorder the (updatedAt-sorted) thread list.
export async function setActiveLeaf(
  threadId: string,
  leafId: string,
): Promise<void> {
  await db.threads.update(threadId, { activeLeafId: leafId });
}

export async function deleteThread(id: string): Promise<void> {
  await db.transaction("rw", [db.threads, db.messages], async () => {
    await db.messages.where("threadId").equals(id).delete();
    await db.threads.delete(id);
  });
}

// `bindConfigId` binds the thread to a profile as part of appending its first
// message. Both the "is it still unbound?" check and the write happen inside
// the message transaction, so two concurrent first sends cannot each decide
// they are the one doing the binding, and a failed message append cannot leave
// a thread bound to a profile it never used.
export async function addMessage(
  message: Message,
  bindConfigId?: string,
): Promise<void> {
  await db.transaction("rw", [db.threads, db.messages], async () => {
    const thread = await db.threads.get(message.threadId);
    if (!thread) throw new Error("Thread no longer exists");
    await db.messages.add(message);
    // Every message is appended at the end of the active branch, so it always
    // becomes the new active leaf.
    await db.threads.update(message.threadId, {
      updatedAt: Date.now(),
      activeLeafId: message.id,
      ...(bindConfigId && !thread.configId ? { configId: bindConfigId } : {}),
    });
  });
}

export async function createThreadWithFirstMessage(
  thread: Thread,
  message: Message,
): Promise<void> {
  if (thread.id !== message.threadId) {
    throw new Error("First message does not belong to the thread");
  }
  await db.transaction("rw", [db.threads, db.messages], async () => {
    await db.threads.add({ ...thread, activeLeafId: message.id });
    await db.messages.add(message);
  });
}

export async function getMessages(threadId: string): Promise<Message[]> {
  return db.messages
    .where("[threadId+createdAt]")
    .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
    .toArray();
}

// Delete the trailing assistant/tool messages of the ACTIVE branch only.
// Branches fork exclusively at user messages, so this trailing segment never
// has children on other branches — deleting it cannot orphan sibling branches.
export async function deleteLastAssistantMessages(
  threadId: string,
): Promise<void> {
  await db.transaction("rw", [db.threads, db.messages], async () => {
    const [messages, thread] = await Promise.all([
      getMessages(threadId),
      getThread(threadId),
    ]);
    const path = getActivePath(messages, thread?.activeLeafId);
    const toDelete: string[] = [];
    for (let i = path.length - 1; i >= 0; i--) {
      const msg = path[i];
      if (msg.role === "assistant" || msg.role === "tool") {
        toDelete.push(msg.id);
      } else {
        break;
      }
    }
    if (toDelete.length === 0) return;
    const newLeaf = path[path.length - toDelete.length - 1];
    await db.messages.bulkDelete(toDelete);
    await db.threads.update(threadId, {
      updatedAt: Date.now(),
      activeLeafId: newLeaf?.id,
    });
  });
}

// Create a new thread containing a copy of a conversation path
// (used by "fork to new thread" on an assistant message).
export async function forkThread(
  thread: Thread,
  messages: Message[],
): Promise<void> {
  await db.transaction("rw", [db.threads, db.messages], async () => {
    await db.threads.add(thread);
    await db.messages.bulkAdd(messages);
  });
}
