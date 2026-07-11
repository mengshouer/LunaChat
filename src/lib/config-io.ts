import { db, type Thread, type Message } from "./db";
import { chainByCreation } from "./message-tree";
import { encryptJson, decryptJson } from "./crypto";
import type { ConfigProfile } from "@/providers/SettingsProvider";

const CONFIGS_STORAGE_KEY = "chat-app-configs";

const KEY_FIELDS = ["apiKey", "exaApiKey", "tavilyApiKey"] as const;

interface ConfigsData {
  profiles: Array<Record<string, unknown>>;
  activeProfileId: string | null;
}

// Plaintext key values live only in SettingsProvider state (localStorage may
// hold ciphertext), so exports take the provider's in-memory snapshot.
export interface ConfigsSnapshot {
  profiles: ConfigProfile[];
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

// Whole-file encrypted backup; payload decrypts to an ExportData JSON.
// Self-contained: fresh salt per export, passphrase asked at export time.
export interface EncryptedExportFile {
  version: 1;
  encrypted: true;
  exportedAt: string;
  salt: string;
  payload: string;
}

export function isEncryptedExportFile(
  data: ExportData | EncryptedExportFile,
): data is EncryptedExportFile {
  return (data as EncryptedExportFile).encrypted === true;
}

async function collectExportData(
  includeChatData: boolean,
  configs: ConfigsSnapshot,
): Promise<ExportData> {
  const result: ExportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    configs: {
      profiles: configs.profiles.map((p) => ({ ...p })),
      activeProfileId: configs.activeProfileId,
    },
  };

  if (includeChatData) {
    const threads = await db.threads.toArray();
    const messages = await db.messages.toArray();
    result.chatData = { threads, messages };
  }

  return result;
}

// Plain export for sharing: API keys are stripped entirely.
export async function exportPlainWithoutKeys(
  includeChatData: boolean,
  configs: ConfigsSnapshot,
): Promise<ExportData> {
  const data = await collectExportData(includeChatData, configs);
  for (const profile of data.configs.profiles) {
    for (const field of KEY_FIELDS) {
      profile[field] = "";
    }
  }
  return data;
}

// Encrypted backup: full data (keys included) encrypted as a whole file.
// Requires plaintext keys in the snapshot — callers must ensure the keys
// are unlocked when at-rest encryption is enabled.
export async function exportEncrypted(
  includeChatData: boolean,
  configs: ConfigsSnapshot,
  passphrase: string,
): Promise<EncryptedExportFile> {
  const data = await collectExportData(includeChatData, configs);
  const { salt, payload } = await encryptJson(passphrase, data);
  return {
    version: 1,
    encrypted: true,
    exportedAt: data.exportedAt,
    salt,
    payload,
  };
}

export function downloadJson(
  data: ExportData | EncryptedExportFile,
  includeChatData: boolean,
): void {
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

function validateExportData(data: ExportData): ExportData {
  if (data.version !== 1) {
    throw new Error(`Unsupported export version: ${data.version}`);
  }
  if (!data.configs?.profiles || !Array.isArray(data.configs.profiles)) {
    throw new Error("Invalid export file: missing profiles");
  }
  return data;
}

// Returns the parsed file; encrypted files still need decryptExportFile.
export async function readImportFile(
  file: File,
): Promise<ExportData | EncryptedExportFile> {
  const text = await file.text();
  const data = JSON.parse(text) as ExportData | EncryptedExportFile;

  if (isEncryptedExportFile(data)) {
    if (typeof data.salt !== "string" || typeof data.payload !== "string") {
      throw new Error("Invalid encrypted export file");
    }
    return data;
  }

  return validateExportData(data);
}

export async function decryptExportFile(
  file: EncryptedExportFile,
  passphrase: string,
): Promise<ExportData> {
  const data = await decryptJson<ExportData>(passphrase, file.salt, file.payload);
  return validateExportData(data);
}

export async function applyImport(
  data: ExportData,
  // Encrypts a key field the way the active settings would store it
  // (identity when at-rest encryption is off). applyImport writes
  // localStorage directly, bypassing SettingsProvider.persist.
  encryptKeyField: (value: string) => Promise<string>,
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
      const stored = { ...profile };
      for (const field of KEY_FIELDS) {
        const value = stored[field];
        if (typeof value === "string" && value) {
          stored[field] = await encryptKeyField(value);
        }
      }
      existing.profiles.push(stored);
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
