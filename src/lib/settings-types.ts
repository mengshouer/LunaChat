import type { ProviderType } from "./llm/types";
import type { SearchProviderId } from "./tools/net-search/types";

export type RequestMode = "client" | "server" | "auto";

export interface Settings {
  provider: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  searchProvider: SearchProviderId;
  exaApiKey: string;
  exaBaseUrl: string;
  tavilyApiKey: string;
  tavilyBaseUrl: string;
  systemPrompt: string;
  requestMode: RequestMode;
  searchEnabledByDefault: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface ConfigProfile extends Settings {
  id: string;
  name: string;
}

export interface EncryptionMeta {
  salt: string;
  check: string;
}

export interface AppConfigRecord {
  id: "main";
  profiles: ConfigProfile[];
  activeProfileId: string | null;
  encryption?: EncryptionMeta;
}

export const APP_CONFIG_ID = "main" as const;

export const DEFAULT_SETTINGS: Settings = {
  provider: "openai",
  baseUrl: "",
  apiKey: "",
  model: "",
  searchProvider: "tavily",
  exaApiKey: "",
  exaBaseUrl: "https://api.exa.ai",
  tavilyApiKey: "",
  tavilyBaseUrl: "https://api.tavily.com",
  systemPrompt: "",
  requestMode: "auto",
  searchEnabledByDefault: false,
};

export const API_KEY_FIELDS = ["apiKey", "exaApiKey", "tavilyApiKey"] as const;

export type ApiKeyField = (typeof API_KEY_FIELDS)[number];

export function profileToSettings(profile: ConfigProfile): Settings {
  const settings = { ...profile } as Partial<ConfigProfile>;
  delete settings.id;
  delete settings.name;
  return { ...DEFAULT_SETTINGS, ...settings } as Settings;
}

export function applyProfileSettings(
  profile: ConfigProfile,
  settings: Settings,
): ConfigProfile {
  return {
    ...profile,
    ...DEFAULT_SETTINGS,
    ...settings,
    id: profile.id,
    name: profile.name,
  };
}

export function normalizeProfile(raw: Partial<ConfigProfile>): ConfigProfile {
  const value = raw as Record<string, unknown>;
  const stringValue = (field: keyof Settings): string =>
    typeof value[field] === "string"
      ? value[field]
      : (DEFAULT_SETTINGS[field] as string);
  const temperature =
    typeof value.temperature === "number" &&
    Number.isFinite(value.temperature) &&
    value.temperature >= 0 &&
    value.temperature <= 2
      ? value.temperature
      : undefined;
  const maxTokens =
    typeof value.maxTokens === "number" &&
    Number.isInteger(value.maxTokens) &&
    value.maxTokens > 0
      ? value.maxTokens
      : undefined;

  return {
    id: typeof value.id === "string" ? value.id : "",
    name: typeof value.name === "string" ? value.name : "Default",
    provider:
      value.provider === "openai" || value.provider === "anthropic"
        ? value.provider
        : DEFAULT_SETTINGS.provider,
    baseUrl: stringValue("baseUrl"),
    apiKey: stringValue("apiKey"),
    model: stringValue("model"),
    searchProvider:
      value.searchProvider === "exa" || value.searchProvider === "tavily"
        ? value.searchProvider
        : DEFAULT_SETTINGS.searchProvider,
    exaApiKey: stringValue("exaApiKey"),
    exaBaseUrl: stringValue("exaBaseUrl"),
    tavilyApiKey: stringValue("tavilyApiKey"),
    tavilyBaseUrl: stringValue("tavilyBaseUrl"),
    systemPrompt: stringValue("systemPrompt"),
    requestMode:
      value.requestMode === "client" ||
      value.requestMode === "server" ||
      value.requestMode === "auto"
        ? value.requestMode
        : DEFAULT_SETTINGS.requestMode,
    searchEnabledByDefault:
      typeof value.searchEnabledByDefault === "boolean"
        ? value.searchEnabledByDefault
        : DEFAULT_SETTINGS.searchEnabledByDefault,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  };
}

export function validateSettings(settings: Settings): void {
  if (settings.provider !== "openai" && settings.provider !== "anthropic") {
    throw new Error("Unsupported provider protocol");
  }
  if (
    settings.temperature !== undefined &&
    (!Number.isFinite(settings.temperature) ||
      settings.temperature < 0 ||
      settings.temperature > 2)
  ) {
    throw new Error("Temperature must be between 0 and 2");
  }
  if (
    settings.maxTokens !== undefined &&
    (!Number.isInteger(settings.maxTokens) || settings.maxTokens < 1)
  ) {
    throw new Error("Max tokens must be a positive integer");
  }
}
