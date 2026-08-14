"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type { SearchProviderId } from "@/lib/tools/net-search/types";
import type { Settings } from "@/lib/settings-types";
import { resolveLLMEndpoint } from "@/lib/llm/endpoints";
import { createLLMHeaders } from "@/lib/llm/headers";
import { normalizeModels, type ModelListItem } from "@/lib/llm/models";
import { accessTokenHeader } from "@/lib/access-token";

const SEARCH_PROVIDER_CONFIGS: Record<
  string,
  { label: string; apiKeyField: keyof Settings; apiKeyPlaceholder: string; baseUrlField: keyof Settings; defaultBaseUrl: string }
> = {
  tavily: { label: "Tavily", apiKeyField: "tavilyApiKey", apiKeyPlaceholder: "tvly-...", baseUrlField: "tavilyBaseUrl", defaultBaseUrl: "https://api.tavily.com" },
  exa: { label: "Exa", apiKeyField: "exaApiKey", apiKeyPlaceholder: "exa-...", baseUrlField: "exaBaseUrl", defaultBaseUrl: "https://api.exa.ai" },
};

const failedModelOrigins = new Set<string>();

function getOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

interface SettingsFormProps {
  value: Settings;
  onChange: (updates: Partial<Settings>) => void;
}

export function ProviderForm({ value: settings, onChange }: SettingsFormProps) {
  const [models, setModels] = useState<ModelListItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const fetchControllerRef = useRef<AbortController | null>(null);

  const requestUrl = useMemo(
    () => resolveLLMEndpoint(settings.baseUrl, settings.provider, "chat"),
    [settings.baseUrl, settings.provider],
  );

  useEffect(() => {
    fetchControllerRef.current?.abort();
    fetchControllerRef.current = null;
    setModels([]);
    setModelsLoading(false);
    setModelsError("");
  }, [settings.baseUrl, settings.provider]);

  useEffect(
    () => () => {
      fetchControllerRef.current?.abort();
    },
    [],
  );

  function getErrorMessage(payload: unknown, status: number): string {
    if (payload && typeof payload === "object") {
      const error = (payload as { error?: unknown }).error;
      if (typeof error === "string" && error.trim()) return error;
      if (error && typeof error === "object") {
        const message = (error as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) return message;
      }
      const message = (payload as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    return `Failed to fetch models (${status})`;
  }

  async function readModelsResponse(response: Response): Promise<ModelListItem[]> {
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(getErrorMessage(payload, response.status));
    }

    return normalizeModels(payload);
  }

  async function fetchModelsFromServer(signal: AbortSignal): Promise<Response> {
    return fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...accessTokenHeader() },
      body: JSON.stringify({
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
      }),
      signal,
    });
  }

  async function fetchModelsFromClient(
    modelsUrl: string,
    signal: AbortSignal,
  ): Promise<Response> {
    return fetch(modelsUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...createLLMHeaders(settings.provider, settings.apiKey),
      },
      signal,
    });
  }

  async function fetchModels() {
    if (!settings.baseUrl.trim()) {
      toast.error("Please set Base URL first");
      return;
    }
    fetchControllerRef.current?.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;
    setModelsLoading(true);
    setModelsError("");

    try {
      const modelsUrl = resolveLLMEndpoint(settings.baseUrl, settings.provider, "models");
      const origin = getOrigin(modelsUrl);
      const requestMode = settings.requestMode ?? "auto";
      let response: Response;

      if (requestMode === "server" || (requestMode === "auto" && failedModelOrigins.has(origin))) {
        response = await fetchModelsFromServer(controller.signal);
      } else if (requestMode === "client") {
        response = await fetchModelsFromClient(modelsUrl, controller.signal);
      } else {
        try {
          response = await fetchModelsFromClient(modelsUrl, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          failedModelOrigins.add(origin);
          response = await fetchModelsFromServer(controller.signal);
        }
      }

      const nextModels = (await readModelsResponse(response)).filter((model) => model.id);
      if (controller.signal.aborted) return;
      setModels(nextModels);

      if (nextModels.length === 0) {
        setModelsError("No models returned by this provider");
        toast.warning("No models returned");
        return;
      }

      if (!settings.model) {
        onChange({ model: nextModels[0].id });
      }

      toast.success(`Fetched ${nextModels.length} model(s)`);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Failed to fetch models";
      setModelsError(message);
      toast.error(message);
    } finally {
      if (fetchControllerRef.current === controller) {
        fetchControllerRef.current = null;
        setModelsLoading(false);
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <Label htmlFor="provider">Provider protocol</Label>
        <select
          id="provider"
          className="border-input bg-background text-sm rounded-md border px-3 py-2 w-full"
          value={settings.provider}
          onChange={(event) =>
            onChange({ provider: event.target.value as Settings["provider"] })
          }
        >
          <option value="openai">OpenAI Compatible</option>
          <option value="openai-responses">OpenAI (Responses)</option>
          <option value="anthropic">Anthropic</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Controls the request protocol, including for custom gateways.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="baseUrl">
          Base URL <span className="text-destructive">*</span>
        </Label>
        <Input
          id="baseUrl"
          placeholder="https://api.openai.com"
          value={settings.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
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
        <div className="flex gap-2">
          <Input
            id="model"
            placeholder="gpt-4o / claude-sonnet-4-20250514"
            value={settings.model}
            onChange={(e) => onChange({ model: e.target.value })}
          />
          <Button
            type="button"
            variant="outline"
            onClick={fetchModels}
            disabled={modelsLoading || !settings.baseUrl.trim()}
            title="Fetch models"
          >
            {modelsLoading ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
            Fetch
          </Button>
        </div>
        {models.length > 0 && (
          <select
            className="border-input bg-background text-sm rounded-md border px-3 py-2 w-full"
            value={models.some((model) => model.id === settings.model) ? settings.model : ""}
            onChange={(e) => onChange({ model: e.target.value })}
          >
            {!models.some((model) => model.id === settings.model) && (
              <option value="">Select fetched model...</option>
            )}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name ? `${model.name} (${model.id})` : model.id}
              </option>
            ))}
          </select>
        )}
        {modelsError && <p className="text-xs text-destructive">{modelsError}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">API Key</Label>
        <PasswordInput
          id="apiKey"
          placeholder="sk-..."
          value={settings.apiKey}
          onChange={(e) => onChange({ apiKey: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="requestMode">Request Mode</Label>
        <select
          id="requestMode"
          className="border-input bg-background text-sm rounded-md border px-3 py-2"
          value={settings.requestMode}
          onChange={(e) =>
            onChange({ requestMode: e.target.value as Settings["requestMode"] })
          }
        >
          <option value="auto">Auto (client first, fallback server)</option>
          <option value="client">Client only (browser direct)</option>
          <option value="server">Server only (/api/llm proxy)</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Auto: try browser fetch first, if it fails (e.g. CORS), fallback to server proxy.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="temperature">Temperature</Label>
          <Input
            id="temperature"
            type="number"
            min="0"
            max="2"
            step="0.1"
            placeholder="Default"
            value={settings.temperature ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") {
                onChange({ temperature: undefined });
                return;
              }
              const n = Number(v);
              if (!Number.isNaN(n)) onChange({ temperature: n });
            }}
          />
          <p className="text-xs text-muted-foreground">Empty = provider default</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxTokens">Max Tokens</Label>
          <Input
            id="maxTokens"
            type="number"
            min="1"
            step="1"
            placeholder="Default"
            value={settings.maxTokens ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") {
                onChange({ maxTokens: undefined });
                return;
              }
              const n = parseInt(v, 10);
              if (!Number.isNaN(n) && n > 0) onChange({ maxTokens: n });
            }}
          />
          <p className="text-xs text-muted-foreground">
            Empty = provider default (Anthropic falls back to 8192)
          </p>
        </div>
      </div>

    </div>
  );
}

export function ToolsForm({ value: settings, onChange }: SettingsFormProps) {
  const searchProviderConfig = SEARCH_PROVIDER_CONFIGS[settings.searchProvider] ?? null;
  const builtinSearchOn =
    (settings.provider === "openai-responses" &&
      (settings.responseBuiltinTools?.web_search || settings.responseBuiltinTools?.web_search_preview)) ||
    (settings.provider === "anthropic" && settings.anthropicBuiltinTools?.web_search);

  return (
    <div className="flex flex-col gap-3">
      {/* Built-in tools — shown first when using openai-responses */}
      {settings.provider === "openai-responses" && (
        <section className="rounded-lg border p-4 space-y-3">
          <div>
            <h3 className="text-sm font-medium">Built-in Tools</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Server-side tools executed by OpenAI. No API key required.
            </p>
          </div>
          {([
            { key: "web_search", label: "Web Search" },
            { key: "web_search_preview", label: "Web Search Preview" },
            { key: "image_generation", label: "Image Generation" },
            { key: "code_interpreter", label: "Code Interpreter" },
            { key: "file_search", label: "File Search" },
          ] as const).map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <Label htmlFor={`builtin-${key}`} className="text-sm font-normal">
                {label}
              </Label>
              <Switch
                id={`builtin-${key}`}
                checked={settings.responseBuiltinTools?.[key] ?? false}
                onCheckedChange={(checked) =>
                  onChange({
                    responseBuiltinTools: {
                      ...settings.responseBuiltinTools,
                      [key]: checked,
                    },
                  })
                }
              />
            </div>
          ))}
          {(settings.responseBuiltinTools?.web_search || settings.responseBuiltinTools?.web_search_preview) && (
            <div className="flex items-center justify-between gap-4 pl-1">
              <Label htmlFor="searchContextSize" className="text-xs text-muted-foreground">
                Search Context Size
              </Label>
              <select
                id="searchContextSize"
                className="border-input bg-background text-xs rounded-md border px-2 py-1 w-24"
                value={settings.responseBuiltinTools?.web_search_context_size ?? "medium"}
                onChange={(e) =>
                  onChange({
                    responseBuiltinTools: {
                      ...settings.responseBuiltinTools,
                      web_search_context_size: e.target.value as "low" | "medium" | "high",
                    },
                  })
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          )}
          {settings.responseBuiltinTools?.file_search && (
            <div className="space-y-1.5 pl-1">
              <Label htmlFor="vectorStoreIds" className="text-xs text-muted-foreground">
                Vector Store IDs (one per line)
              </Label>
              <textarea
                id="vectorStoreIds"
                placeholder="vs_abc123"
                value={(settings.responseBuiltinTools?.file_search_vector_store_ids ?? []).join("\n")}
                onChange={(e) =>
                  onChange({
                    responseBuiltinTools: {
                      ...settings.responseBuiltinTools,
                      file_search_vector_store_ids: e.target.value
                        .split("\n")
                        .map((s) => s.trim()),
                    },
                  })
                }
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-4 border-t pt-3">
            <div className="space-y-0.5">
              <Label htmlFor="responseStore" className="text-sm font-normal">Store Responses</Label>
              <p className="text-xs text-muted-foreground">
                Prompt caching (50% input discount).
              </p>
            </div>
            <Switch
              id="responseStore"
              checked={settings.responseStore ?? true}
              onCheckedChange={(checked) => onChange({ responseStore: checked })}
            />
          </div>
        </section>
      )}

      {/* Built-in tools — Anthropic */}
      {settings.provider === "anthropic" && (
        <section className="rounded-lg border p-4 space-y-3">
          <div>
            <h3 className="text-sm font-medium">Built-in Tools</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Server-side tools executed by Anthropic.
            </p>
          </div>
          {([
            { key: "web_search", label: "Web Search" },
            { key: "code_execution", label: "Code Execution" },
          ] as const).map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <Label htmlFor={`anthropic-${key}`} className="text-sm font-normal">
                {label}
              </Label>
              <Switch
                id={`anthropic-${key}`}
                checked={settings.anthropicBuiltinTools?.[key] ?? false}
                onCheckedChange={(checked) =>
                  onChange({
                    anthropicBuiltinTools: {
                      ...settings.anthropicBuiltinTools,
                      [key]: checked,
                    },
                  })
                }
              />
            </div>
          ))}
        </section>
      )}

      {/* Custom search tool — hidden when built-in search covers it */}
      {!builtinSearchOn && (
        <section className="rounded-lg border p-4 space-y-4">
          <div>
            <h3 className="text-sm font-medium">
              {settings.provider === "openai-responses" || settings.provider === "anthropic"
                ? "Custom Search"
                : "Web Search"}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {settings.provider === "openai-responses" || settings.provider === "anthropic"
                ? "Local search tool via third-party API. Used when built-in search is off."
                : "Enable web search for the AI assistant via third-party API."}
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="searchEnabledByDefault" className="text-sm font-normal">
              Enable by default
            </Label>
            <Switch
              id="searchEnabledByDefault"
              checked={settings.searchEnabledByDefault}
              onCheckedChange={(checked) =>
                onChange({ searchEnabledByDefault: checked })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="searchProvider">Search Engine</Label>
            <select
              id="searchProvider"
              className="border-input bg-background text-sm rounded-md border px-3 py-2 w-full"
              value={settings.searchProvider}
              onChange={(e) =>
                onChange({ searchProvider: e.target.value as SearchProviderId })
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
                    onChange({
                      [searchProviderConfig.apiKeyField]: e.target.value,
                    } as Partial<Settings>)
                  }
                />
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
                    onChange({
                      [searchProviderConfig.baseUrlField]: e.target.value,
                    } as Partial<Settings>)
                  }
                />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

export function PromptForm({ value: settings, onChange }: SettingsFormProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <Label htmlFor="systemPrompt">System Prompt</Label>
        <Textarea
          id="systemPrompt"
          placeholder="Custom system prompt..."
          value={settings.systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
          className="min-h-48"
        />
        <p className="text-xs text-muted-foreground">
          Instructions sent at the start of every conversation. Leave empty for provider default.
        </p>
      </div>
    </div>
  );
}
