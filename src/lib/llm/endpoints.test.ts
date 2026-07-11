import { describe, it, expect } from "vitest";
import { resolveLLMEndpoint } from "./endpoints";

describe("resolveLLMEndpoint (chat)", () => {
  it("appends the full default path to a bare origin", () => {
    expect(resolveLLMEndpoint("https://api.openai.com", "openai", "chat")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(
      resolveLLMEndpoint("https://api.anthropic.com/", "anthropic", "chat"),
    ).toBe("https://api.anthropic.com/v1/messages");
  });

  it("completes a /v1 base with the provider-specific suffix", () => {
    expect(resolveLLMEndpoint("https://x.com/v1", "openai", "chat")).toBe(
      "https://x.com/v1/chat/completions",
    );
    expect(resolveLLMEndpoint("https://x.com/v1/", "anthropic", "chat")).toBe(
      "https://x.com/v1/messages",
    );
  });

  it("keeps a full custom path as-is", () => {
    expect(
      resolveLLMEndpoint("https://x.com/api/v2/chat/completions", "openai", "chat"),
    ).toBe("https://x.com/api/v2/chat/completions");
  });

  it("returns unparseable or empty input unchanged", () => {
    expect(resolveLLMEndpoint("not a url", "openai", "chat")).toBe("not a url");
    expect(resolveLLMEndpoint("   ", "openai", "chat")).toBe("");
  });
});

describe("resolveLLMEndpoint (models)", () => {
  it("appends /v1/models to a bare origin and /models to a /v1 base", () => {
    expect(resolveLLMEndpoint("https://x.com", "openai", "models")).toBe(
      "https://x.com/v1/models",
    );
    expect(resolveLLMEndpoint("https://x.com/v1", "openai", "models")).toBe(
      "https://x.com/v1/models",
    );
  });

  it("rewrites chat endpoints to their models endpoint and strips query/hash", () => {
    expect(
      resolveLLMEndpoint(
        "https://x.com/v1/chat/completions?key=1#frag",
        "openai",
        "models",
      ),
    ).toBe("https://x.com/v1/models");
    expect(
      resolveLLMEndpoint("https://x.com/v1/messages", "anthropic", "models"),
    ).toBe("https://x.com/v1/models");
  });

  it("keeps an explicit /models endpoint and appends for other paths", () => {
    expect(resolveLLMEndpoint("https://x.com/v1/models", "openai", "models")).toBe(
      "https://x.com/v1/models",
    );
    expect(resolveLLMEndpoint("https://x.com/api", "openai", "models")).toBe(
      "https://x.com/api/models",
    );
  });
});
