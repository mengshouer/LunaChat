import { db, type Thread, type Message } from "./db";
import { chainByCreation } from "./message-tree";

const CONFIGS_STORAGE_KEY = "chat-app-configs";

interface ConfigsData {
  profiles: Array<Record<string, unknown>>;
  activeProfileId: string | null;
}

export interface ExportData {
  version: 1;
  exportedAt: string;
  configs: ConfigsData;
  chatData?: {
    threads: Thread[];
    messages: Message[];
  };
}

export async function exportData(
  includeChatData: boolean,
): Promise<ExportData> {
  const raw = localStorage.getItem(CONFIGS_STORAGE_KEY);
  const configs: ConfigsData = raw
    ? JSON.parse(raw)
    : { profiles: [], activeProfileId: null };

  const result: ExportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    configs,
  };

  if (includeChatData) {
    const threads = await db.threads.toArray();
    const messages = await db.messages.toArray();
    result.chatData = { threads, messages };
  }

  return result;
}

export function downloadJson(data: ExportData, includeChatData: boolean): void {
  const date = new Date().toISOString().slice(0, 10);
  const filename = includeChatData
    ? `chat-backup-${date}.json`
    : `chat-config-${date}.json`;

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readImportFile(file: File): Promise<ExportData> {
  const text = await file.text();
  const data = JSON.parse(text) as ExportData;

  if (data.version !== 1) {
    throw new Error(`Unsupported export version: ${data.version}`);
  }
  if (!data.configs?.profiles || !Array.isArray(data.configs.profiles)) {
    throw new Error("Invalid export file: missing profiles");
  }

  return data;
}

export async function applyImport(
  data: ExportData,
): Promise<{ profileCount: number; threadCount: number }> {
  // Merge profiles
  const raw = localStorage.getItem(CONFIGS_STORAGE_KEY);
  const existing: ConfigsData = raw
    ? JSON.parse(raw)
    : { profiles: [], activeProfileId: null };

  const existingIds = new Set(existing.profiles.map((p) => p.id as string));
  let addedProfiles = 0;

  for (const profile of data.configs.profiles) {
    if (!existingIds.has(profile.id as string)) {
      existing.profiles.push(profile);
      addedProfiles++;
    }
  }

  // If no active profile yet, use the imported one
  if (!existing.activeProfileId && data.configs.activeProfileId) {
    existing.activeProfileId = data.configs.activeProfileId;
  }

  localStorage.setItem(CONFIGS_STORAGE_KEY, JSON.stringify(existing));

  // Merge chat data
  let addedThreads = 0;
  if (data.chatData) {
    const existingThreadIds = new Set(
      (await db.threads.toArray()).map((t) => t.id),
    );
    const existingMessageIds = new Set(
      (await db.messages.toArray()).map((m) => m.id),
    );

    const newThreads = data.chatData.threads.filter(
      (t) => !existingThreadIds.has(t.id),
    );
    const newMessages = data.chatData.messages.filter(
      (m) => !existingMessageIds.has(m.id),
    );

    // Legacy exports (pre-branching) have no parentId on messages: chain
    // each newly imported thread linearly and point it at its last message.
    const msgsByThread = new Map<string, Message[]>();
    for (const m of newMessages) {
      const list = msgsByThread.get(m.threadId);
      if (list) list.push(m);
      else msgsByThread.set(m.threadId, [m]);
    }
    for (const t of newThreads) {
      const list = msgsByThread.get(t.id);
      if (!list || list.length === 0) continue;
      if (list.some((m) => m.parentId !== undefined)) continue;
      const chained = chainByCreation(list);
      if (!t.activeLeafId) {
        t.activeLeafId = chained[chained.length - 1].id;
      }
    }

    if (newThreads.length > 0) {
      await db.threads.bulkAdd(newThreads);
    }
    if (newMessages.length > 0) {
      await db.messages.bulkAdd(newMessages);
    }
    addedThreads = newThreads.length;
  }

  return { profileCount: addedProfiles, threadCount: addedThreads };
}

export async function resetAllData(): Promise<void> {
  localStorage.removeItem(CONFIGS_STORAGE_KEY);
  await db.threads.clear();
  await db.messages.clear();
}
