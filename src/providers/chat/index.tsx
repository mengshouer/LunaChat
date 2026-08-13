"use client";

import React, { createContext, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { useThreads } from "../ThreadProvider";
import { useSettings } from "../SettingsProvider";
import type { Message as DBMessage } from "@/lib/db";
import type { ToolCall } from "@/lib/llm/types";
import type { AttachmentEdit } from "@/lib/attachments";
import { profileToSettings } from "@/lib/settings-types";
import { hasSearchApiKey } from "@/lib/tools/net-search";
import { settingsToToolContext } from "@/lib/tools/registry";
import { resolveSearchEnabled, type TurnStatus } from "@/lib/turn-policy";
import { useThreadMessages, type BranchInfo } from "./use-thread-messages";
import { useAssistantTurn, type SendMessageInput } from "./use-assistant-turn";

export { MAX_CONCURRENT_TURNS } from "@/lib/turn-policy";
export type { TurnStatus } from "@/lib/turn-policy";
export type { SendMessageInput } from "./use-assistant-turn";
export type { BranchInfo } from "./use-thread-messages";

interface ChatContextValue {
  messages: DBMessage[];
  branchInfo: Record<string, BranchInfo>;
  isStreaming: boolean;
  turnStatus: TurnStatus | null;
  activeTurnCount: number;
  streamingContent: string;
  streamingThinking: string;
  thinkingStartTime: number | null;
  streamingToolCalls: ToolCall[];
  error: string | null;
  isConfigured: boolean;
  keysLocked: boolean;
  profileMissing: boolean;
  searchEnabled: boolean;
  searchAvailable: boolean;
  toggleSearchEnabled: () => Promise<void>;
  sendMessage: (input: SendMessageInput) => Promise<void>;
  stopStreaming: () => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  abortAllTurns: () => Promise<void>;
  regenerate: () => Promise<void>;
  editMessage: (
    messageId: string,
    newContent: string,
    attachmentEdit?: AttachmentEdit,
  ) => Promise<void>;
  switchBranch: (
    messageId: string,
    direction: "prev" | "next",
  ) => Promise<void>;
  forkThreadFromMessage: (messageId: string) => Promise<void>;
  clearError: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const {
    currentThreadId,
    currentConversationId,
    draftThreadId,
    activateDraftThread,
    syncAfterDelete,
    switchThread,
    refreshThreads,
    threads,
  } = useThreads();
  const { profiles, activeProfileId, keysLocked } = useSettings();
  const [error, setError] = useState<string | null>(null);
  const [, invalidate] = useReducer((v: number) => v + 1, 0);

  const threadMessages = useThreadMessages(
    currentThreadId,
    currentConversationId,
    draftThreadId,
    invalidate,
  );

  // Clear error when switching threads (mirrors original behavior)
  useEffect(() => {
    setError(null);
  }, [currentThreadId, currentConversationId]);

  const {
    messages,
    branchInfo,
    allMessages,
    reloadThread,
    appendMessageLocal,
    setAllMessages,
    setActiveLeafId,
    currentThreadIdRef,
    currentConversationIdRef,
    draftSearchOverridesRef,
  } = threadMessages;

  // --- Derived config state ---
  const currentThread = useMemo(
    () => threads.find((thread) => thread.id === currentThreadId),
    [currentThreadId, threads],
  );
  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId),
    [activeProfileId, profiles],
  );
  const currentProfile = useMemo(() => {
    if (currentThread?.configId) {
      return profiles.find((profile) => profile.id === currentThread.configId);
    }
    return activeProfile;
  }, [activeProfile, currentThread?.configId, profiles]);
  const profileMissing = Boolean(currentThread?.configId && !currentProfile);
  const currentSettings = useMemo(
    () => (currentProfile ? profileToSettings(currentProfile) : null),
    [currentProfile],
  );
  const searchEnabled = resolveSearchEnabled({
    thread: currentThread,
    draftOverride: draftSearchOverridesRef.current.get(draftThreadId),
    profileDefault: currentSettings?.searchEnabledByDefault,
  });
  const searchAvailable = Boolean(
    currentSettings &&
      !keysLocked &&
      hasSearchApiKey(settingsToToolContext(currentSettings, searchEnabled)),
  );
  const isConfigured = Boolean(
    currentSettings?.baseUrl && currentSettings?.model && !profileMissing,
  );

  // --- Assistant turn hook ---
  const turn = useAssistantTurn({
    currentThreadId,
    currentConversationId,
    draftThreadId,
    profiles,
    activeProfileId,
    keysLocked,
    searchEnabled,
    currentProfile,
    activateDraftThread,
    syncAfterDelete,
    switchThread,
    refreshThreads,
    allMessages,
    messages,
    reloadThread,
    appendMessageLocal,
    setAllMessages,
    setActiveLeafId,
    currentThreadIdRef,
    currentConversationIdRef,
    draftSearchOverridesRef,
    setError,
  });

  const visibleSession = turn.sessionsRef.current.get(currentConversationId);
  const isStreaming = Boolean(visibleSession);

  return (
    <ChatContext.Provider
      value={{
        messages,
        branchInfo,
        isStreaming,
        turnStatus: visibleSession?.status ?? null,
        activeTurnCount: turn.sessionsRef.current.size,
        streamingContent: visibleSession?.content ?? "",
        streamingThinking: visibleSession?.thinking ?? "",
        thinkingStartTime: visibleSession?.thinkingStartTime ?? null,
        streamingToolCalls: visibleSession?.toolCalls ?? [],
        error,
        isConfigured,
        keysLocked,
        profileMissing,
        searchEnabled,
        searchAvailable,
        toggleSearchEnabled: turn.toggleSearchEnabled,
        sendMessage: turn.sendMessage,
        stopStreaming: turn.stopStreaming,
        deleteThread: turn.deleteThread,
        abortAllTurns: turn.abortAllTurns,
        regenerate: turn.regenerate,
        editMessage: turn.editMessage,
        switchBranch: turn.switchBranch,
        forkThreadFromMessage: turn.forkThreadFromMessage,
        clearError: turn.clearError,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used within ChatProvider");
  return context;
}
