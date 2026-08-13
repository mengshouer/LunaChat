import { describe, expect, it } from "vitest";
import {
  MAX_CONCURRENT_TURNS,
  checkTurnAdmission,
  resolveSearchEnabled,
  resolveTurnFailure,
} from "./turn-policy";

describe("checkTurnAdmission", () => {
  it("refuses a second turn on a thread that is already answering", () => {
    expect(checkTurnAdmission(new Set(["t1"]), "t1")).toMatch(
      /already has an active response/,
    );
  });

  it("refuses once the concurrency limit is reached", () => {
    const full = new Set(
      Array.from({ length: MAX_CONCURRENT_TURNS }, (_, i) => `t${i}`),
    );

    expect(checkTurnAdmission(full, "new-thread")).toBe(
      `${MAX_CONCURRENT_TURNS} background responses are already running`,
    );
  });

  it("admits a new thread while below the limit", () => {
    expect(checkTurnAdmission(new Set(["t1"]), "t2")).toBeNull();
  });

  it("reports the limit it was given rather than a hardcoded number", () => {
    expect(checkTurnAdmission(new Set(["t1"]), "t2", 1)).toBe(
      "1 background responses are already running",
    );
  });
});

describe("resolveSearchEnabled", () => {
  it("prefers the thread's own choice over the profile default", () => {
    expect(
      resolveSearchEnabled({
        thread: { searchEnabled: false },
        draftOverride: true,
        profileDefault: true,
      }),
    ).toBe(false);
  });

  it("falls back to the profile default when the thread never chose", () => {
    expect(
      resolveSearchEnabled({
        thread: { searchEnabled: undefined },
        draftOverride: false,
        profileDefault: true,
      }),
    ).toBe(true);
  });

  it("uses the draft override only before a thread exists", () => {
    expect(
      resolveSearchEnabled({
        thread: undefined,
        draftOverride: true,
        profileDefault: false,
      }),
    ).toBe(true);
  });

  it("is off when nothing is known, including without a profile", () => {
    expect(
      resolveSearchEnabled({
        thread: undefined,
        draftOverride: undefined,
        profileDefault: undefined,
      }),
    ).toBe(false);
  });
});

describe("resolveTurnFailure", () => {
  const base = {
    aborted: false,
    status: "running" as const,
    hasPartialContent: true,
    isOwner: true,
  };

  it("keeps what streamed when the user pressed Stop", () => {
    expect(
      resolveTurnFailure({ ...base, aborted: true, status: "stopping" }),
    ).toBe("persist-partial");
  });

  it("keeps nothing when Stop arrived before any output", () => {
    expect(
      resolveTurnFailure({
        ...base,
        aborted: true,
        status: "stopping",
        hasPartialContent: false,
      }),
    ).toBe("discard");
  });

  it("keeps nothing when the abort came from deleting the thread", () => {
    expect(
      resolveTurnFailure({ ...base, aborted: true, status: "deleting" }),
    ).toBe("discard");
  });

  it("records a genuine failure in the thread", () => {
    expect(resolveTurnFailure(base)).toBe("append-error");
  });

  it("does not record a failure into a thread being deleted", () => {
    expect(resolveTurnFailure({ ...base, status: "deleting" })).toBe("discard");
  });

  it("does not record a failure once another turn owns the thread", () => {
    expect(resolveTurnFailure({ ...base, isOwner: false })).toBe("discard");
  });

  it("does not record a failure after the session was dropped", () => {
    expect(
      resolveTurnFailure({ ...base, status: undefined, isOwner: false }),
    ).toBe("discard");
  });
});
