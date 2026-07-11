"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ProviderType } from "@/lib/llm/types";
import type { SearchProviderId } from "@/lib/tools/net-search/types";
import {
  deriveKey,
  encryptString,
  decryptString,
  isEncrypted,
  randomSalt,
  exportKeyRaw,
  importKeyRaw,
} from "@/lib/crypto";

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

// Passphrase encryption metadata (one passphrase covers all profiles).
// check = encryptString(derivedKey, CHECK_VALUE); unlock verifies the
// passphrase by decrypting it. The passphrase itself is never stored.
interface EncryptionMeta {
  salt: string;
  check: string;
}

interface ConfigsData {
  profiles: ConfigProfile[];
  activeProfileId: string | null;
  encryption?: EncryptionMeta;
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
  // API key encryption
  encryptionEnabled: boolean;
  keysLocked: boolean;
  unlock: (passphrase: string) => Promise<boolean>;
  enableEncryption: (passphrase: string) => Promise<void>;
  disableEncryption: () => Promise<void>;
  changePassphrase: (passphrase: string) => Promise<void>;
  resetEncryption: () => void;
  // Encrypt a key value the way persist() would (identity when encryption is
  // off). Used by the import path, which writes localStorage directly.
  // Throws while locked.
  encryptForStorage: (value: string) => Promise<string>;
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
const SESSION_KEY_STORAGE = "chat-app-session-key";
const CHECK_VALUE = "chat-app-check";

export const API_KEY_FIELDS = ["apiKey", "exaApiKey", "tavilyApiKey"] as const;
type ApiKeyField = (typeof API_KEY_FIELDS)[number];

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

async function encryptProfileKeys(
  profile: ConfigProfile,
  key: CryptoKey,
): Promise<ConfigProfile> {
  const next = { ...profile };
  for (const field of API_KEY_FIELDS) {
    const value = next[field];
    if (value && !isEncrypted(value)) {
      next[field] = await encryptString(key, value);
    }
  }
  return next;
}

async function decryptProfileKeys(
  profile: ConfigProfile,
  key: CryptoKey,
): Promise<ConfigProfile> {
  const next = { ...profile };
  for (const field of API_KEY_FIELDS) {
    const value = next[field];
    if (value && isEncrypted(value)) {
      next[field] = await decryptString(key, value);
    }
  }
  return next;
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
        // Normalize a null/dangling activeProfileId so the steady state is
        // always resolvable (updateSettings refuses to write otherwise).
        if (
          !parsed.activeProfileId ||
          !parsed.profiles.some((p) => p.id === parsed.activeProfileId)
        ) {
          parsed.activeProfileId = parsed.profiles[0].id;
        }
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
  const [encryption, setEncryption] = useState<EncryptionMeta | null>(null);
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [mounted, setMounted] = useState(false);

  // persist() runs inside sync state updaters; refs keep it seeing the
  // current encryption state without threading it through every caller.
  const encryptionRef = useRef<EncryptionMeta | null>(null);
  const cryptoKeyRef = useRef<CryptoKey | null>(null);
  encryptionRef.current = encryption;
  cryptoKeyRef.current = cryptoKey;

  const applyLoaded = useCallback(async (data: ConfigsData) => {
    let key: CryptoKey | null = null;
    let loadedProfiles = data.profiles;
    if (data.encryption) {
      // Restore the session key (survives F5, cleared when the tab closes)
      try {
        const raw = sessionStorage.getItem(SESSION_KEY_STORAGE);
        if (raw) {
          const candidate = await importKeyRaw(raw);
          if ((await decryptString(candidate, data.encryption.check)) === CHECK_VALUE) {
            key = candidate;
          }
        }
      } catch {
        sessionStorage.removeItem(SESSION_KEY_STORAGE);
      }
      if (key) {
        const k = key;
        loadedProfiles = await Promise.all(
          loadedProfiles.map((p) => decryptProfileKeys(p, k)),
        );
      }
    }
    setEncryption(data.encryption ?? null);
    setCryptoKey(key);
    setProfiles(loadedProfiles);
    setActiveProfileId(data.activeProfileId);
  }, []);

  useEffect(() => {
    applyLoaded(loadConfigs())
      .catch(console.error)
      .finally(() => setMounted(true));
  }, [applyLoaded]);

  // Derived active profile & settings
  const activeProfile = profiles.length > 0 ? resolveActiveProfile(profiles, activeProfileId) : null;
  const settings: Settings = activeProfile
    ? (() => {
        const { id: _, name: __, ...profileSettings } = activeProfile;
        const merged = { ...DEFAULT_SETTINGS, ...profileSettings };
        // Locked: key fields hold ciphertext — expose them as empty so
        // consumers (hasSearchApiKey, request builders) degrade naturally.
        for (const field of API_KEY_FIELDS) {
          if (isEncrypted(merged[field])) merged[field] = "";
        }
        return merged;
      })()
    : DEFAULT_SETTINGS;

  const isConfigured = Boolean(settings.baseUrl && settings.model);
  const encryptionEnabled = encryption !== null;
  const keysLocked = encryptionEnabled && cryptoKey === null;

  const persist = useCallback((nextProfiles: ConfigProfile[], nextActiveId: string | null) => {
    const meta = encryptionRef.current;
    const key = cryptoKeyRef.current;
    const write = (storedProfiles: ConfigProfile[]) =>
      saveConfigs({
        profiles: storedProfiles,
        activeProfileId: nextActiveId,
        ...(meta ? { encryption: meta } : {}),
      });
    if (meta && key) {
      // In-memory profiles are plaintext while unlocked; encrypt key fields
      // on the way to localStorage. Locked profiles already hold ciphertext
      // (key-field updates are ignored while locked), passing through as-is.
      Promise.all(nextProfiles.map((p) => encryptProfileKeys(p, key)))
        .then(write)
        .catch(console.error);
    } else {
      write(nextProfiles);
    }
  }, []);

  const updateSettings = useCallback(
    (updates: Partial<Settings>) => {
      if (encryptionRef.current && cryptoKeyRef.current === null) {
        // Locked: silently drop key-field edits (UI disables them too)
        updates = { ...updates };
        for (const field of API_KEY_FIELDS) delete updates[field];
      }
      setProfiles((prev) => {
        // Write path must target the resolved active profile only. If
        // activeProfileId no longer resolves (e.g. cross-tab edit), no-op
        // rather than silently writing into profiles[0].
        const currentActive = activeProfileId
          ? prev.find((p) => p.id === activeProfileId)
          : undefined;
        if (!currentActive) return prev;
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
    applyLoaded(loadConfigs()).catch(console.error);
  }, [applyLoaded]);

  const storeSessionKey = useCallback(async (key: CryptoKey) => {
    try {
      sessionStorage.setItem(SESSION_KEY_STORAGE, await exportKeyRaw(key));
    } catch {
      // pass — worst case the user re-enters the passphrase after refresh
    }
  }, []);

  const unlock = useCallback(
    async (passphrase: string): Promise<boolean> => {
      const meta = encryptionRef.current;
      if (!meta) return true;
      let key: CryptoKey;
      try {
        key = await deriveKey(passphrase, meta.salt);
        if ((await decryptString(key, meta.check)) !== CHECK_VALUE) return false;
      } catch {
        return false;
      }
      const decrypted = await Promise.all(
        profiles.map((p) => decryptProfileKeys(p, key)),
      );
      setProfiles(decrypted);
      setCryptoKey(key);
      cryptoKeyRef.current = key;
      await storeSessionKey(key);
      return true;
    },
    [profiles, storeSessionKey],
  );

  // Shared by enableEncryption / changePassphrase: derive a key from a new
  // salt, write the check value, re-encrypt all profiles on persist.
  const applyPassphrase = useCallback(
    async (passphrase: string) => {
      const salt = randomSalt();
      const key = await deriveKey(passphrase, salt);
      const meta: EncryptionMeta = {
        salt,
        check: await encryptString(key, CHECK_VALUE),
      };
      setEncryption(meta);
      setCryptoKey(key);
      encryptionRef.current = meta;
      cryptoKeyRef.current = key;
      await storeSessionKey(key);
      persist(profiles, activeProfileId);
    },
    [profiles, activeProfileId, persist, storeSessionKey],
  );

  const enableEncryption = useCallback(
    async (passphrase: string) => {
      if (encryptionRef.current) throw new Error("Encryption already enabled");
      await applyPassphrase(passphrase);
    },
    [applyPassphrase],
  );

  const changePassphrase = useCallback(
    async (passphrase: string) => {
      if (!encryptionRef.current || !cryptoKeyRef.current) {
        throw new Error("Unlock first");
      }
      await applyPassphrase(passphrase);
    },
    [applyPassphrase],
  );

  const disableEncryption = useCallback(async () => {
    if (!encryptionRef.current) return;
    if (!cryptoKeyRef.current) throw new Error("Unlock first");
    setEncryption(null);
    setCryptoKey(null);
    encryptionRef.current = null;
    cryptoKeyRef.current = null;
    sessionStorage.removeItem(SESSION_KEY_STORAGE);
    // In-memory profiles are plaintext; persisting now writes them back out
    persist(profiles, activeProfileId);
  }, [profiles, activeProfileId, persist]);

  const encryptForStorage = useCallback(async (value: string) => {
    if (!encryptionRef.current) return value;
    const key = cryptoKeyRef.current;
    if (!key) throw new Error("Unlock first");
    return value && !isEncrypted(value) ? encryptString(key, value) : value;
  }, []);

  // Forgot passphrase: keys are unrecoverable by design — clear them and
  // turn encryption off. Everything else (profiles, chats) stays intact.
  const resetEncryption = useCallback(() => {
    setEncryption(null);
    setCryptoKey(null);
    encryptionRef.current = null;
    cryptoKeyRef.current = null;
    sessionStorage.removeItem(SESSION_KEY_STORAGE);
    setProfiles((prev) => {
      const next = prev.map((p) => ({
        ...p,
        apiKey: "",
        exaApiKey: "",
        tavilyApiKey: "",
      }));
      persist(next, activeProfileId);
      return next;
    });
  }, [activeProfileId, persist]);

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
        encryptionEnabled,
        keysLocked,
        unlock,
        enableEncryption,
        disableEncryption,
        changePassphrase,
        resetEncryption,
        encryptForStorage,
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
