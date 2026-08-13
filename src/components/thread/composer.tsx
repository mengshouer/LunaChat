"use client";

import { useCallback, useRef, useState } from "react";
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
import { useChat } from "@/providers/ChatProvider";
import { useSettings } from "@/providers/SettingsProvider";
import {
  extractClipboardFiles,
  toPendingAttachments,
  type PendingAttachment,
} from "@/lib/attachments";
import { hasSearchApiKey } from "@/lib/tools/net-search";
import { settingsToToolContext } from "@/lib/tools/registry";
import { toast } from "sonner";

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
  isAtBottom,
  onScrollToBottom,
  onOpenSettings,
  onRequireUnlock,
}: {
  isAtBottom: boolean;
  onScrollToBottom: () => void;
  onOpenSettings: () => void;
  onRequireUnlock: () => void;
}) {
  const { isStreaming, sendMessage, stopStreaming } = useChat();
  const { settings, isConfigured, keysLocked, updateSettings } = useSettings();
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        onOpenSettings();
        return;
      }

      if (keysLocked) {
        onRequireUnlock();
        return;
      }

      const attachmentsToSend = pendingAttachments;
      setInput("");
      setPendingAttachments([]);
      try {
        await sendMessage({ content: trimmed, attachments: attachmentsToSend });
      } catch (err) {
        // Send failed after we cleared the composer. Restore what the user had
        // typed unless they've already started a new message, and surface the
        // error instead of dropping it as an unhandled rejection.
        setInput((cur) => (cur ? cur : input));
        setPendingAttachments((cur) => (cur.length ? cur : attachmentsToSend));
        toast.error(
          err instanceof Error ? err.message : "Failed to send message",
        );
      }
    },
    [
      input,
      pendingAttachments,
      isStreaming,
      isConfigured,
      keysLocked,
      sendMessage,
      onOpenSettings,
      onRequireUnlock,
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
          {hasSearchApiKey(settingsToToolContext(settings)) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={!isConfigured}
                  onClick={() =>
                    updateSettings({ searchEnabled: !settings.searchEnabled })
                  }
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
              disabled={
                (!input.trim() && pendingAttachments.length === 0) ||
                !isConfigured
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
