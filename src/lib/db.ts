import Dexie, { type EntityTable } from "dexie";
import type { Attachment } from "./attachments";


export interface Thread {
  id: string;
  title: string;
  configId?: string;
  createdAt: number;
  updatedAt: number;
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
}

export interface ToolCallData {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

class ChatDB extends Dexie {
  threads!: EntityTable<Thread, "id">;
  messages!: EntityTable<Message, "id">;

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
  }
}

export const db = new ChatDB();

export async function createThread(
  id: string,
  title: string = "New Chat",
  configId?: string,
): Promise<Thread> {
  const now = Date.now();
  const thread: Thread = { id, title, createdAt: now, updatedAt: now, ...(configId ? { configId } : {}) };
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
  updates: Partial<Pick<Thread, "title" | "updatedAt" | "configId">>,
): Promise<void> {
  await db.threads.update(id, { ...updates, updatedAt: Date.now() });
}

export async function deleteThread(id: string): Promise<void> {
  await db.transaction("rw", [db.threads, db.messages], async () => {
    await db.messages.where("threadId").equals(id).delete();
    await db.threads.delete(id);
  });
}

export async function addMessage(message: Message): Promise<void> {
  await db.messages.add(message);
  await db.threads.update(message.threadId, { updatedAt: Date.now() });
}

export async function getMessages(threadId: string): Promise<Message[]> {
  return db.messages
    .where("[threadId+createdAt]")
    .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
    .toArray();
}

export async function deleteLastAssistantMessages(
  threadId: string,
): Promise<void> {
  const messages = await getMessages(threadId);
  const toDelete: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" || msg.role === "tool") {
      toDelete.push(msg.id);
    } else {
      break;
    }
  }
  if (toDelete.length > 0) {
    await db.messages.bulkDelete(toDelete);
  }
}

export async function deleteMessagesFrom(
  threadId: string,
  messageId: string,
): Promise<void> {
  const messages = await getMessages(threadId);
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;
  const toDelete = messages.slice(idx).map((m) => m.id);
  if (toDelete.length > 0) {
    await db.messages.bulkDelete(toDelete);
  }
}
