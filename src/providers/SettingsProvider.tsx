"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ProviderType } from "@/lib/llm/types";
import type { SearchProviderId } from "@/lib/tools/net-search/types";

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
  searchEnabled: boolean;
}

export interface ConfigProfile extends Settings {
  id: string;
  name: string;
}

interface ConfigsData {
  profiles: ConfigProfile[];
  activeProfileId: string | null;
}

interface SettingsContextValue {
  settings: Settings;
  updateSettings: (updates: Partial<Settings>) => void;
  isConfigured: boolean;
  // Multi-profile APIs
  profiles: ConfigProfile[];
  activeProfileId: string | null;
  switchProfile: (id: string) => void;
  createProfile: (name?: string) => string;
  deleteProfile: (id: string) => void;
  renameProfile: (id: string, name: string) => void;
  duplicateProfile: (id: string) => string;
  getProfileById: (id: string) => ConfigProfile | undefined;
  reloadConfigs: () => void;
}

const DEFAULT_SETTINGS: Settings = {
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
  searchEnabled: false,
};

const OLD_STORAGE_KEY = "chat-app-settings";
const CONFIGS_STORAGE_KEY = "chat-app-configs";

const SettingsContext = createContext<SettingsContextValue | null>(null);

function detectProvider(settings: Pick<Settings, "model" | "baseUrl">): ProviderType {
  const model = settings.model.toLowerCase();
  const baseUrl = settings.baseUrl.toLowerCase();
  if (model.includes("claude") || baseUrl.includes("anthropic")) {
    return "anthropic";
  }
  return "openai";
}

function createDefaultProfile(overrides?: Partial<Settings>): ConfigProfile {
  const merged = { ...DEFAULT_SETTINGS, ...overrides };
  return {
    id: uuidv4(),
    name: merged.model || "Default",
    ...merged,
  };
}

function loadConfigs(): ConfigsData {
  if (typeof window === "undefined") {
    const profile = createDefaultProfile();
    return { profiles: [profile], activeProfileId: profile.id };
  }

  try {
    // Try new key first
    const stored = localStorage.getItem(CONFIGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as ConfigsData;
      if (parsed.profiles && parsed.profiles.length > 0) {
        parsed.profiles = parsed.profiles.map((p) => ({
          ...DEFAULT_SETTINGS,
          ...p,
        }));
        return parsed;
      }
    }

    // Migrate from old key
    const oldStored = localStorage.getItem(OLD_STORAGE_KEY);
    if (oldStored) {
      const oldSettings = JSON.parse(oldStored) as Partial<Settings>;
      const merged: Settings = {
        ...DEFAULT_SETTINGS,
        ...oldSettings,
        requestMode: oldSettings.requestMode ?? "auto",
      };
      const profile: ConfigProfile = {
        id: uuidv4(),
        name: merged.model || "Default",
        ...merged,
      };
      const data: ConfigsData = { profiles: [profile], activeProfileId: profile.id };
      localStorage.setItem(CONFIGS_STORAGE_KEY, JSON.stringify(data));
      localStorage.removeItem(OLD_STORAGE_KEY);
      return data;
    }
  } catch {
    // pass
  }

  // No data at all — create a blank profile
  const profile = createDefaultProfile();
  return { profiles: [profile], activeProfileId: profile.id };
}

function saveConfigs(data: ConfigsData) {
  try {
    localStorage.setItem(CONFIGS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // pass
  }
}

function resolveActiveProfile(profiles: ConfigProfile[], activeProfileId: string | null): ConfigProfile {
  if (activeProfileId) {
    const found = profiles.find((p) => p.id === activeProfileId);
    if (found) return found;
  }
  return profiles[0];
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const data = loadConfigs();
    setProfiles(data.profiles);
    setActiveProfileId(data.activeProfileId);
    setMounted(true);
  }, []);

  // Derived active profile & settings
  const activeProfile = profiles.length > 0 ? resolveActiveProfile(profiles, activeProfileId) : null;
  const settings: Settings = activeProfile
    ? (() => {
        const { id: _, name: __, ...profileSettings } = activeProfile;
        return { ...DEFAULT_SETTINGS, ...profileSettings };
      })()
    : DEFAULT_SETTINGS;

  const isConfigured = Boolean(settings.baseUrl && settings.model);

  const persist = useCallback((nextProfiles: ConfigProfile[], nextActiveId: string | null) => {
    const data: ConfigsData = { profiles: nextProfiles, activeProfileId: nextActiveId };
    saveConfigs(data);
  }, []);

  const updateSettings = useCallback(
    (updates: Partial<Settings>) => {
      setProfiles((prev) => {
        const currentActive = resolveActiveProfile(prev, activeProfileId);
        const next = prev.map((p) => {
          if (p.id !== currentActive.id) return p;
          const updated = { ...p, ...updates };
          // Auto-detect provider
          if (
            updates.provider === undefined &&
            (updates.model !== undefined || updates.baseUrl !== undefined)
          ) {
            updated.provider = detectProvider(updated);
          }
          if (!updated.requestMode) {
            updated.requestMode = "auto";
          }
          return updated;
        });
        persist(next, activeProfileId);
        return next;
      });
    },
    [activeProfileId, persist],
  );

  const switchProfile = useCallback(
    (id: string) => {
      setActiveProfileId(id);
      setProfiles((prev) => {
        persist(prev, id);
        return prev;
      });
    },
    [persist],
  );

  const createProfile = useCallback(
    (name?: string) => {
      const profile = createDefaultProfile();
      if (name) profile.name = name;
      setProfiles((prev) => {
        const next = [...prev, profile];
        persist(next, profile.id);
        return next;
      });
      setActiveProfileId(profile.id);
      return profile.id;
    },
    [persist],
  );

  const deleteProfile = useCallback(
    (id: string) => {
      setProfiles((prev) => {
        if (prev.length <= 1) return prev; // keep at least one
        const next = prev.filter((p) => p.id !== id);
        const newActiveId = activeProfileId === id ? next[0].id : activeProfileId;
        if (activeProfileId === id) {
          setActiveProfileId(newActiveId);
        }
        persist(next, newActiveId);
        return next;
      });
    },
    [activeProfileId, persist],
  );

  const renameProfile = useCallback(
    (id: string, name: string) => {
      setProfiles((prev) => {
        const next = prev.map((p) => (p.id === id ? { ...p, name } : p));
        persist(next, activeProfileId);
        return next;
      });
    },
    [activeProfileId, persist],
  );

  const duplicateProfile = useCallback(
    (id: string) => {
      const source = profiles.find((p) => p.id === id);
      if (!source) return createProfile();
      const newProfile: ConfigProfile = {
        ...source,
        id: uuidv4(),
        name: `${source.name} (copy)`,
      };
      setProfiles((prev) => {
        const next = [...prev, newProfile];
        persist(next, newProfile.id);
        return next;
      });
      setActiveProfileId(newProfile.id);
      return newProfile.id;
    },
    [profiles, persist, createProfile],
  );

  const getProfileById = useCallback(
    (id: string) => profiles.find((p) => p.id === id),
    [profiles],
  );

  const reloadConfigs = useCallback(() => {
    const data = loadConfigs();
    setProfiles(data.profiles);
    setActiveProfileId(data.activeProfileId);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <SettingsContext.Provider
      value={{
        settings,
        updateSettings,
        isConfigured,
        profiles,
        activeProfileId,
        switchProfile,
        createProfile,
        deleteProfile,
        renameProfile,
        duplicateProfile,
        getProfileById,
        reloadConfigs,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
