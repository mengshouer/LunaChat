"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Square,
  Paperclip,
  X,
  FileText,
  Globe,
  ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useChat, MAX_CONCURRENT_TURNS } from "@/providers/ChatProvider";
import {
  extractClipboardFiles,
  toPendingAttachments,
  type PendingAttachment,
} from "@/lib/attachments";
import {
  getDraftRestoreKey,
  mergeRestoredInput,
} from "@/lib/composer-draft";
import { toast } from "sonner";

interface ComposerDraft {
  input: string;
  attachments: PendingAttachment[];
}

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

export function Composer({
  conversationKey,
  validConversationIds,
  isAtBottom,
  onScrollToBottom,
  onOpenSettings,
  onRequireUnlock,
}: {
  conversationKey: string;
  validConversationIds: string[];
  isAtBottom: boolean;
  onScrollToBottom: () => void;
  onOpenSettings: () => void;
  onRequireUnlock: () => void;
}) {
  const {
    isStreaming,
    turnStatus,
    activeTurnCount,
    sendMessage,
    stopStreaming,
    isConfigured,
    keysLocked,
    profileMissing,
    searchEnabled,
    searchAvailable,
    toggleSearchEnabled,
  } = useChat();
  const [drafts, setDrafts] = useState<Map<string, ComposerDraft>>(
    () => new Map(),
  );
  const draftsRef = useRef(drafts);
  const submittingRef = useRef<Set<string>>(new Set());
  const conversationKeyRef = useRef(conversationKey);
  const validConversationIdsRef = useRef(validConversationIds);
  draftsRef.current = drafts;
  conversationKeyRef.current = conversationKey;
  validConversationIdsRef.current = validConversationIds;
  const draft = drafts.get(conversationKey) ?? { input: "", attachments: [] };
  const input = draft.input;
  const pendingAttachments = draft.attachments;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateDraft = useCallback(
    (key: string, updater: (current: ComposerDraft) => ComposerDraft) => {
      setDrafts((current) => {
        const next = new Map(current);
        const existing = next.get(key) ?? {
          input: "",
          attachments: [],
        };
        const updated = updater(existing);
        if (!updated.input && updated.attachments.length === 0) {
          next.delete(key);
        } else {
          next.set(key, updated);
        }
        return next;
      });
    },
    [],
  );

  const updateCurrentDraft = useCallback(
    (updater: (current: ComposerDraft) => ComposerDraft) => {
      updateDraft(conversationKey, updater);
    },
    [conversationKey, updateDraft],
  );

  useEffect(() => {
    const valid = new Set(validConversationIds);
    setDrafts((current) => {
      let changed = false;
      const next = new Map(current);
      for (const [id, value] of next) {
        if (valid.has(id)) continue;
        value.attachments.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        next.delete(id);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [validConversationIds]);

  useEffect(
    () => () => {
      for (const value of draftsRef.current.values()) {
        value.attachments.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      }
    },
    [],
  );

  const addFiles = useCallback((files: FileList | File[]) => {
    const added = toPendingAttachments(files);
    updateCurrentDraft((current) => ({
      ...current,
      attachments: [...current.attachments, ...added],
    }));
  }, [updateCurrentDraft]);

  const removeAttachment = useCallback((index: number) => {
    updateCurrentDraft((current) => {
      URL.revokeObjectURL(current.attachments[index].previewUrl);
      return {
        ...current,
        attachments: current.attachments.filter((_, i) => i !== index),
      };
    });
  }, [updateCurrentDraft]);

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
      if (
        submittingRef.current.has(conversationKey) ||
        isStreaming ||
        activeTurnCount >= MAX_CONCURRENT_TURNS
      ) {
        return;
      }

      if (profileMissing) {
        toast.error("This thread's profile is missing. Select one in the header.");
        return;
      }

      if (!isConfigured) {
        toast.error("Please set Base URL and Model first");
        onOpenSettings();
        return;
      }

      if (keysLocked) {
        onRequireUnlock();
        return;
      }

      const attachmentsToSend = pendingAttachments;
      submittingRef.current.add(conversationKey);
      updateDraft(conversationKey, () => ({ input: "", attachments: [] }));
      try {
        await sendMessage({ content: trimmed, attachments: attachmentsToSend });
        attachmentsToSend.forEach((item) =>
          URL.revokeObjectURL(item.previewUrl),
        );
      } catch (err) {
        // Restore to the original conversation while it is reachable. A
        // failed provisional thread is moved into the visible composer, and
        // any text entered while the send was pending is preserved.
        const restoreKey = getDraftRestoreKey(
          conversationKey,
          conversationKeyRef.current,
          validConversationIdsRef.current,
        );
        updateDraft(restoreKey, (current) => ({
          input: mergeRestoredInput(input, current.input),
          attachments: [...attachmentsToSend, ...current.attachments],
        }));
        toast.error(
          err instanceof Error ? err.message : "Failed to send message",
        );
      } finally {
        submittingRef.current.delete(conversationKey);
      }
    },
    [
      input,
      pendingAttachments,
      isStreaming,
      activeTurnCount,
      isConfigured,
      keysLocked,
      profileMissing,
      sendMessage,
      onOpenSettings,
      onRequireUnlock,
      updateDraft,
      conversationKey,
    ],
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

  return (
    <div className="relative border-t shrink-0">
      <AnimatePresence>
        {!isAtBottom && <ScrollToBottom onClick={onScrollToBottom} />}
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
                  // Object URLs are local previews and cannot use next/image.
                  // eslint-disable-next-line @next/next/no-img-element
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
                  className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-opacity"
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={!isConfigured || isStreaming}
                aria-label="Toggle web search"
                aria-pressed={searchEnabled}
                onClick={() =>
                  void toggleSearchEnabled().catch((error) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Failed to update web search",
                    ),
                  )
                }
                className="shrink-0 size-11"
              >
                <Globe
                  className={cn(
                    "size-4 transition-colors",
                    searchEnabled
                      ? searchAvailable
                        ? "text-blue-500"
                        : "text-amber-500"
                      : "text-muted-foreground",
                  )}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {keysLocked
                ? "Unlock API keys to use web search"
                : !searchAvailable
                  ? "Add a search API key in Profile settings to use web search"
                  : searchEnabled
                    ? "Web search on"
                    : "Web search off"}
            </TooltipContent>
          </Tooltip>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) =>
              updateCurrentDraft((current) => ({
                ...current,
                input: e.target.value,
              }))
            }
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              profileMissing
                ? "Select a profile for this thread..."
                : !isConfigured
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
              onClick={() => void stopStreaming()}
              disabled={turnStatus === "stopping" || turnStatus === "deleting"}
              className="shrink-0 size-11"
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={
                (!input.trim() && pendingAttachments.length === 0) ||
                !isConfigured ||
                activeTurnCount >= MAX_CONCURRENT_TURNS
              }
              className="shrink-0 size-11"
            >
              <Send className="size-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
