import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getAccessToken,
  setAccessToken,
  accessTokenHeader,
} from "./access-token";

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("access-token", () => {
  it("round-trips set/get and removes on empty", () => {
    stubStorage();
    expect(getAccessToken()).toBe("");
    setAccessToken("abc");
    expect(getAccessToken()).toBe("abc");
    setAccessToken("");
    expect(getAccessToken()).toBe("");
  });

  it("builds a header object only when a token is present", () => {
    stubStorage();
    expect(accessTokenHeader()).toEqual({});
    setAccessToken("abc");
    expect(accessTokenHeader()).toEqual({ "x-access-token": "abc" });
  });

  it("returns empty safely when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(getAccessToken()).toBe("");
    expect(accessTokenHeader()).toEqual({});
    // setAccessToken must not throw
    expect(() => setAccessToken("x")).not.toThrow();
  });
});
