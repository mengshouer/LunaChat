"use client";

import { useMemo } from "react";
import { useSettings, type Settings } from "@/providers/SettingsProvider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import type { SearchProviderId } from "@/lib/tools/net-search/types";

const SEARCH_PROVIDER_CONFIGS: Record<
  string,
  { label: string; apiKeyField: keyof Settings; apiKeyPlaceholder: string; baseUrlField: keyof Settings; defaultBaseUrl: string }
> = {
  tavily: { label: "Tavily", apiKeyField: "tavilyApiKey", apiKeyPlaceholder: "tvly-...", baseUrlField: "tavilyBaseUrl", defaultBaseUrl: "https://api.tavily.com" },
  exa: { label: "Exa", apiKeyField: "exaApiKey", apiKeyPlaceholder: "exa-...", baseUrlField: "exaBaseUrl", defaultBaseUrl: "https://api.exa.ai" },
};

function resolveRequestUrl(baseUrl: string, provider: string): string {
  if (!baseUrl) return "";
  const raw = baseUrl.replace(/\/+$/, "");
  try {
    const hasPath = new URL(raw).pathname !== "/";
    if (hasPath) return raw;
    const suffix = provider === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
    return raw + suffix;
  } catch {
    return raw;
  }
}

export function ProviderForm() {
  const { settings, updateSettings } = useSettings();

  const requestUrl = useMemo(
    () => resolveRequestUrl(settings.baseUrl, settings.provider),
    [settings.baseUrl, settings.provider],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <Label htmlFor="baseUrl">
          Base URL <span className="text-destructive">*</span>
        </Label>
        <Input
          id="baseUrl"
          placeholder="https://api.openai.com"
          value={settings.baseUrl}
          onChange={(e) => updateSettings({ baseUrl: e.target.value })}
        />
        <p className="text-xs text-muted-foreground break-all">
          {requestUrl ? (
            <>Request: {requestUrl}</>
          ) : (
            "Root domain or full path. e.g. https://api.openai.com or http://localhost:11434/v1/chat/completions"
          )}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="model">
          Model <span className="text-destructive">*</span>
        </Label>
        <Input
          id="model"
          placeholder="gpt-4o / claude-sonnet-4-20250514"
          value={settings.model}
          onChange={(e) => updateSettings({ model: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Provider auto-detected: {settings.provider === "anthropic" ? "Anthropic" : "OpenAI Compatible"}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">API Key</Label>
        <PasswordInput
          id="apiKey"
          placeholder="sk-..."
          value={settings.apiKey}
          onChange={(e) => updateSettings({ apiKey: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="requestMode">Request Mode</Label>
        <select
          id="requestMode"
          className="border-input bg-background text-sm rounded-md border px-3 py-2"
          value={settings.requestMode}
          onChange={(e) => updateSettings({ requestMode: e.target.value as any })}
        >
          <option value="auto">Auto (client first, fallback server)</option>
          <option value="client">Client only (browser direct)</option>
          <option value="server">Server only (/api/llm proxy)</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Auto: try browser fetch first, if it fails (e.g. CORS), fallback to server proxy.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="systemPrompt">System Prompt</Label>
        <Textarea
          id="systemPrompt"
          placeholder="Custom system prompt..."
          value={settings.systemPrompt}
          onChange={(e) => updateSettings({ systemPrompt: e.target.value })}
          className="min-h-24"
        />
      </div>

    </div>
  );
}

export function ToolsForm() {
  const { settings, updateSettings } = useSettings();
  const searchProviderConfig = SEARCH_PROVIDER_CONFIGS[settings.searchProvider] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <Label htmlFor="searchProvider">Search Engine</Label>
        <select
          id="searchProvider"
          className="border-input bg-background text-sm rounded-md border px-3 py-2 w-full"
          value={settings.searchProvider}
          onChange={(e) =>
            updateSettings({ searchProvider: e.target.value as SearchProviderId })
          }
        >
          {!searchProviderConfig && (
            <option value={settings.searchProvider}>
              {settings.searchProvider} (unsupported)
            </option>
          )}
          <option value="tavily">Tavily</option>
          <option value="exa">Exa</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Select the search engine for web search tool
        </p>
      </div>

      {searchProviderConfig && (
        <>
          <div className="space-y-2">
            <Label htmlFor={searchProviderConfig.apiKeyField}>
              {searchProviderConfig.label} API Key
            </Label>
            <PasswordInput
              id={searchProviderConfig.apiKeyField}
              placeholder={searchProviderConfig.apiKeyPlaceholder}
              value={(settings[searchProviderConfig.apiKeyField] as string) ?? ""}
              onChange={(e) =>
                updateSettings({ [searchProviderConfig.apiKeyField]: e.target.value } as Partial<Settings>)
              }
            />
            <p className="text-xs text-muted-foreground">
              Enables web search tool for the AI assistant
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={searchProviderConfig.baseUrlField}>
              {searchProviderConfig.label} Base URL
            </Label>
            <Input
              id={searchProviderConfig.baseUrlField}
              placeholder={searchProviderConfig.defaultBaseUrl}
              value={(settings[searchProviderConfig.baseUrlField] as string) ?? ""}
              onChange={(e) =>
                updateSettings({ [searchProviderConfig.baseUrlField]: e.target.value } as Partial<Settings>)
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
