"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueryState } from "nuqs";
import { v4 as uuidv4 } from "uuid";
import {
  type Thread,
  listThreads,
  setThreadConfigId,
  updateThread,
} from "@/lib/db";
import { useSettings } from "./SettingsProvider";

interface ThreadContextValue {
  threads: Thread[];
  currentThreadId: string | null;
  draftThreadId: string;
  currentConversationId: string;
  isLoading: boolean;
  switchThread: (id: string) => void;
  openNewChat: () => void;
  activateDraftThread: (id: string) => Promise<void>;
  syncAfterDelete: (id: string) => Promise<void>;
  refreshThreads: () => Promise<void>;
  updateThreadTitle: (id: string, title: string) => Promise<void>;
  bindCurrentThreadProfile: (profileId: string) => Promise<void>;
}

const ThreadContext = createContext<ThreadContextValue | null>(null);

export function ThreadProvider({ children }: { children: React.ReactNode }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [threadId, setThreadId] = useQueryState("threadId");
  const [draftThreadId, setDraftThreadId] = useState(() => uuidv4());
  const threadIdRef = useRef(threadId);
  const draftThreadIdRef = useRef(draftThreadId);
  threadIdRef.current = threadId;
  draftThreadIdRef.current = draftThreadId;
  const { switchProfile, getProfileById } = useSettings();

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await listThreads());
    } catch (error) {
      console.error("Failed to list threads:", error);
      throw error;
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    refreshThreads().finally(() => setIsLoading(false));
  }, [refreshThreads]);

  useEffect(() => {
    if (isLoading || !threadId) return;
    if (!threads.some((thread) => thread.id === threadId)) {
      const nextDraftId = uuidv4();
      threadIdRef.current = null;
      draftThreadIdRef.current = nextDraftId;
      setThreadId(null);
      setDraftThreadId(nextDraftId);
    }
  }, [isLoading, setThreadId, threadId, threads]);

  // Selecting a thread is a read: it must not write the global default. The
  // thread carries its own configId, and ChatProvider resolves the turn from
  // that, falling back to activeProfileId only when the thread has none.
  const switchThread = useCallback(
    (id: string) => {
      threadIdRef.current = id;
      setThreadId(id);
    },
    [setThreadId],
  );

  const openNewChat = useCallback(() => {
    const nextDraftId = uuidv4();
    threadIdRef.current = null;
    draftThreadIdRef.current = nextDraftId;
    setThreadId(null);
    setDraftThreadId(nextDraftId);
  }, [setThreadId]);

  const activateDraftThread = useCallback(
    async (id: string) => {
      await refreshThreads();
      if (threadIdRef.current === null && draftThreadIdRef.current === id) {
        threadIdRef.current = id;
        setThreadId(id);
      }
    },
    [refreshThreads, setThreadId],
  );

  const syncAfterDelete = useCallback(
    async (id: string) => {
      if (threadIdRef.current === id) {
        const nextDraftId = uuidv4();
        threadIdRef.current = null;
        draftThreadIdRef.current = nextDraftId;
        setThreadId(null);
        setDraftThreadId(nextDraftId);
      }
      await refreshThreads();
    },
    [refreshThreads, setThreadId],
  );

  const updateThreadTitle = useCallback(
    async (id: string, title: string) => {
      await updateThread(id, { title });
      await refreshThreads();
    },
    [refreshThreads],
  );

  // The header's profile picker always targets the conversation on screen: an
  // open thread gets its own binding rewritten, while a draft has nothing to
  // bind yet, so it sets the default that new chats start from.
  const bindCurrentThreadProfile = useCallback(
    async (profileId: string) => {
      if (!getProfileById(profileId)) throw new Error("Profile does not exist");
      const selectedThreadId = threadIdRef.current;
      if (!selectedThreadId) {
        await switchProfile(profileId);
        return;
      }
      await setThreadConfigId(selectedThreadId, profileId);
      setThreads((current) =>
        current.map((thread) =>
          thread.id === selectedThreadId
            ? { ...thread, configId: profileId }
            : thread,
        ),
      );
    },
    [getProfileById, switchProfile],
  );

  return (
    <ThreadContext.Provider
      value={{
        threads,
        currentThreadId: threadId,
        draftThreadId,
        currentConversationId: threadId ?? draftThreadId,
        isLoading,
        switchThread,
        openNewChat,
        activateDraftThread,
        syncAfterDelete,
        refreshThreads,
        updateThreadTitle,
        bindCurrentThreadProfile,
      }}
    >
      {children}
    </ThreadContext.Provider>
  );
}

export function useThreads() {
  const context = useContext(ThreadContext);
  if (!context) throw new Error("useThreads must be used within ThreadProvider");
  return context;
}
