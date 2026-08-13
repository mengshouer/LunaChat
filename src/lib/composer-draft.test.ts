import { describe, expect, it } from "vitest";
import { getDraftRestoreKey, mergeRestoredInput } from "./composer-draft";

describe("composer draft recovery", () => {
  it("restores an orphaned provisional-thread draft to the visible composer", () => {
    expect(getDraftRestoreKey("draft-1", "draft-2", ["thread-1", "draft-2"])).toBe(
      "draft-2",
    );
  });

  it("keeps using the submitted conversation while it remains reachable", () => {
    expect(getDraftRestoreKey("draft-1", "thread-1", ["thread-1", "draft-1"])).toBe(
      "draft-1",
    );
  });

  it("preserves text entered while the failed send was pending", () => {
    expect(mergeRestoredInput("failed message", "new draft")).toBe(
      "new draft\nfailed message",
    );
  });
});
