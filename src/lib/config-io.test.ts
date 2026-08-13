import { describe, expect, it } from "vitest";
import {
  buildChatImportAggregates,
  combineImportedProfiles,
  parseImportProfiles,
  type ExportData,
  type ImportMode,
} from "./config-io";
import type { Message, Thread } from "./db";
import { DEFAULT_SETTINGS, type ConfigProfile } from "./settings-types";

function thread(partial: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    title: "Thread",
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function message(partial: Partial<Message> = {}): Message {
  return {
    id: "message-1",
    threadId: "thread-1",
    role: "user",
    content: "hello",
    createdAt: 1,
    ...partial,
  };
}

describe("buildChatImportAggregates", () => {
  it("chains a legacy linear thread and assigns its active leaf", () => {
    const [aggregate] = buildChatImportAggregates({
      threads: [thread()],
      messages: [
        message({ id: "message-2", createdAt: 2 }),
        message({ id: "message-1", createdAt: 1 }),
      ],
    });

    expect(aggregate.messages.map((item) => item.id)).toEqual([
      "message-1",
      "message-2",
    ]);
    expect(aggregate.messages.map((item) => item.parentId)).toEqual([
      null,
      "message-1",
    ]);
    expect(aggregate.thread.activeLeafId).toBe("message-2");
  });

  it("allows an imported thread with no messages", () => {
    expect(
      buildChatImportAggregates({ threads: [thread()], messages: [] }),
    ).toEqual([{ thread: thread(), messages: [] }]);
  });

  it("rejects a parent cycle", () => {
    expect(() =>
      buildChatImportAggregates({
        threads: [thread({ activeLeafId: "message-1" })],
        messages: [
          message({ id: "message-1", parentId: "message-2" }),
          message({ id: "message-2", parentId: "message-1" }),
        ],
      }),
    ).toThrow("message cycle");
  });

  it("rejects dangling parents and messages without a thread", () => {
    expect(() =>
      buildChatImportAggregates({
        threads: [thread()],
        messages: [message({ parentId: "missing" })],
      }),
    ).toThrow("invalid parent");

    expect(() =>
      buildChatImportAggregates({
        threads: [],
        messages: [message()],
      }),
    ).toThrow("missing thread");
  });

  it("rejects malformed nested message data", () => {
    expect(() =>
      buildChatImportAggregates({
        threads: [thread()],
        messages: [
          message({
            toolCalls: [{ id: "call-1", name: "search", args: null }],
          } as unknown as Partial<Message>),
        ],
      }),
    ).toThrow("Invalid message");
  });
});

function exportFile(
  mode: ImportMode,
  profiles: Array<Record<string, unknown>>,
  activeProfileId: string | null = null,
): ExportData {
  return {
    version: 2,
    mode,
    exportedAt: new Date(0).toISOString(),
    configs: { profiles, activeProfileId },
  };
}

function profile(id: string, overrides: Partial<ConfigProfile> = {}) {
  return { id, name: id, ...DEFAULT_SETTINGS, ...overrides };
}

describe("parseImportProfiles", () => {
  it("rejects malformed profile fields before anything is written", () => {
    expect(() =>
      parseImportProfiles(
        exportFile("backup", [profile("profile-1", {
          requestMode: "sometimes" as ConfigProfile["requestMode"],
        })]),
      ),
    ).toThrow("requestMode");
  });

  it("maps the legacy per-profile searchEnabled from pre-mode files", () => {
    const [parsed] = parseImportProfiles({
      ...exportFile("config", [
        { id: "profile-1", name: "Legacy", searchEnabled: true },
      ]),
    });

    expect(parsed.searchEnabledByDefault).toBe(true);
    expect("searchEnabled" in parsed).toBe(false);
  });

  it("refuses ciphertext keys so a locked export cannot be restored blindly", () => {
    expect(() =>
      parseImportProfiles(
        exportFile("backup", [
          profile("profile-1", { apiKey: "enc:v1:abc:def" }),
        ]),
      ),
    ).toThrow("plaintext");
  });
});

describe("combineImportedProfiles", () => {
  const local = [profile("local-1"), profile("local-2")];

  it("replaces the local set for a backup and honours the file's active id", () => {
    const combined = combineImportedProfiles(
      "backup",
      local,
      [profile("file-1"), profile("file-2")],
      "file-2",
      "local-1",
    );

    expect(combined.profiles.map((item) => item.id)).toEqual([
      "file-1",
      "file-2",
    ]);
    expect(combined.activeProfileId).toBe("file-2");
    expect(combined.addedProfileCount).toBe(2);
  });

  it("keeps every local profile for a config merge and adds only new ids", () => {
    const combined = combineImportedProfiles(
      "config",
      local,
      [profile("local-2", { apiKey: "should-not-overwrite" }), profile("file-1")],
      "local-2",
      "local-1",
    );

    expect(combined.profiles.map((item) => item.id)).toEqual([
      "local-1",
      "local-2",
      "file-1",
    ]);
    // The local profile wins, so a shared config cannot clobber local keys.
    expect(
      combined.profiles.find((item) => item.id === "local-2")?.apiKey,
    ).toBe(DEFAULT_SETTINGS.apiKey);
    // A merge must not move the user's current selection.
    expect(combined.activeProfileId).toBe("local-1");
    expect(combined.addedProfileCount).toBe(1);
  });

  it("falls back to the first profile when the requested active id is gone", () => {
    expect(
      combineImportedProfiles(
        "backup",
        local,
        [profile("file-1")],
        "missing",
        null,
      ).activeProfileId,
    ).toBe("file-1");
  });
});
