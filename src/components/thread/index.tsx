"use client";

import { useState, useMemo, useEffect } from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import { AnimatePresence } from "framer-motion";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChat } from "@/providers/ChatProvider";
import { useThreads } from "@/providers/ThreadProvider";
import { useSettings } from "@/providers/SettingsProvider";
import type { Message as DBMessage } from "@/lib/db";
import { HumanMessage } from "./messages/human";
import {
  AssistantMessage,
  AssistantMessageLoading,
  StreamingMessage,
} from "./messages/ai";
import ThreadHistory from "./history";
import { ThreadHeader } from "./header";
import { ExportPanel } from "./export-panel";
import { Composer } from "./composer";
import { useConfigTransfer } from "./use-config-transfer";
import { SettingsPanel } from "@/components/settings";
import { UnlockDialog } from "@/components/settings/unlock-dialog";
import { PassphraseDialog } from "@/components/settings/passphrase-dialog";

export function Thread() {
  const {
    messages,
    isStreaming,
    streamingContent,
    streamingThinking,
    thinkingStartTime,
    streamingToolCalls,
    regenerate,
    editMessage,
    switchBranch,
    branchInfo,
    forkThreadFromMessage,
  } = useChat();
  const { currentThreadId, createNewThread, threads } = useThreads();
  const { isConfigured } = useSettings();
  const [hideToolCalls, setHideToolCalls] = useState(false);
  // SSR and first client render both default to closed so the header toggle
  // matches the server HTML (no hydration mismatch). The sidebar is then
  // opened on desktop after mount; mobile stays closed so the history sheet
  // doesn't cover the conversation on first load.
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setHistoryOpen(true);
    }
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);

  const transfer = useConfigTransfer({
    onRequireUnlock: () => setUnlockOpen(true),
  });

  const { isAtBottom, scrollToBottom, scrollRef, contentRef } =
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

  const handleRegenerate = async () => {
    if (isStreaming) return;
    await regenerate();
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <AnimatePresence>
        <ThreadHistory
          isOpen={historyOpen}
          onToggle={() => setHistoryOpen((o) => !o)}
        />
      </AnimatePresence>

      <div className="flex flex-col flex-1 min-w-0">
        <ThreadHeader
          historyOpen={historyOpen}
          onOpenHistory={() => setHistoryOpen(true)}
          onNewThread={() => createNewThread()}
          title={currentThreadTitle}
          hideToolCalls={hideToolCalls}
          onToggleHideToolCalls={() => setHideToolCalls((v) => !v)}
          onOpenSettings={() => setSettingsOpen(true)}
          transfer={transfer}
        />

        {transfer.showExportPanel && <ExportPanel transfer={transfer} />}

        {/* Messages area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
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
                    isLastMessage={idx === messages.length - 1 && !isStreaming}
                    handleRegenerate={handleRegenerate}
                    handleFork={() => forkThreadFromMessage(msg.id)}
                    hideToolCalls={hideToolCalls}
                    toolResultByCallId={toolResultByCallId}
                  />
                );
              })}

              {isStreaming &&
                (streamingContent ||
                  streamingThinking ||
                  streamingToolCalls.length > 0) && (
                  <StreamingMessage
                    content={streamingContent}
                    toolCalls={streamingToolCalls}
                    thinkingContent={streamingThinking}
                    thinkingStartTime={thinkingStartTime}
                  />
                )}

              {isStreaming &&
                !streamingContent &&
                streamingToolCalls.length === 0 && <AssistantMessageLoading />}
            </div>
          </div>
        </div>

        <Composer
          isAtBottom={isAtBottom}
          onScrollToBottom={scrollToBottom}
          onOpenSettings={() => setSettingsOpen(true)}
          onRequireUnlock={() => setUnlockOpen(true)}
        />
      </div>

      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
      <UnlockDialog open={unlockOpen} onOpenChange={setUnlockOpen} />
      <PassphraseDialog
        open={transfer.exportPassOpen}
        onOpenChange={transfer.setExportPassOpen}
        title="Encrypt backup"
        description="Set a passphrase for this backup file. It is required to import the file later and cannot be recovered."
        confirmEntry
        submitLabel="Export"
        onSubmit={transfer.handleEncryptedExport}
      />
      <PassphraseDialog
        open={transfer.importPassOpen}
        onOpenChange={(o) => {
          transfer.setImportPassOpen(o);
          if (!o) transfer.setPendingImport(null);
        }}
        title="Encrypted backup"
        description="This file is encrypted. Enter its passphrase to import."
        submitLabel="Import"
        onSubmit={transfer.handleImportPassphrase}
      />
    </div>
  );
}

