"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useQueryState } from "nuqs";
import { v4 as uuidv4 } from "uuid";
import {
  type Thread,
  createThread as dbCreateThread,
  listThreads as dbListThreads,
  deleteThread as dbDeleteThread,
  updateThread as dbUpdateThread,
  getMessages,
  getThread as dbGetThread,
} from "@/lib/db";
import { useSettings } from "./SettingsProvider";

interface ThreadContextValue {
  threads: Thread[];
  currentThreadId: string | null;
  isLoading: boolean;
  switchThread: (id: string) => void;
  createNewThread: (configId?: string) => Promise<string>;
  removeThread: (id: string) => Promise<void>;
  refreshThreads: () => Promise<void>;
  updateThreadTitle: (id: string, title: string) => Promise<void>;
}

const ThreadContext = createContext<ThreadContextValue | null>(null);

export function ThreadProvider({ children }: { children: React.ReactNode }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [threadId, setThreadId] = useQueryState("threadId");
  const { activeProfileId, switchProfile, getProfileById } = useSettings();

  const refreshThreads = useCallback(async () => {
    try {
      const list = await dbListThreads();
      setThreads(list);
    } catch (err) {
      console.error("Failed to list threads:", err);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    refreshThreads().finally(() => setIsLoading(false));
  }, [refreshThreads]);

  const switchThread = useCallback(
    (id: string) => {
      setThreadId(id);
      // Auto-switch profile based on thread's configId
      dbGetThread(id).then((thread) => {
        if (!thread) return;
        if (thread.configId && getProfileById(thread.configId)) {
          switchProfile(thread.configId);
        }
        // If thread has no configId or profile deleted, keep current activeProfileId
      });
    },
    [setThreadId, switchProfile, getProfileById],
  );

  const createNewThread = useCallback(
    async (configId?: string) => {
      const id = uuidv4();
      await dbCreateThread(id, "New Chat", configId);
      await refreshThreads();
      setThreadId(id);
      return id;
    },
    [refreshThreads, setThreadId],
  );

  const removeThread = useCallback(
    async (id: string) => {
      await dbDeleteThread(id);
      if (threadId === id) {
        setThreadId(null);
      }
      await refreshThreads();
    },
    [threadId, refreshThreads, setThreadId],
  );

  const updateThreadTitle = useCallback(
    async (id: string, title: string) => {
      await dbUpdateThread(id, { title });
      await refreshThreads();
    },
    [refreshThreads],
  );

  return (
    <ThreadContext.Provider
      value={{
        threads,
        currentThreadId: threadId,
        isLoading,
        switchThread,
        createNewThread,
        removeThread,
        refreshThreads,
        updateThreadTitle,
      }}
    >
      {children}
    </ThreadContext.Provider>
  );
}

export function useThreads() {
  const ctx = useContext(ThreadContext);
  if (!ctx)
    throw new Error("useThreads must be used within ThreadProvider");
  return ctx;
}
