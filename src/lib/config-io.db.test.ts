import { beforeEach, describe, expect, it } from "vitest";
import { textBlocks } from "./content-blocks";
import { applyImport, type ExportData, type ImportMode } from "./config-io";
import { db, type Message, type Thread } from "./db";
import {
  APP_CONFIG_ID,
  DEFAULT_SETTINGS,
  type AppConfigRecord,
  type ConfigProfile,
} from "./settings-types";

function profile(id: string): ConfigProfile {
  return { id, name: id, ...DEFAULT_SETTINGS };
}

// The export file's profiles are untyped JSON, so they need the spread to pick
// up an implicit index signature that the ConfigProfile interface lacks.
function rawProfile(id: string): Record<string, unknown> {
  return { ...profile(id) };
}

function record(profileIds: string[]): AppConfigRecord {
  return {
    id: APP_CONFIG_ID,
    profiles: profileIds.map(profile),
    activeProfileId: profileIds[0] ?? null,
  };
}

function thread(id: string, configId?: string): Thread {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    ...(configId ? { configId } : {}),
  };
}

function message(id: string, threadId: string): Message {
  return { id, threadId, role: "user", content: textBlocks(id), createdAt: 1 };
}

function importFile(
  mode: ImportMode,
  profileIds: string[],
  chatData?: ExportData["chatData"],
): ExportData {
  return {
    version: 2,
    mode,
    exportedAt: new Date(0).toISOString(),
    configs: {
      profiles: profileIds.map(rawProfile),
      activeProfileId: profileIds[0] ?? null,
    },
    ...(chatData ? { chatData } : {}),
  };
}

beforeEach(async () => {
  await db.open();
  await db.transaction(
    "rw",
    [db.appConfig, db.threads, db.messages],
    async () => {
      await db.appConfig.clear();
      await db.threads.clear();
      await db.messages.clear();
    },
  );
});

describe("applyImport in backup mode", () => {
  it("replaces the profile set and unbinds threads whose profile is gone", async () => {
    await db.appConfig.put(record(["local-1"]));
    await db.threads.bulkAdd([
      thread("kept-binding", "local-1"),
      thread("also-bound", "local-1"),
      thread("never-bound"),
    ]);

    const result = await applyImport(
      importFile("backup", ["file-1"]),
      record(["file-1"]),
    );

    expect(result.unboundThreadCount).toBe(2);
    expect((await db.appConfig.get(APP_CONFIG_ID))?.profiles).toHaveLength(1);
    expect((await db.threads.get("kept-binding"))?.configId).toBeUndefined();
    expect((await db.threads.get("also-bound"))?.configId).toBeUndefined();
    // A thread that was never bound had nothing to repair.
    expect((await db.threads.get("never-bound"))?.configId).toBeUndefined();
  });

  it("leaves freshly imported threads bound, because unbinding runs last", async () => {
    await db.appConfig.put(record(["local-1"]));
    await db.threads.add(thread("pre-existing", "local-1"));

    const result = await applyImport(
      importFile("backup", ["file-1"], {
        threads: [thread("from-file", "file-1")],
        messages: [message("m1", "from-file")],
      }),
      record(["file-1"]),
    );

    expect(result.threadCount).toBe(1);
    expect(result.unboundThreadCount).toBe(1);
    expect((await db.threads.get("from-file"))?.configId).toBe("file-1");
    expect((await db.threads.get("pre-existing"))?.configId).toBeUndefined();
  });

  it("clears a configId that was already dangling inside the backup", async () => {
    await db.appConfig.put(record(["file-1"]));

    const result = await applyImport(
      importFile("backup", ["file-1"], {
        threads: [thread("from-file", "deleted-before-export")],
        messages: [],
      }),
      record(["file-1"]),
    );

    expect(result.unboundThreadCount).toBe(1);
    expect((await db.threads.get("from-file"))?.configId).toBeUndefined();
  });
});

describe("applyImport in config mode", () => {
  it("never unbinds, because a merge cannot remove a profile", async () => {
    await db.appConfig.put(record(["local-1"]));
    await db.threads.add(thread("bound", "local-1"));

    const result = await applyImport(
      importFile("config", ["file-1"]),
      record(["local-1", "file-1"]),
    );

    expect(result.unboundThreadCount).toBe(0);
    expect((await db.threads.get("bound"))?.configId).toBe("local-1");
  });
});

describe("applyImport collision handling", () => {
  it("skips a colliding thread whole, keeping the local messages", async () => {
    await db.appConfig.put(record(["local-1"]));
    await db.threads.add(thread("shared-id"));
    await db.messages.add(message("local-message", "shared-id"));

    const result = await applyImport(
      importFile("config", ["local-1"], {
        threads: [thread("shared-id")],
        messages: [message("imported-message", "shared-id")],
      }),
      record(["local-1"]),
    );

    expect(result.skippedThreadCount).toBe(1);
    expect(result.threadCount).toBe(0);
    expect(
      (await db.messages.where({ threadId: "shared-id" }).toArray()).map(
        (item) => item.id,
      ),
    ).toEqual(["local-message"]);
  });

  it("skips a thread whose message id already exists under another thread", async () => {
    await db.appConfig.put(record(["local-1"]));
    await db.threads.add(thread("local-thread"));
    await db.messages.add(message("shared-message", "local-thread"));

    const result = await applyImport(
      importFile("config", ["local-1"], {
        threads: [thread("imported-thread")],
        messages: [message("shared-message", "imported-thread")],
      }),
      record(["local-1"]),
    );

    expect(result.skippedThreadCount).toBe(1);
    expect(await db.threads.get("imported-thread")).toBeUndefined();
    // The pre-existing message must not have been reassigned.
    expect((await db.messages.get("shared-message"))?.threadId).toBe(
      "local-thread",
    );
  });

  it("imports non-colliding threads alongside skipped ones", async () => {
    await db.appConfig.put(record(["local-1"]));
    await db.threads.add(thread("shared-id"));

    const result = await applyImport(
      importFile("config", ["local-1"], {
        threads: [thread("shared-id"), thread("fresh-id")],
        messages: [message("m1", "fresh-id")],
      }),
      record(["local-1"]),
    );

    expect(result).toMatchObject({ threadCount: 1, skippedThreadCount: 1 });
    expect(await db.threads.get("fresh-id")).toBeDefined();
    expect((await db.messages.get("m1"))?.threadId).toBe("fresh-id");
  });
});
