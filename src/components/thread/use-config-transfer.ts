"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useThreads } from "@/providers/ThreadProvider";
import { useSettings } from "@/providers/SettingsProvider";
import { useChat } from "@/providers/chat";
import {
  exportPlainWithoutKeys,
  exportEncrypted,
  downloadJson,
  readImportFile,
  decryptExportFile,
  isEncryptedExportFile,
  type ExportData,
  type EncryptedExportFile,
} from "@/lib/config-io";

export type ExportMode = "encrypted" | "plain";

// Bundles the export / import / reset data-transfer flows (panel state, file
// input ref, passphrase dialogs) so the header, export panel and dialogs can
// share them without threading a dozen props through Thread.
export interface ConfigTransfer {
  showExportPanel: boolean;
  setShowExportPanel: (v: boolean | ((p: boolean) => boolean)) => void;
  exportIncludeChat: boolean;
  setExportIncludeChat: (v: boolean) => void;
  exportMode: ExportMode;
  setExportMode: (v: ExportMode) => void;
  exportPassOpen: boolean;
  setExportPassOpen: (v: boolean) => void;
  importPassOpen: boolean;
  setImportPassOpen: (v: boolean) => void;
  pendingImport: EncryptedExportFile | null;
  setPendingImport: (v: EncryptedExportFile | null) => void;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  handleExport: () => Promise<void>;
  handleEncryptedExport: (passphrase: string) => Promise<void>;
  handleImportFile: (file: File) => Promise<void>;
  handleImportPassphrase: (passphrase: string) => Promise<void>;
  handleReset: () => Promise<void>;
}

export function useConfigTransfer({
  onRequireUnlock,
}: {
  onRequireUnlock: () => void;
}): ConfigTransfer {
  const { refreshThreads } = useThreads();
  const {
    keysLocked,
    profiles,
    activeProfileId,
    restoreImportedData,
    resetApplicationData,
  } = useSettings();
  const { activeTurnCount, abortAllTurns } = useChat();

  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportIncludeChat, setExportIncludeChat] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>("encrypted");
  const [exportPassOpen, setExportPassOpen] = useState(false);
  const [importPassOpen, setImportPassOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<EncryptedExportFile | null>(
    null,
  );
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async () => {
    if (exportMode === "plain") {
      try {
        const data = await exportPlainWithoutKeys(exportIncludeChat, {
          profiles,
          activeProfileId,
        });
        downloadJson(data, exportIncludeChat);
        setShowExportPanel(false);
        toast.success("Exported successfully");
      } catch {
        toast.error("Export failed");
      }
      return;
    }
    // Encrypted backup embeds plaintext keys — unlock first when locked
    if (keysLocked) {
      onRequireUnlock();
      return;
    }
    setExportPassOpen(true);
  }, [
    exportMode,
    exportIncludeChat,
    profiles,
    activeProfileId,
    keysLocked,
    onRequireUnlock,
  ]);

  const handleEncryptedExport = useCallback(
    async (passphrase: string) => {
      const data = await exportEncrypted(
        exportIncludeChat,
        { profiles, activeProfileId },
        passphrase,
      );
      downloadJson(data, exportIncludeChat);
      setShowExportPanel(false);
      toast.success("Exported successfully");
    },
    [exportIncludeChat, profiles, activeProfileId],
  );

  const confirmAndApplyImport = useCallback(
    async (data: ExportData) => {
      const profileCount = data.configs.profiles.length;
      const hasChat = !!data.chatData;
      const chatClause = hasChat ? " and merge chat history" : "";
      // A backup restore replaces the local profile set, so it needs a sharper
      // warning than a shared config, which can only ever add profiles.
      const summary =
        data.mode === "backup"
          ? `Restore this backup? Your ${profiles.length} local profile(s) and their API keys will be REPLACED by ${profileCount} from the file${chatClause}. Threads bound to a replaced profile fall back to the active one. Unsaved profile edits will be discarded.`
          : `Add ${profileCount} profile(s) from this config file${chatClause}? Your existing profiles and API keys are kept. Unsaved profile edits will be discarded.`;
      if (!window.confirm(summary)) return;
      if (activeTurnCount > 0) {
        toast.error("Stop all background responses before importing");
        return;
      }

      const result = await restoreImportedData(data);
      await refreshThreads();
      const parts = [
        result.mode === "backup"
          ? `Restored ${result.profileCount} profile(s)`
          : `Added ${result.addedProfileCount} of ${result.profileCount} profile(s)`,
      ];
      if (result.threadCount > 0) parts.push(`${result.threadCount} thread(s)`);
      if (result.skippedThreadCount > 0) {
        parts.push(`skipped ${result.skippedThreadCount} conflicting thread(s)`);
      }
      if (result.unboundThreadCount > 0) {
        parts.push(
          `${result.unboundThreadCount} thread(s) now use the active profile`,
        );
      }
      toast.success(parts.join(", "));
    },
    [activeTurnCount, profiles.length, restoreImportedData, refreshThreads],
  );

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        // Imported plaintext keys must be encrypted before the Dexie commit.
        if (keysLocked) {
          toast.error("Unlock API keys before importing");
          onRequireUnlock();
          return;
        }
        const data = await readImportFile(file);
        if (isEncryptedExportFile(data)) {
          setPendingImport(data);
          setImportPassOpen(true);
          return;
        }
        await confirmAndApplyImport(data);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Import failed");
      }
    },
    [keysLocked, onRequireUnlock, confirmAndApplyImport],
  );

  const handleImportPassphrase = useCallback(
    async (passphrase: string) => {
      if (!pendingImport) return;
      const data = await decryptExportFile(pendingImport, passphrase);
      await confirmAndApplyImport(data);
    },
    [pendingImport, confirmAndApplyImport],
  );

  const handleReset = useCallback(async () => {
    if (
      !window.confirm(
        "Are you sure you want to reset ALL data? This will delete all profiles, settings, and chat history.",
      )
    )
      return;
    if (!window.confirm("This action CANNOT be undone. Continue?")) return;
    try {
      await abortAllTurns();
      await resetApplicationData();
      window.location.reload();
    } catch {
      toast.error("Reset failed");
    }
  }, [abortAllTurns, resetApplicationData]);

  return {
    showExportPanel,
    setShowExportPanel,
    exportIncludeChat,
    setExportIncludeChat,
    exportMode,
    setExportMode,
    exportPassOpen,
    setExportPassOpen,
    importPassOpen,
    setImportPassOpen,
    pendingImport,
    setPendingImport,
    importInputRef,
    handleExport,
    handleEncryptedExport,
    handleImportFile,
    handleImportPassphrase,
    handleReset,
  };
}
