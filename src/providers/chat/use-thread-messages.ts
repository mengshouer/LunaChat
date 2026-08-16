import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message as DBMessage } from "@/lib/db";
import { getMessages, getThread } from "@/lib/db";
import { getActivePath, getSiblings } from "@/lib/message-tree";

export interface BranchInfo {
  index: number;
  count: number;
}

export function useThreadMessages(
  currentThreadId: string | null,
  currentConversationId: string,
  draftThreadId: string,
  invalidate: () => void,
) {
  const [allMessages, setAllMessages] = useState<DBMessage[]>([]);
  const [activeLeafId, setActiveLeafId] = useState<string | undefined>();
  const currentThreadIdRef = useRef(currentThreadId);
  const currentConversationIdRef = useRef(currentConversationId);
  const draftSearchOverridesRef = useRef<Map<string, boolean>>(new Map());
  currentThreadIdRef.current = currentThreadId;
  currentConversationIdRef.current = currentConversationId;

  const messages = useMemo(
    () => getActivePath(allMessages, activeLeafId),
    [activeLeafId, allMessages],
  );

  const branchInfo = useMemo(() => {
    const info: Record<string, BranchInfo> = {};
    for (const message of messages) {
      if (message.role !== "user") continue;
      const siblings = getSiblings(allMessages, message);
      if (siblings.length > 1) {
        info[message.id] = {
          index: siblings.findIndex((sibling) => sibling.id === message.id) + 1,
          count: siblings.length,
        };
      }
    }
    return info;
  }, [allMessages, messages]);

  const reloadThread = useCallback(async (threadId: string) => {
    const [loadedMessages, thread] = await Promise.all([
      getMessages(threadId),
      getThread(threadId),
    ]);
    if (currentThreadIdRef.current !== threadId) return;
    setAllMessages(loadedMessages);
    setActiveLeafId(thread?.activeLeafId);
  }, []);

  const appendMessageLocal = useCallback((message: DBMessage) => {
    if (currentConversationIdRef.current !== message.threadId) return;
    setAllMessages((current) => {
      const idx = current.findIndex((item) => item.id === message.id);
      if (idx >= 0) {
        // Replace existing message (in-place edit)
        const next = [...current];
        next[idx] = message;
        return next;
      }
      return [...current, message];
    });
    setActiveLeafId(message.id);
  }, []);

  useEffect(() => {
    if (!currentThreadId) {
      setAllMessages([]);
      setActiveLeafId(undefined);
      invalidate();
      return;
    }
    void reloadThread(currentThreadId).catch(console.error);
    invalidate();
  }, [currentThreadId, currentConversationId, reloadThread, invalidate]);

  useEffect(() => {
    for (const id of draftSearchOverridesRef.current.keys()) {
      if (id !== draftThreadId) draftSearchOverridesRef.current.delete(id);
    }
  }, [draftThreadId]);

  return {
    allMessages,
    activeLeafId,
    messages,
    branchInfo,
    reloadThread,
    appendMessageLocal,
    setAllMessages,
    setActiveLeafId,
    currentThreadIdRef,
    currentConversationIdRef,
    draftSearchOverridesRef,
  };
}
