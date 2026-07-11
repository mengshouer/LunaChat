import { describe, it, expect } from "vitest";
import { createLLMHeaders } from "./headers";

describe("createLLMHeaders", () => {
  it("sends x-api-key plus required anthropic headers", () => {
    expect(createLLMHeaders("anthropic", "sk-ant")).toEqual({
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "x-api-key": "sk-ant",
    });
  });

  it("keeps the anthropic protocol headers even without an api key", () => {
    expect(createLLMHeaders("anthropic", "")).toEqual({
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
  });

  it("uses a bearer token for openai and omits it when empty", () => {
    expect(createLLMHeaders("openai", "sk-x")).toEqual({
      Authorization: "Bearer sk-x",
    });
    expect(createLLMHeaders("openai", "")).toEqual({});
  });

  it("trims surrounding whitespace from the api key", () => {
    expect(createLLMHeaders("openai", "  sk-x  ")).toEqual({
      Authorization: "Bearer sk-x",
    });
  });
});
