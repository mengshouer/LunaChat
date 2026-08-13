import { describe, expect, it } from "vitest";
import {
  applyProfileSettings,
  DEFAULT_SETTINGS,
  normalizeProfile,
  validateSettings,
  type ConfigProfile,
  type Settings,
} from "./settings-types";

describe("normalizeProfile", () => {
  // The legacy per-profile `searchEnabled` only ever appears in export files,
  // so parseImportProfiles owns that mapping. normalizeProfile sees our own
  // records and must not carry the field forward.
  it("ignores the legacy searchEnabled field", () => {
    const profile = normalizeProfile({
      id: "profile-1",
      name: "Legacy",
      searchEnabled: true,
    } as Partial<ConfigProfile> & { searchEnabled?: unknown });

    expect(profile.searchEnabledByDefault).toBe(
      DEFAULT_SETTINGS.searchEnabledByDefault,
    );
    expect("searchEnabled" in profile).toBe(false);
  });

  it("drops malformed persisted values instead of exposing them at runtime", () => {
    const profile = normalizeProfile({
      id: "profile-1",
      name: "Damaged",
      provider: "unsupported",
      baseUrl: 42,
      requestMode: "sometimes",
      searchProvider: "unknown",
      temperature: Number.NaN,
      maxTokens: 1.5,
    } as unknown as Partial<ConfigProfile>);

    expect(profile.provider).toBe(DEFAULT_SETTINGS.provider);
    expect(profile.baseUrl).toBe(DEFAULT_SETTINGS.baseUrl);
    expect(profile.requestMode).toBe(DEFAULT_SETTINGS.requestMode);
    expect(profile.searchProvider).toBe(DEFAULT_SETTINGS.searchProvider);
    expect(profile.temperature).toBeUndefined();
    expect(profile.maxTokens).toBeUndefined();
  });
});

describe("validateSettings", () => {
  const settings = (updates: Partial<Settings>): Settings => ({
    ...DEFAULT_SETTINGS,
    ...updates,
  });

  it("accepts the supported sampling boundaries", () => {
    expect(() => validateSettings(settings({ temperature: 0 }))).not.toThrow();
    expect(() => validateSettings(settings({ temperature: 2 }))).not.toThrow();
    expect(() => validateSettings(settings({ maxTokens: 1 }))).not.toThrow();
  });

  it("rejects invalid sampling values", () => {
    expect(() => validateSettings(settings({ temperature: 2.1 }))).toThrow(
      "Temperature",
    );
    expect(() => validateSettings(settings({ maxTokens: 1.5 }))).toThrow(
      "Max tokens",
    );
  });

  it("accepts an explicit Anthropic protocol for an unrecognized gateway", () => {
    expect(() =>
      validateSettings(
        settings({
          provider: "anthropic",
          baseUrl: "https://gateway.example.com",
          model: "custom-model",
        }),
      ),
    ).not.toThrow();
  });
});

describe("applyProfileSettings", () => {
  it("preserves an explicit Anthropic protocol for an unrecognized gateway", () => {
    const profile: ConfigProfile = {
      id: "profile-1",
      name: "Gateway",
      ...DEFAULT_SETTINGS,
    };

    const updated = applyProfileSettings(profile, {
      ...DEFAULT_SETTINGS,
      provider: "anthropic",
      baseUrl: "https://gateway.example.com",
      model: "custom-model",
    });

    expect(updated.provider).toBe("anthropic");
    expect(updated.id).toBe(profile.id);
    expect(updated.name).toBe(profile.name);
  });
});
