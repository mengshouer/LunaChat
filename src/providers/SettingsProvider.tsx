"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import {
  APP_CONFIG_ID,
  API_KEY_FIELDS,
  DEFAULT_SETTINGS,
  applyProfileSettings,
  normalizeProfile,
  profileToSettings,
  validateSettings,
  type AppConfigRecord,
  type ConfigProfile,
  type EncryptionMeta,
  type Settings,
} from "@/lib/settings-types";
import {
  deriveKey,
  decryptString,
  encryptString,
  exportKeyRaw,
  importKeyRaw,
  isEncrypted,
  randomSalt,
} from "@/lib/crypto";
import {
  applyImport,
  combineImportedProfiles,
  parseImportProfiles,
  resetAllData,
  type ExportData,
  type RestoreResult,
} from "@/lib/config-io";
import { SettingsWriteQueue } from "@/lib/settings-write-queue";

export type {
  AppConfigRecord,
  ConfigProfile,
  EncryptionMeta,
  RequestMode,
  Settings,
} from "@/lib/settings-types";

interface SettingsContextValue {
  settings: Settings;
  isConfigured: boolean;
  profiles: ConfigProfile[];
  activeProfileId: string | null;
  switchProfile: (id: string) => Promise<void>;
  createProfile: (name?: string) => Promise<string>;
  deleteProfile: (id: string) => Promise<void>;
  renameProfile: (id: string, name: string) => Promise<void>;
  duplicateProfile: (id: string) => Promise<string>;
  saveProfile: (id: string, settings: Settings) => Promise<void>;
  getProfileById: (id: string) => ConfigProfile | undefined;
  restoreImportedData: (data: ExportData) => Promise<RestoreResult>;
  encryptionEnabled: boolean;
  keysLocked: boolean;
  unlock: (passphrase: string) => Promise<boolean>;
  enableEncryption: (passphrase: string) => Promise<void>;
  disableEncryption: () => Promise<void>;
  changePassphrase: (passphrase: string) => Promise<void>;
  resetEncryption: () => Promise<void>;
  resetApplicationData: () => Promise<void>;
}

const SESSION_KEY_STORAGE = "chat-app-session-key";
const CHECK_VALUE = "chat-app-check";

const SettingsContext = createContext<SettingsContextValue | null>(null);

function clearStoredSessionKey(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY_STORAGE);
  } catch {
    // The in-memory key remains authoritative for the current page lifetime.
  }
}

function createDefaultProfile(): ConfigProfile {
  return {
    id: uuidv4(),
    name: DEFAULT_SETTINGS.model || "Default",
    ...DEFAULT_SETTINGS,
  };
}

function normalizeConfigRecord(value: unknown): AppConfigRecord {
  const source =
    value && typeof value === "object"
      ? (value as Partial<AppConfigRecord> & {
          profiles?: unknown;
          activeProfileId?: unknown;
          encryption?: unknown;
        })
      : {};
  const rawProfiles = Array.isArray(source.profiles) ? source.profiles : [];
  const profiles = rawProfiles
    .filter(
      (profile): profile is ConfigProfile & Record<string, unknown> =>
        !!profile &&
        typeof profile === "object" &&
        typeof (profile as { id?: unknown }).id === "string",
    )
    .map((profile) => normalizeProfile(profile));
  if (profiles.length === 0) profiles.push(createDefaultProfile());
  const requestedActiveId =
    typeof source.activeProfileId === "string" ? source.activeProfileId : null;
  const activeProfileId = profiles.some((p) => p.id === requestedActiveId)
    ? requestedActiveId
    : profiles[0].id;
  const encryption =
    source.encryption &&
    typeof source.encryption === "object" &&
    typeof (source.encryption as EncryptionMeta).salt === "string" &&
    typeof (source.encryption as EncryptionMeta).check === "string"
      ? (source.encryption as EncryptionMeta)
      : undefined;
  return {
    id: APP_CONFIG_ID,
    profiles,
    activeProfileId,
    ...(encryption ? { encryption } : {}),
  };
}

async function loadConfig(): Promise<AppConfigRecord> {
  return db.transaction("rw", db.appConfig, async () => {
    const existing = await db.appConfig.get(APP_CONFIG_ID);
    const normalized = normalizeConfigRecord(existing);
    await db.appConfig.put(normalized);
    return normalized;
  });
}

// Blanks any API key still held as ciphertext (i.e. while locked). Returns the
// profile unchanged when there is nothing to blank, so callers that memoize on
// identity are not invalidated on every render.
function sanitizeProfileKeys(profile: ConfigProfile): ConfigProfile {
  const encryptedFields = API_KEY_FIELDS.filter((field) =>
    isEncrypted(profile[field]),
  );
  if (encryptedFields.length === 0) return profile;
  const sanitized = { ...profile };
  for (const field of encryptedFields) sanitized[field] = "";
  return sanitized;
}

async function encryptProfileKeys(
  profile: ConfigProfile,
  key: CryptoKey,
): Promise<ConfigProfile> {
  const next = { ...profile };
  for (const field of API_KEY_FIELDS) {
    const value = next[field];
    if (value && !isEncrypted(value)) next[field] = await encryptString(key, value);
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
    if (value && isEncrypted(value)) next[field] = await decryptString(key, value);
  }
  return next;
}

async function toStoredConfig(
  profiles: ConfigProfile[],
  activeProfileId: string | null,
  encryption: EncryptionMeta | null,
  key: CryptoKey | null,
): Promise<AppConfigRecord> {
  let storedProfiles = profiles;
  if (encryption) {
    if (!key) {
      const hasPlaintextKey = profiles.some((profile) =>
        API_KEY_FIELDS.some(
          (field) => profile[field] && !isEncrypted(profile[field]),
        ),
      );
      if (hasPlaintextKey) throw new Error("Unlock API keys first");
    } else {
      storedProfiles = await Promise.all(
        profiles.map((profile) => encryptProfileKeys(profile, key)),
      );
    }
  }
  return {
    id: APP_CONFIG_ID,
    profiles: storedProfiles,
    activeProfileId,
    ...(encryption ? { encryption } : {}),
  };
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [encryption, setEncryption] = useState<EncryptionMeta | null>(null);
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [mounted, setMounted] = useState(false);

  const profilesRef = useRef(profiles);
  const activeProfileIdRef = useRef(activeProfileId);
  const encryptionRef = useRef(encryption);
  const cryptoKeyRef = useRef(cryptoKey);
  const writeQueueRef = useRef(new SettingsWriteQueue());
  profilesRef.current = profiles;
  activeProfileIdRef.current = activeProfileId;
  encryptionRef.current = encryption;
  cryptoKeyRef.current = cryptoKey;

  const enqueue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    return writeQueueRef.current.enqueue(work);
  }, []);

  const storeSessionKey = useCallback(async (key: CryptoKey) => {
    try {
      sessionStorage.setItem(SESSION_KEY_STORAGE, await exportKeyRaw(key));
    } catch {
      // The in-memory key remains valid; refresh will require the passphrase.
    }
  }, []);

  const applyLoaded = useCallback(async (record: AppConfigRecord) => {
    let key: CryptoKey | null = null;
    let loadedProfiles = record.profiles;
    if (record.encryption) {
      try {
        const raw = sessionStorage.getItem(SESSION_KEY_STORAGE);
        if (raw) {
          const candidate = await importKeyRaw(raw);
          if ((await decryptString(candidate, record.encryption.check)) === CHECK_VALUE) {
            key = candidate;
            loadedProfiles = await Promise.all(
              record.profiles.map((profile) =>
                decryptProfileKeys(profile, candidate),
              ),
            );
          }
        }
      } catch {
        key = null;
        loadedProfiles = record.profiles;
        clearStoredSessionKey();
      }
    }
    profilesRef.current = loadedProfiles;
    activeProfileIdRef.current = record.activeProfileId;
    encryptionRef.current = record.encryption ?? null;
    cryptoKeyRef.current = key;
    setProfiles(loadedProfiles);
    setActiveProfileId(record.activeProfileId);
    setEncryption(record.encryption ?? null);
    setCryptoKey(key);
  }, []);

  useEffect(() => {
    loadConfig()
      .then(applyLoaded)
      .catch(console.error)
      .finally(() => setMounted(true));
  }, [applyLoaded]);

  const commit = useCallback(
    async (
      nextProfiles: ConfigProfile[],
      nextActiveProfileId: string | null,
      nextEncryption = encryptionRef.current,
      nextKey = cryptoKeyRef.current,
    ) => {
      const record = await toStoredConfig(
        nextProfiles,
        nextActiveProfileId,
        nextEncryption,
        nextKey,
      );
      await db.appConfig.put(record);
      profilesRef.current = nextProfiles;
      activeProfileIdRef.current = nextActiveProfileId;
      encryptionRef.current = nextEncryption;
      cryptoKeyRef.current = nextKey;
      setProfiles(nextProfiles);
      setActiveProfileId(nextActiveProfileId);
      setEncryption(nextEncryption);
      setCryptoKey(nextKey);
    },
    [],
  );

  const saveProfile = useCallback(
    (id: string, nextSettings: Settings) =>
      enqueue(async () => {
        validateSettings(nextSettings);
        if (encryptionRef.current && !cryptoKeyRef.current) {
          throw new Error("Unlock API keys first");
        }
        const current = profilesRef.current;
        const found = current.find((profile) => profile.id === id);
        if (!found) throw new Error("Profile no longer exists");
        const nextProfiles = current.map((profile) =>
          profile.id === id
            ? applyProfileSettings(profile, nextSettings)
            : profile,
        );
        await commit(nextProfiles, activeProfileIdRef.current);
      }),
    [commit, enqueue],
  );

  const switchProfile = useCallback(
    (id: string) =>
      enqueue(async () => {
        if (!profilesRef.current.some((profile) => profile.id === id)) return;
        await commit(profilesRef.current, id);
      }),
    [commit, enqueue],
  );

  const createProfile = useCallback(
    (name?: string) =>
      enqueue(async () => {
        const profile = createDefaultProfile();
        if (name?.trim()) profile.name = name.trim();
        await commit(
          [...profilesRef.current, profile],
          activeProfileIdRef.current ?? profile.id,
        );
        return profile.id;
      }),
    [commit, enqueue],
  );

  const deleteProfile = useCallback(
    (id: string) =>
      enqueue(async () => {
        const current = profilesRef.current;
        if (current.length <= 1) return;
        const next = current.filter((profile) => profile.id !== id);
        if (next.length === current.length) return;
        const nextActiveId =
          activeProfileIdRef.current === id
            ? next[0].id
            : activeProfileIdRef.current;
        await commit(next, nextActiveId);
      }),
    [commit, enqueue],
  );

  const renameProfile = useCallback(
    (id: string, name: string) =>
      enqueue(async () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const next = profilesRef.current.map((profile) =>
          profile.id === id ? { ...profile, name: trimmed } : profile,
        );
        await commit(next, activeProfileIdRef.current);
      }),
    [commit, enqueue],
  );

  const duplicateProfile = useCallback(
    (id: string) =>
      enqueue(async () => {
        const source = profilesRef.current.find((profile) => profile.id === id);
        if (!source) throw new Error("Profile no longer exists");
        const copy: ConfigProfile = {
          ...source,
          id: uuidv4(),
          name: `${source.name} (copy)`,
        };
        await commit(
          [...profilesRef.current, copy],
          activeProfileIdRef.current ?? copy.id,
        );
        return copy.id;
      }),
    [commit, enqueue],
  );

  const restoreImportedData = useCallback(
    (data: ExportData) =>
      enqueue(async (): Promise<RestoreResult> => {
        const imported = parseImportProfiles(data);
        const combined = combineImportedProfiles(
          data.mode,
          profilesRef.current,
          imported,
          data.configs.activeProfileId,
          activeProfileIdRef.current,
        );
        const record = await toStoredConfig(
          combined.profiles,
          combined.activeProfileId,
          encryptionRef.current,
          cryptoKeyRef.current,
        );
        const result = await applyImport(data, record);
        profilesRef.current = combined.profiles;
        activeProfileIdRef.current = combined.activeProfileId;
        setProfiles(combined.profiles);
        setActiveProfileId(combined.activeProfileId);
        return {
          ...result,
          profileCount: imported.length,
          addedProfileCount: combined.addedProfileCount,
        };
      }),
    [enqueue],
  );

  const unlock = useCallback(
    (passphrase: string) =>
      enqueue(async () => {
        const meta = encryptionRef.current;
        if (!meta) return true;
        try {
          const key = await deriveKey(passphrase, meta.salt);
          if ((await decryptString(key, meta.check)) !== CHECK_VALUE) return false;
          const decrypted = await Promise.all(
            profilesRef.current.map((profile) => decryptProfileKeys(profile, key)),
          );
          profilesRef.current = decrypted;
          cryptoKeyRef.current = key;
          setProfiles(decrypted);
          setCryptoKey(key);
          await storeSessionKey(key);
          return true;
        } catch {
          return false;
        }
      }),
    [enqueue, storeSessionKey],
  );

  const enableEncryption = useCallback(
    (passphrase: string) =>
      enqueue(async () => {
        if (encryptionRef.current) throw new Error("Encryption already enabled");
        const salt = randomSalt();
        const key = await deriveKey(passphrase, salt);
        const meta: EncryptionMeta = {
          salt,
          check: await encryptString(key, CHECK_VALUE),
        };
        await commit(profilesRef.current, activeProfileIdRef.current, meta, key);
        await storeSessionKey(key);
      }),
    [commit, enqueue, storeSessionKey],
  );

  const changePassphrase = useCallback(
    (passphrase: string) =>
      enqueue(async () => {
        if (!encryptionRef.current || !cryptoKeyRef.current) {
          throw new Error("Unlock first");
        }
        const salt = randomSalt();
        const key = await deriveKey(passphrase, salt);
        const meta: EncryptionMeta = {
          salt,
          check: await encryptString(key, CHECK_VALUE),
        };
        await commit(profilesRef.current, activeProfileIdRef.current, meta, key);
        await storeSessionKey(key);
      }),
    [commit, enqueue, storeSessionKey],
  );

  const disableEncryption = useCallback(
    () =>
      enqueue(async () => {
        if (!encryptionRef.current) return;
        if (!cryptoKeyRef.current) throw new Error("Unlock first");
        await commit(profilesRef.current, activeProfileIdRef.current, null, null);
        clearStoredSessionKey();
      }),
    [commit, enqueue],
  );

  const resetEncryption = useCallback(
    () =>
      enqueue(async () => {
        const cleared = profilesRef.current.map((profile) => ({
          ...profile,
          apiKey: "",
          exaApiKey: "",
          tavilyApiKey: "",
        }));
        await commit(cleared, activeProfileIdRef.current, null, null);
        clearStoredSessionKey();
      }),
    [commit, enqueue],
  );

  const resetApplicationData = useCallback(
    () => writeQueueRef.current.enqueueFinal(resetAllData),
    [],
  );

  // Everything handed out through the context is key-sanitized. While unlocked
  // nothing in memory is ciphertext, so this is a no-op and object identity is
  // preserved (ChatProvider memoizes on these). While locked it is the reason
  // no consumer can render ciphertext into an input — the guard lives here
  // rather than at each call site that opens the settings dialog.
  const visibleProfiles = useMemo(() => {
    let changed = false;
    const next = profiles.map((profile) => {
      const sanitized = sanitizeProfileKeys(profile);
      if (sanitized !== profile) changed = true;
      return sanitized;
    });
    return changed ? next : profiles;
  }, [profiles]);

  const getProfileById = useCallback(
    (id: string) => {
      const found = profilesRef.current.find((profile) => profile.id === id);
      return found ? sanitizeProfileKeys(found) : undefined;
    },
    [],
  );

  if (!mounted) return null;

  const activeProfile = activeProfileId
    ? visibleProfiles.find((profile) => profile.id === activeProfileId)
    : undefined;
  const settings = activeProfile
    ? profileToSettings(activeProfile)
    : DEFAULT_SETTINGS;
  const encryptionEnabled = encryption !== null;
  const keysLocked = encryptionEnabled && cryptoKey === null;

  return (
    <SettingsContext.Provider
      value={{
        settings,
        isConfigured: Boolean(settings.baseUrl && settings.model),
        profiles: visibleProfiles,
        activeProfileId,
        switchProfile,
        createProfile,
        deleteProfile,
        renameProfile,
        duplicateProfile,
        saveProfile,
        getProfileById,
        restoreImportedData,
        encryptionEnabled,
        keysLocked,
        unlock,
        enableEncryption,
        disableEncryption,
        changePassphrase,
        resetEncryption,
        resetApplicationData,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used within SettingsProvider");
  return context;
}
