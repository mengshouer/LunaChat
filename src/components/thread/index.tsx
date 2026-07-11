"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDown,
  PanelRightOpen,
  Settings,
  Send,
  Square,
  Plus,
  Paperclip,
  X,
  FileText,
  Globe,
  Download,
  Upload,
  RotateCcw,
  MoreHorizontal,
  Wrench,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useChat } from "@/providers/ChatProvider";
import { useThreads } from "@/providers/ThreadProvider";
import { useSettings } from "@/providers/SettingsProvider";
import { useTheme } from "@/providers/ThemeProvider";
import type { Message as DBMessage } from "@/lib/db";
import {
  extractClipboardFiles,
  toPendingAttachments,
  type PendingAttachment,
} from "@/lib/attachments";
import { HumanMessage } from "./messages/human";
import {
  AssistantMessage,
  AssistantMessageLoading,
  StreamingMessage,
} from "./messages/ai";
import ThreadHistory from "./history";
import { SettingsPanel } from "@/components/settings";
import { UnlockDialog } from "@/components/settings/unlock-dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { hasSearchApiKey } from "@/lib/tools/net-search";
import type { ToolContext } from "@/lib/tools/registry";
import { toast } from "sonner";
import {
  exportPlainWithoutKeys,
  exportEncrypted,
  downloadJson,
  readImportFile,
  decryptExportFile,
  isEncryptedExportFile,
  applyImport,
  resetAllData,
  type ExportData,
  type EncryptedExportFile,
} from "@/lib/config-io";
import { PassphraseDialog } from "@/components/settings/passphrase-dialog";

function ScrollToBottom({ onClick }: { onClick: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4"
    >
      <Button
        variant="outline"
        size="icon"
        className="rounded-full shadow-md"
        onClick={onClick}
      >
        <ArrowDown className="size-4" />
      </Button>
    </motion.div>
  );
}

export function Thread() {
  const {
    messages,
    isStreaming,
    streamingContent,
    streamingThinking,
    thinkingStartTime,
    streamingToolCalls,
    sendMessage,
    stopStreaming,
    regenerate,
    editMessage,
    switchBranch,
    branchInfo,
    forkThreadFromMessage,
  } = useChat();
  const { currentThreadId, createNewThread, refreshThreads, threads } = useThreads();
  const { settings, isConfigured, keysLocked, encryptForStorage, updateSettings, profiles, activeProfileId, switchProfile, reloadConfigs } = useSettings();
  const { resolvedTheme, toggleTheme } = useTheme();
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [hideToolCalls, setHideToolCalls] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportIncludeChat, setExportIncludeChat] = useState(false);
  const [exportMode, setExportMode] = useState<"encrypted" | "plain">("encrypted");
  const [exportPassOpen, setExportPassOpen] = useState(false);
  const [importPassOpen, setImportPassOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<EncryptedExportFile | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
    useStickToBottom();

  const toolResultByCallId = useMemo(() => {
    return messages.reduce<Record<string, DBMessage>>((acc, m) => {
      if (m.role === "tool" && m.toolCallId) {
        acc[m.toolCallId] = m;
      }
      return acc;
    }, {});
  }, [messages]);

  const currentThreadTitle = useMemo(
    () => threads.find((t) => t.id === currentThreadId)?.title ?? "",
    [threads, currentThreadId],
  );

  const addFiles = useCallback((files: FileList | File[]) => {
    setPendingAttachments((prev) => [...prev, ...toPendingAttachments(files)]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = extractClipboardFiles(e.clipboardData);
      if (files.length === 0) return;
      e.preventDefault();
      addFiles(files);
    },
    [addFiles],
  );

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = input.trim();
      if (!trimmed && pendingAttachments.length === 0) return;
      if (isStreaming) return;

      if (!isConfigured) {
        toast.error("Please set Base URL and Model first");
        setSettingsOpen(true);
        return;
      }

      if (keysLocked) {
        setUnlockOpen(true);
        return;
      }

      const attachmentsToSend = pendingAttachments;
      setInput("");
      setPendingAttachments([]);
      await sendMessage({ content: trimmed, attachments: attachmentsToSend });
    },
    [input, pendingAttachments, isStreaming, isConfigured, keysLocked, sendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleRegenerate = useCallback(async () => {
    if (isStreaming) return;
    await regenerate();
  }, [isStreaming, regenerate]);

  const handleExport = useCallback(async () => {
    if (exportMode === "plain") {
      try {
        const data = await exportPlainWithoutKeys(exportIncludeChat, { profiles, activeProfileId });
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
      setUnlockOpen(true);
      return;
    }
    setExportPassOpen(true);
  }, [exportMode, exportIncludeChat, profiles, activeProfileId, keysLocked]);

  const handleEncryptedExport = useCallback(
    async (passphrase: string) => {
      const data = await exportEncrypted(exportIncludeChat, { profiles, activeProfileId }, passphrase);
      downloadJson(data, exportIncludeChat);
      setShowExportPanel(false);
      toast.success("Exported successfully");
    },
    [exportIncludeChat, profiles, activeProfileId],
  );

  const confirmAndApplyImport = useCallback(async (data: ExportData) => {
    const profileCount = data.configs.profiles.length;
    const hasChat = !!data.chatData;
    const summary = `Import ${profileCount} profile(s)${hasChat ? " with chat history" : ""}?`;
    if (!window.confirm(summary)) return;

    const result = await applyImport(data, encryptForStorage);
    reloadConfigs();
    await refreshThreads();
    toast.success(`Imported ${result.profileCount} new profile(s)${result.threadCount > 0 ? `, ${result.threadCount} thread(s)` : ""}`);
  }, [encryptForStorage, reloadConfigs, refreshThreads]);

  const handleImportFile = useCallback(async (file: File) => {
    try {
      // Imported keys must be encrypted before hitting localStorage
      if (keysLocked) {
        toast.error("Unlock API keys before importing");
        setUnlockOpen(true);
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
  }, [keysLocked, confirmAndApplyImport]);

  const handleReset = useCallback(async () => {
    if (!window.confirm("Are you sure you want to reset ALL data? This will delete all profiles, settings, and chat history.")) return;
    if (!window.confirm("This action CANNOT be undone. Continue?")) return;
    try {
      await resetAllData();
      window.location.reload();
    } catch {
      toast.error("Reset failed");
    }
  }, [reloadConfigs, refreshThreads]);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <AnimatePresence>
        <ThreadHistory
          isOpen={historyOpen}
          onToggle={() => setHistoryOpen((o) => !o)}
        />
      </AnimatePresence>

      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
          <div className="flex items-center gap-2">
            {!historyOpen && (
              <Button variant="ghost" onClick={() => setHistoryOpen(true)}>
                <PanelRightOpen className="size-5" />
              </Button>
            )}
            <Button variant="ghost" onClick={() => createNewThread()}>
              <Plus className="size-5" />
            </Button>
          </div>

          {currentThreadTitle && (
            <h2 className="hidden lg:block flex-1 min-w-0 truncate text-sm font-medium text-muted-foreground px-2">
              {currentThreadTitle}
            </h2>
          )}

          <div className="flex items-center gap-1">
            {/* Profile switcher */}
            <select
              className="border-input bg-background text-xs rounded-md border px-2 py-1 max-w-[140px] truncate mr-1"
              value={activeProfileId ?? ""}
              onChange={(e) => switchProfile(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" title="More actions">
                  <MoreHorizontal className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  View
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={(e) => e.preventDefault()}
                  onClick={toggleTheme}
                  className="justify-between"
                >
                  <span className="flex items-center gap-2">
                    {resolvedTheme === "dark" ? (
                      <Moon className="size-3.5" />
                    ) : (
                      <Sun className="size-3.5" />
                    )}
                    Dark mode
                  </span>
                  <Switch
                    checked={resolvedTheme === "dark"}
                    onCheckedChange={toggleTheme}
                    className="pointer-events-none"
                  />
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => e.preventDefault()}
                  onClick={() => setHideToolCalls((v) => !v)}
                  className="justify-between"
                >
                  <span className="flex items-center gap-2">
                    <Wrench className="size-3.5" />
                    Hide tools
                  </span>
                  <Switch
                    checked={hideToolCalls}
                    onCheckedChange={setHideToolCalls}
                    className="pointer-events-none"
                  />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Data
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setShowExportPanel((v) => !v)}>
                  <Download className="size-3.5 mr-2" />
                  Export
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => importInputRef.current?.click()}>
                  <Upload className="size-3.5 mr-2" />
                  Import
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={handleReset}>
                  <RotateCcw className="size-3.5 mr-2" />
                  Reset All Data
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="size-5" />
            </Button>
          </div>
        </div>

        {/* Export panel */}
        {showExportPanel && (
          <div className="border-b px-4 py-3 flex items-center gap-4 bg-muted/50 shrink-0">
            <div className="flex items-center gap-2">
              <Switch
                id="export-chat"
                checked={exportIncludeChat}
                onCheckedChange={setExportIncludeChat}
              />
              <Label htmlFor="export-chat" className="text-xs">
                Include chat history
              </Label>
            </div>
            <select
              className="border-input bg-background text-xs rounded-md border px-2 py-1"
              value={exportMode}
              onChange={(e) => setExportMode(e.target.value as "encrypted" | "plain")}
            >
              <option value="encrypted">Encrypted backup (with API keys)</option>
              <option value="plain">Plain JSON (without API keys)</option>
            </select>
            <div className="flex items-center gap-2 ml-auto">
              <Button size="sm" variant="ghost" onClick={() => setShowExportPanel(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleExport}>
                Export
              </Button>
            </div>
          </div>
        )}

        {/* Messages area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
        >
          <div ref={contentRef} className="w-full px-4 py-6">
            {!currentThreadId && messages.length === 0 && !isStreaming && (
              <div className="flex items-center justify-center h-full min-h-[50vh]">
                <div className="text-center text-muted-foreground">
                  <h2 className="text-2xl font-semibold mb-2">Chat</h2>
                  <p className="text-sm">
                    {isConfigured
                      ? "Start a conversation"
                      : "Set Base URL and Model to get started"}
                  </p>
                  {!isConfigured && (
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => setSettingsOpen(true)}
                    >
                      <Settings className="size-4 mr-2" /> Open Settings
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-4">
              {messages.map((msg, idx) => {
                if (msg.role === "user") {
                  return (
                    <HumanMessage
                      key={msg.id}
                      message={msg}
                      isStreaming={isStreaming}
                      onEditSubmit={(newContent, attachmentEdit) =>
                        editMessage(msg.id, newContent, attachmentEdit)
                      }
                      branchIndex={branchInfo[msg.id]?.index}
                      branchCount={branchInfo[msg.id]?.count}
                      onSwitchBranch={(direction) =>
                        switchBranch(msg.id, direction)
                      }
                    />
                  );
                }

                if (
                  msg.role === "tool" &&
                  msg.toolCallId &&
                  toolResultByCallId[msg.toolCallId]
                ) {
                  return null;
                }

                return (
                  <AssistantMessage
                    key={msg.id}
                    message={msg}
                    isLoading={isStreaming}
                    isLastMessage={
                      idx === messages.length - 1 && !isStreaming
                    }
                    handleRegenerate={handleRegenerate}
                    handleFork={() => forkThreadFromMessage(msg.id)}
                    hideToolCalls={hideToolCalls}
                    toolResultByCallId={toolResultByCallId}
                  />
                );
              })}

              {isStreaming && (streamingContent || streamingThinking || streamingToolCalls.length > 0) && (
                <StreamingMessage
                  content={streamingContent}
                  toolCalls={streamingToolCalls}
                  thinkingContent={streamingThinking}
                  thinkingStartTime={thinkingStartTime}
                />
              )}

              {isStreaming && !streamingContent && streamingToolCalls.length === 0 && (
                <AssistantMessageLoading />
              )}
            </div>

          </div>
        </div>

        {/* Input area */}
        <div className="relative border-t shrink-0">
          <AnimatePresence>
            {!isAtBottom && (
              <ScrollToBottom onClick={scrollToBottom} />
            )}
          </AnimatePresence>

          <form
            onSubmit={handleSubmit}
            className="w-full px-4 py-4 flex flex-col gap-2"
          >
            {/* Pending attachment previews */}
            {pendingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pendingAttachments.map((pa, i) => (
                  <div key={i} className="relative group">
                    {pa.file.type.startsWith("image/") ? (
                      <img
                        src={pa.previewUrl}
                        alt={pa.file.name}
                        className="h-16 w-16 object-cover rounded-lg border"
                      />
                    ) : (
                      <div className="flex items-center gap-1.5 h-16 px-3 rounded-lg border bg-muted text-sm max-w-[160px]">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{pa.file.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="size-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={!isConfigured || isStreaming}
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 size-11"
              >
                <Paperclip className="size-4" />
              </Button>
              {hasSearchApiKey({
                searchEnabled: settings.searchEnabled,
                searchProvider: settings.searchProvider,
                exaApiKey: settings.exaApiKey,
                exaBaseUrl: settings.exaBaseUrl,
                tavilyApiKey: settings.tavilyApiKey,
                tavilyBaseUrl: settings.tavilyBaseUrl,
              } as ToolContext) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={!isConfigured}
                      onClick={() => updateSettings({ searchEnabled: !settings.searchEnabled })}
                      className="shrink-0 size-11"
                    >
                      <Globe
                        className={cn(
                          "size-4 transition-colors",
                          settings.searchEnabled
                            ? "text-blue-500"
                            : "text-muted-foreground",
                        )}
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {settings.searchEnabled ? "Web search on" : "Web search off"}
                  </TooltipContent>
                </Tooltip>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={
                  !isConfigured
                    ? "Set Base URL and Model first..."
                    : keysLocked
                      ? "API keys locked — press send to unlock..."
                      : "Send a message... (Shift+Enter for newline)"
                }
                disabled={!isConfigured}
                rows={1}
                className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-[11px] text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px] max-h-[200px] overflow-y-auto"
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />
              {isStreaming ? (
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  onClick={stopStreaming}
                  className="shrink-0 size-11"
                >
                  <Square className="size-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  disabled={(!input.trim() && pendingAttachments.length === 0) || !isConfigured}
                  className="shrink-0 size-11"
                >
                  <Send className="size-4" />
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>

      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
      <UnlockDialog open={unlockOpen} onOpenChange={setUnlockOpen} />
      <PassphraseDialog
        open={exportPassOpen}
        onOpenChange={setExportPassOpen}
        title="Encrypt backup"
        description="Set a passphrase for this backup file. It is required to import the file later and cannot be recovered."
        confirmEntry
        submitLabel="Export"
        onSubmit={handleEncryptedExport}
      />
      <PassphraseDialog
        open={importPassOpen}
        onOpenChange={(o) => {
          setImportPassOpen(o);
          if (!o) setPendingImport(null);
        }}
        title="Encrypted backup"
        description="This file is encrypted. Enter its passphrase to import."
        submitLabel="Import"
        onSubmit={async (pass) => {
          if (!pendingImport) return;
          const data = await decryptExportFile(pendingImport, pass);
          await confirmAndApplyImport(data);
        }}
      />
    </div>
  );
}
