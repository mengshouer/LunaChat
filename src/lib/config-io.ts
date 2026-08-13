import { db, type Message, type Thread } from "./db";
import { chainByCreation } from "./message-tree";
import { decryptJson, encryptJson, isEncrypted } from "./crypto";
import {
  normalizeProfile,
  type AppConfigRecord,
  type ConfigProfile,
} from "./settings-types";
import { setAccessToken } from "./access-token";

const KEY_FIELDS = ["apiKey", "exaApiKey", "tavilyApiKey"] as const;
const PROFILE_STRING_FIELDS = [
  "baseUrl",
  "apiKey",
  "model",
  "exaApiKey",
  "exaBaseUrl",
  "tavilyApiKey",
  "tavilyBaseUrl",
  "systemPrompt",
] as const;

interface ConfigsData {
  profiles: Array<Record<string, unknown>>;
  activeProfileId: string | null;
}

export interface ConfigsSnapshot {
  profiles: ConfigProfile[];
  activeProfileId: string | null;
}

// How an import file wants to be applied. This is the file's own declaration,
// not something inferred at import time from which optional fields happen to
// be present — inferring it wrong would delete profiles.
//   "backup"  full restore: profiles are replaced by the file's set.
//   "config"  share/add: the file's profiles are merged in by id, local
//             profiles are never touched.
// Only exportEncrypted produces "backup", so a keyless file someone sent you
// can never wipe your API keys.
export type ImportMode = "backup" | "config";

export interface ExportData {
  version: 2;
  mode: ImportMode;
  exportedAt: string;
  configs: ConfigsData;
  chatData?: {
    threads: Thread[];
    messages: Message[];
  };
}

// Envelope around an encrypted ExportData payload. Its version tracks the
// envelope shape (encrypted/salt/payload), not the payload's version.
export interface EncryptedExportFile {
  version: 1;
  encrypted: true;
  exportedAt: string;
  salt: string;
  payload: string;
}

export interface ImportResult {
  mode: ImportMode;
  threadCount: number;
  skippedThreadCount: number;
  // Threads whose configId pointed at a profile that no longer exists after a
  // "backup" restore. Cleared so they fall back to the active profile.
  unboundThreadCount: number;
}

// What the settings provider reports back to the UI: applyImport's counts plus
// the profile numbers, which only the provider can know because it owns the
// merge against the profiles already on this machine.
export interface RestoreResult extends ImportResult {
  profileCount: number;
  addedProfileCount: number;
}

export function isEncryptedExportFile(
  data: ExportData | EncryptedExportFile,
): data is EncryptedExportFile {
  return !!data && (data as EncryptedExportFile).encrypted === true;
}

async function collectExportData(
  mode: ImportMode,
  includeChatData: boolean,
  configs: ConfigsSnapshot,
): Promise<ExportData> {
  const result: ExportData = {
    version: 2,
    mode,
    exportedAt: new Date().toISOString(),
    configs: {
      profiles: configs.profiles.map((profile) => ({ ...profile })),
      activeProfileId: configs.activeProfileId,
    },
  };
  if (includeChatData) {
    result.chatData = await db.transaction(
      "r",
      [db.threads, db.messages],
      async () => ({
        threads: await db.threads.toArray(),
        messages: await db.messages.toArray(),
      }),
    );
  }
  return result;
}

export async function exportPlainWithoutKeys(
  includeChatData: boolean,
  configs: ConfigsSnapshot,
): Promise<ExportData> {
  const data = await collectExportData("config", includeChatData, configs);
  for (const profile of data.configs.profiles) {
    for (const field of KEY_FIELDS) profile[field] = "";
  }
  return data;
}

export async function exportEncrypted(
  includeChatData: boolean,
  configs: ConfigsSnapshot,
  passphrase: string,
): Promise<EncryptedExportFile> {
  const data = await collectExportData("backup", includeChatData, configs);
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
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = includeChatData
    ? `chat-backup-${date}.json`
    : `chat-config-${date}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Normalizes any accepted file version into the in-memory v2 shape. Pre-mode
// files (version 1) are applied as "config" so they can only ever add
// profiles — the behaviour they were written under.
function validateExportData(raw: unknown): ExportData {
  if (!raw || typeof raw !== "object") throw new Error("Invalid export file");
  const data = raw as Omit<Partial<ExportData>, "version" | "mode"> & {
    version?: unknown;
    mode?: unknown;
  };
  if (data.version !== 1 && data.version !== 2) {
    throw new Error(`Unsupported export version: ${String(data.version)}`);
  }
  if (!data.configs?.profiles || !Array.isArray(data.configs.profiles)) {
    throw new Error("Invalid export file: missing profiles");
  }
  if (
    data.configs.activeProfileId !== null &&
    typeof data.configs.activeProfileId !== "string"
  ) {
    throw new Error("Invalid export file: invalid active profile");
  }
  if (data.version === 2 && data.mode !== "backup" && data.mode !== "config") {
    throw new Error("Invalid export file: unknown import mode");
  }
  return {
    ...(data as Omit<ExportData, "version" | "mode">),
    version: 2,
    mode: data.version === 2 ? (data.mode as ImportMode) : "config",
  };
}

export async function readImportFile(
  file: File,
): Promise<ExportData | EncryptedExportFile> {
  const raw: unknown = JSON.parse(await file.text());
  if (isEncryptedExportFile(raw as ExportData | EncryptedExportFile)) {
    const envelope = raw as EncryptedExportFile;
    if (
      envelope.version !== 1 ||
      typeof envelope.salt !== "string" ||
      typeof envelope.payload !== "string"
    ) {
      throw new Error("Invalid encrypted export file");
    }
    return envelope;
  }
  return validateExportData(raw);
}

export async function decryptExportFile(
  file: EncryptedExportFile,
  passphrase: string,
): Promise<ExportData> {
  return validateExportData(
    await decryptJson<unknown>(passphrase, file.salt, file.payload),
  );
}

// Validates and normalizes the file's profiles. Separate from applyImport so
// the caller can decide how they combine with the profiles already stored
// (replace for a backup, merge for a shared config) before anything is written.
export function parseImportProfiles(data: ExportData): ConfigProfile[] {
  const profiles = data.configs.profiles.map((raw) => {
    if (
      !raw ||
      typeof raw.id !== "string" ||
      !raw.id.trim() ||
      typeof raw.name !== "string" ||
      !raw.name.trim()
    ) {
      throw new Error("Invalid profile in import file");
    }
    for (const field of PROFILE_STRING_FIELDS) {
      if (raw[field] !== undefined && typeof raw[field] !== "string") {
        throw new Error(`Invalid profile field: ${field}`);
      }
    }
    for (const field of KEY_FIELDS) {
      if (typeof raw[field] === "string" && isEncrypted(raw[field])) {
        throw new Error(
          "Imported API keys must be plaintext or omitted from the backup",
        );
      }
    }
    if (
      raw.provider !== undefined &&
      raw.provider !== "openai" &&
      raw.provider !== "anthropic"
    ) {
      throw new Error("Invalid profile field: provider");
    }
    if (
      raw.searchProvider !== undefined &&
      raw.searchProvider !== "exa" &&
      raw.searchProvider !== "tavily"
    ) {
      throw new Error("Invalid profile field: searchProvider");
    }
    if (
      raw.requestMode !== undefined &&
      raw.requestMode !== "auto" &&
      raw.requestMode !== "client" &&
      raw.requestMode !== "server"
    ) {
      throw new Error("Invalid profile field: requestMode");
    }
    if (
      raw.searchEnabledByDefault !== undefined &&
      typeof raw.searchEnabledByDefault !== "boolean"
    ) {
      throw new Error("Invalid profile field: searchEnabledByDefault");
    }
    if (
      raw.searchEnabled !== undefined &&
      typeof raw.searchEnabled !== "boolean"
    ) {
      throw new Error("Invalid profile field: searchEnabled");
    }
    if (
      raw.temperature !== undefined &&
      (typeof raw.temperature !== "number" ||
        !Number.isFinite(raw.temperature) ||
        raw.temperature < 0 ||
        raw.temperature > 2)
    ) {
      throw new Error("Invalid profile field: temperature");
    }
    if (
      raw.maxTokens !== undefined &&
      (typeof raw.maxTokens !== "number" ||
        !Number.isInteger(raw.maxTokens) ||
        raw.maxTokens < 1)
    ) {
      throw new Error("Invalid profile field: maxTokens");
    }
    // Pre-mode files carried the search default per profile as `searchEnabled`.
    // Files on disk outlive the code, so the mapping lives in the import path
    // rather than in normalizeProfile, which only ever sees our own records.
    const source =
      raw.searchEnabledByDefault === undefined &&
      typeof raw.searchEnabled === "boolean"
        ? { ...raw, searchEnabledByDefault: raw.searchEnabled }
        : raw;
    return normalizeProfile(source as ConfigProfile & Record<string, unknown>);
  });
  if (profiles.length === 0) throw new Error("Import contains no profiles");
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
    throw new Error("Import contains duplicate profile IDs");
  }
  return profiles;
}

export interface CombinedImportProfiles {
  profiles: ConfigProfile[];
  activeProfileId: string;
  addedProfileCount: number;
}

// The single decision that determines whether an import can destroy local
// data, kept pure so it is directly testable: "backup" takes the file's set,
// "config" appends only the ids this machine does not already have.
export function combineImportedProfiles(
  mode: ImportMode,
  existing: ConfigProfile[],
  imported: ConfigProfile[],
  fileActiveProfileId: string | null,
  currentActiveProfileId: string | null,
): CombinedImportProfiles {
  if (imported.length === 0) throw new Error("Import contains no profiles");
  const existingIds = new Set(existing.map((profile) => profile.id));
  const added = imported.filter((profile) => !existingIds.has(profile.id));
  const profiles = mode === "backup" ? imported : [...existing, ...added];
  // A backup carries the active profile it was taken with; a merge keeps
  // whatever this machine already had selected.
  const requested =
    mode === "backup" ? fileActiveProfileId : currentActiveProfileId;
  const activeProfileId =
    requested !== null && profiles.some((profile) => profile.id === requested)
      ? requested
      : profiles[0].id;
  return {
    profiles,
    activeProfileId,
    addedProfileCount: mode === "backup" ? imported.length : added.length,
  };
}

// Writes the already-prepared config record and the file's chat data in one
// transaction. `record` must carry the final profile set (API keys encrypted
// when at-rest encryption is on) — see parseImportProfiles.
export async function applyImport(
  data: ExportData,
  record: AppConfigRecord,
): Promise<ImportResult> {
  const aggregates = buildChatImportAggregates(data.chatData);
  const survivingProfileIds = new Set(
    record.profiles.map((profile) => profile.id),
  );
  let addedThreads = 0;
  let skippedThreads = 0;
  let unboundThreads = 0;

  await db.transaction(
    "rw",
    [db.appConfig, db.threads, db.messages],
    async () => {
      await db.appConfig.put(record);
      // Collision detection is hoisted out of the per-thread loop: two bulkGets
      // instead of two round trips per imported thread, which keeps the write
      // lock short on a large backup.
      const existingThreads = await db.threads.bulkGet(
        aggregates.map((aggregate) => aggregate.thread.id),
      );
      const importedMessageIds = aggregates.flatMap((aggregate) =>
        aggregate.messages.map((message) => message.id),
      );
      const existingMessageIds = new Set(
        (await db.messages.bulkGet(importedMessageIds))
          .filter((message) => !!message)
          .map((message) => message.id),
      );
      for (const [index, aggregate] of aggregates.entries()) {
        const collides =
          !!existingThreads[index] ||
          aggregate.messages.some((message) =>
            existingMessageIds.has(message.id),
          );
        if (collides) {
          skippedThreads++;
          continue;
        }
        await db.threads.add(aggregate.thread);
        if (aggregate.messages.length > 0) {
          await db.messages.bulkAdd(aggregate.messages);
        }
        addedThreads++;
      }
      // A "backup" restore replaces the profile set, so any thread still
      // pointing at a profile that did not survive would be stuck showing
      // "profile missing". Dropping configId lets it fall back to the active
      // profile. Runs last so freshly imported threads — whose configId points
      // into the new set — are unaffected. "config" merges never remove a
      // profile, so they cannot orphan anything.
      if (data.mode === "backup") {
        unboundThreads = await db.threads
          .filter(
            (thread) =>
              thread.configId !== undefined &&
              !survivingProfileIds.has(thread.configId),
          )
          .modify((thread) => {
            delete thread.configId;
          });
      }
    },
  );
  return {
    mode: data.mode,
    threadCount: addedThreads,
    skippedThreadCount: skippedThreads,
    unboundThreadCount: unboundThreads,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidToolCalls(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    value.every(
      (toolCall) =>
        isRecord(toolCall) &&
        typeof toolCall.id === "string" &&
        !!toolCall.id &&
        typeof toolCall.name === "string" &&
        !!toolCall.name &&
        isRecord(toolCall.args),
    )
  );
}

function isValidAttachments(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    value.every(
      (attachment) =>
        isRecord(attachment) &&
        typeof attachment.id === "string" &&
        !!attachment.id &&
        (attachment.kind === "image" || attachment.kind === "file") &&
        typeof attachment.name === "string" &&
        typeof attachment.url === "string" &&
        typeof attachment.mimeType === "string" &&
        (attachment.sizeBytes === undefined ||
          (typeof attachment.sizeBytes === "number" &&
            Number.isFinite(attachment.sizeBytes) &&
            attachment.sizeBytes >= 0)) &&
        (attachment.extractedText === undefined ||
          typeof attachment.extractedText === "string"),
    )
  );
}

export function buildChatImportAggregates(chatData: ExportData["chatData"]): Array<{
  thread: Thread;
  messages: Message[];
}> {
  if (!chatData) return [];
  if (!Array.isArray(chatData.threads) || !Array.isArray(chatData.messages)) {
    throw new Error("Invalid chat data in import file");
  }
  const threadIds = new Set<string>();
  const messageIds = new Set<string>();
  const messagesByThread = new Map<string, Message[]>();
  for (const rawMessage of chatData.messages) {
    if (
      !rawMessage ||
      typeof rawMessage.id !== "string" ||
      !rawMessage.id ||
      typeof rawMessage.threadId !== "string" ||
      !rawMessage.threadId ||
      !["user", "assistant", "tool"].includes(rawMessage.role) ||
      typeof rawMessage.content !== "string" ||
      typeof rawMessage.createdAt !== "number" ||
      !Number.isFinite(rawMessage.createdAt) ||
      (rawMessage.parentId !== undefined &&
        rawMessage.parentId !== null &&
        typeof rawMessage.parentId !== "string") ||
      (rawMessage.name !== undefined && typeof rawMessage.name !== "string") ||
      (rawMessage.toolCallId !== undefined &&
        typeof rawMessage.toolCallId !== "string") ||
      (rawMessage.reasoningContent !== undefined &&
        typeof rawMessage.reasoningContent !== "string") ||
      (rawMessage.thinkingDuration !== undefined &&
        (typeof rawMessage.thinkingDuration !== "number" ||
          !Number.isFinite(rawMessage.thinkingDuration) ||
          rawMessage.thinkingDuration < 0)) ||
      !isValidToolCalls(rawMessage.toolCalls) ||
      !isValidAttachments(rawMessage.attachments)
    ) {
      throw new Error("Invalid message in import file");
    }
    if (messageIds.has(rawMessage.id)) {
      throw new Error("Import contains duplicate message IDs");
    }
    messageIds.add(rawMessage.id);
    const list = messagesByThread.get(rawMessage.threadId) ?? [];
    list.push({ ...rawMessage });
    messagesByThread.set(rawMessage.threadId, list);
  }

  const aggregates = chatData.threads.map((rawThread) => {
    if (
      !rawThread ||
      typeof rawThread.id !== "string" ||
      !rawThread.id ||
      typeof rawThread.title !== "string" ||
      typeof rawThread.createdAt !== "number" ||
      !Number.isFinite(rawThread.createdAt) ||
      typeof rawThread.updatedAt !== "number" ||
      !Number.isFinite(rawThread.updatedAt) ||
      (rawThread.configId !== undefined &&
        typeof rawThread.configId !== "string") ||
      (rawThread.searchEnabled !== undefined &&
        typeof rawThread.searchEnabled !== "boolean") ||
      (rawThread.activeLeafId !== undefined &&
        typeof rawThread.activeLeafId !== "string")
    ) {
      throw new Error("Invalid thread in import file");
    }
    if (threadIds.has(rawThread.id)) {
      throw new Error("Import contains duplicate thread IDs");
    }
    threadIds.add(rawThread.id);
    const thread = { ...rawThread };
    let messages = messagesByThread.get(thread.id) ?? [];
    if (
      messages.length > 0 &&
      messages.every((message) => message.parentId === undefined)
    ) {
      messages = chainByCreation(messages);
      if (!thread.activeLeafId) {
        thread.activeLeafId = messages[messages.length - 1].id;
      }
    }
    const messagesById = new Map(
      messages.map((message) => [message.id, message]),
    );
    const ownIds = new Set(messagesById.keys());
    for (const message of messages) {
      if (message.parentId && !ownIds.has(message.parentId)) {
        throw new Error(`Message ${message.id} has an invalid parent`);
      }
    }
    const visitState = new Map<string, "visiting" | "visited">();
    for (const message of messages) {
      if (visitState.get(message.id) === "visited") continue;
      const path: string[] = [];
      let current: Message | undefined = message;
      while (current) {
        const state = visitState.get(current.id);
        if (state === "visiting") {
          throw new Error(`Thread ${thread.id} contains a message cycle`);
        }
        if (state === "visited") break;
        visitState.set(current.id, "visiting");
        path.push(current.id);
        current = current.parentId
          ? messagesById.get(current.parentId)
          : undefined;
      }
      for (const id of path) visitState.set(id, "visited");
    }
    if (thread.activeLeafId && !ownIds.has(thread.activeLeafId)) {
      throw new Error(`Thread ${thread.id} has an invalid active leaf`);
    }
    return { thread, messages };
  });
  for (const threadId of messagesByThread.keys()) {
    if (!threadIds.has(threadId)) {
      throw new Error(`Messages reference missing thread ${threadId}`);
    }
  }
  return aggregates;
}

export async function resetAllData(): Promise<void> {
  await db.transaction(
    "rw",
    [db.appConfig, db.threads, db.messages],
    async () => {
      await db.appConfig.clear();
      await db.threads.clear();
      await db.messages.clear();
    },
  );
  try {
    // Config storage moved to IndexedDB and these keys are no longer read, but
    // pre-move installs may still hold plaintext API keys in them — a reset
    // should not leave those behind.
    localStorage.removeItem("chat-app-configs");
    localStorage.removeItem("chat-app-settings");
    sessionStorage.removeItem("chat-app-session-key");
  } catch {
    // IndexedDB is authoritative; storage cleanup is best effort.
  }
  setAccessToken("");
}
