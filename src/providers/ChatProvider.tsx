"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { useThreads } from "./ThreadProvider";
import { useSettings } from "./SettingsProvider";
import type { ChatMessage, ToolCall } from "@/lib/llm/types";
import {
  type Message as DBMessage,
  addMessage,
  getMessages,
  getThread,
  deleteLastAssistantMessages,
  forkThread,
  setActiveLeaf,
} from "@/lib/db";
import { getActivePath, getSiblings, findLatestLeaf } from "@/lib/message-tree";
import { buildHistory } from "@/lib/chat-history";
import { uploadAttachments } from "@/lib/attachment-storage";
import type {
  Attachment,
  AttachmentEdit,
  PendingAttachment,
} from "@/lib/attachments";
import { runReactLoop } from "@/lib/react-loop";
import { createToolRegistry, settingsToToolContext } from "@/lib/tools/registry";
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "@/lib/prompts";

export type SendMessageInput =
  string | { content: string; attachments?: PendingAttachment[] };

export interface BranchInfo {
  index: number;
  count: number;
}

interface ChatContextValue {
  messages: DBMessage[];
  branchInfo: Record<string, BranchInfo>;
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: string;
  thinkingStartTime: number | null;
  streamingToolCalls: ToolCall[];
  error: string | null;
  sendMessage: (input: SendMessageInput) => Promise<void>;
  stopStreaming: () => void;
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
    createNewThread,
    updateThreadTitle,
    switchThread,
    refreshThreads,
    removeThread,
    threads,
    isLoading: threadsLoading,
  } = useThreads();
  const { settings, activeProfileId } = useSettings();
  const [allMessages, setAllMessages] = useState<DBMessage[]>([]);
  const [activeLeafId, setActiveLeafId] = useState<string | undefined>(
    undefined,
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(
    null,
  );
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  // One AbortController per streaming thread so background turns on other
  // threads can be aborted independently (never clobbered by a newer turn).
  const abortMap = useRef<Map<string, AbortController>>(new Map());

  // Thread being created by an in-flight sendMessage. The thread-change
  // effect must not reload it concurrently: that read can land between
  // addMessage's two DB writes and race the local append into a
  // duplicated first message (ghost 1/2 branch switcher).
  const creatingThreadRef = useRef<string | null>(null);

  const currentThreadIdRef = useRef(currentThreadId);
  useEffect(() => {
    currentThreadIdRef.current = currentThreadId;
  }, [currentThreadId]);

  // Per-thread streaming state cache
  const streamingStateMap = useRef<
    Map<
      string,
      {
        content: string;
        toolCalls: ToolCall[];
        thinking: string;
        thinkingStartTime: number | null;
        thinkingEndTime: number | null;
      }
    >
  >(new Map());

  // Active branch path shown in the UI and sent as LLM history
  const messages = useMemo(
    () => getActivePath(allMessages, activeLeafId),
    [allMessages, activeLeafId],
  );

  // Branch position for user messages on the active path that have siblings
  const branchInfo = useMemo(() => {
    const info: Record<string, BranchInfo> = {};
    for (const m of messages) {
      if (m.role !== "user") continue;
      const siblings = getSiblings(allMessages, m);
      if (siblings.length > 1) {
        info[m.id] = {
          index: siblings.findIndex((s) => s.id === m.id) + 1,
          count: siblings.length,
        };
      }
    }
    return info;
  }, [messages, allMessages]);

  const reloadThread = useCallback(async (threadId: string) => {
    const [msgs, thread] = await Promise.all([
      getMessages(threadId),
      getThread(threadId),
    ]);
    setAllMessages(msgs);
    setActiveLeafId(thread?.activeLeafId);
  }, []);

  // Append a freshly persisted message to local state unless a concurrent
  // reload already delivered it (reloads race the manual appends).
  const appendMessageLocal = useCallback((msg: DBMessage) => {
    setAllMessages((prev) =>
      prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
    );
    setActiveLeafId(msg.id);
  }, []);

  // Load messages and restore streaming state when thread changes
  useEffect(() => {
    setError(null);
    if (!currentThreadId) {
      setAllMessages([]);
      setActiveLeafId(undefined);
      setIsStreaming(false);
      setStreamingContent("");
      setStreamingThinking("");
      setThinkingStartTime(null);
      setStreamingToolCalls([]);
      return;
    }
    // Restore streaming state from cache if this thread is still streaming
    const cached = streamingStateMap.current.get(currentThreadId);
    if (cached) {
      setIsStreaming(true);
      setStreamingContent(cached.content);
      setStreamingThinking(cached.thinking);
      setThinkingStartTime(cached.thinkingStartTime);
      setStreamingToolCalls(cached.toolCalls);
    } else {
      setIsStreaming(false);
      setStreamingContent("");
      setStreamingThinking("");
      setThinkingStartTime(null);
      setStreamingToolCalls([]);
    }
    // Skip the initial reload of a thread sendMessage is creating right
    // now — sendMessage maintains local state itself for that thread.
    if (creatingThreadRef.current === currentThreadId) return;
    reloadThread(currentThreadId).catch(console.error);
  }, [currentThreadId, reloadThread]);

  const clearError = useCallback(() => setError(null), []);

  // Authoritative per-thread streaming check (the isStreaming state only
  // mirrors the currently visible thread).
  const isThreadStreaming = useCallback(
    (threadId: string | null | undefined) =>
      !!threadId && streamingStateMap.current.has(threadId),
    [],
  );

  // Abort and clean up streams whose thread was deleted, so a background
  // turn stops writing orphan messages into a removed thread.
  useEffect(() => {
    if (threadsLoading) return;
    const alive = new Set(threads.map((t) => t.id));
    for (const id of abortMap.current.keys()) {
      if (alive.has(id) || creatingThreadRef.current === id) continue;
      abortMap.current.get(id)?.abort();
      abortMap.current.delete(id);
      streamingStateMap.current.delete(id);
    }
  }, [threads, threadsLoading]);

  // Stop only the currently visible thread's stream; background streams on
  // other threads keep running and stay stoppable when switched back to.
  const stopStreaming = useCallback(() => {
    const threadId = currentThreadIdRef.current;
    if (threadId) {
      abortMap.current.get(threadId)?.abort();
      abortMap.current.delete(threadId);
      streamingStateMap.current.delete(threadId);
    }
    setIsStreaming(false);
    setStreamingContent("");
    setStreamingThinking("");
    setThinkingStartTime(null);
    setStreamingToolCalls([]);
  }, []);

  // Runs one ReAct turn: streams the LLM response, executes tools, persists
  // tool/assistant/error messages chained via parentId starting after
  // startParentId. Shared by sendMessage / regenerate / editMessage.
  const runAssistantTurn = useCallback(
    async (
      threadId: string,
      chatMessages: ChatMessage[],
      startParentId: string,
    ) => {
      // Thread guard helpers
      const isCurrentThread = () => currentThreadIdRef.current === threadId;

      // parentId chain through this turn; closure-local so background
      // streaming on a non-visible thread stays correct.
      let lastMsgId = startParentId;

      const persistMessage = async (msg: DBMessage) => {
        await addMessage(msg);
        lastMsgId = msg.id;
        if (isCurrentThread()) {
          appendMessageLocal(msg);
        }
      };

      // One state object for the whole turn. The map only holds a reference
      // for cross-thread restore; stopStreaming may delete the map entry, but
      // this closure keeps the object alive (the abort partial-persist reads
      // it). Updaters mutate turnState and never re-set the map — otherwise a
      // late token after stopStreaming would resurrect a deleted entry and
      // make isThreadStreaming wrongly report the thread as busy.
      const turnState = {
        content: "",
        toolCalls: [] as ToolCall[],
        thinking: "",
        thinkingStartTime: null as number | null,
        thinkingEndTime: null as number | null,
      };
      const isTurnLive = () =>
        streamingStateMap.current.get(threadId) === turnState;

      // rAF batching: stream callbacks mutate turnState synchronously and
      // request at most one React state flush per frame. rafId is a turn-local
      // closure var (not a shared ref) so concurrent background turns never
      // cancel each other's flushes.
      let rafId: number | null = null;
      const flushStreamingUI = () => {
        rafId = null;
        if (!isCurrentThread() || !isTurnLive()) return;
        setStreamingContent(turnState.content);
        setStreamingThinking(turnState.thinking);
        setThinkingStartTime(turnState.thinkingStartTime);
        setStreamingToolCalls(turnState.toolCalls);
      };
      const scheduleFlush = () => {
        if (!isCurrentThread() || !isTurnLive() || rafId !== null) return;
        rafId = requestAnimationFrame(flushStreamingUI);
      };
      const forceFlush = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        flushStreamingUI();
      };

      const updateStreamingContent = (updater: (prev: string) => string) => {
        // The first content token closes the thinking window.
        if (turnState.thinkingStartTime && !turnState.thinkingEndTime) {
          turnState.thinkingEndTime = Date.now();
        }
        turnState.content = updater(turnState.content);
        scheduleFlush();
      };

      const updateStreamingThinking = (token: string) => {
        if (!turnState.thinkingStartTime) {
          turnState.thinkingStartTime = Date.now();
        }
        turnState.thinking += token;
        scheduleFlush();
      };

      const updateStreamingToolCalls = (toolCalls: ToolCall[]) => {
        turnState.toolCalls = toolCalls;
        scheduleFlush();
      };

      // Reset at each iteration boundary: an abort then only captures the
      // current iteration's partial, and the just-persisted assistant message
      // isn't double-shown by a stale streaming snapshot. forceFlush is
      // synchronous so the cleared state paints in the same tick as the
      // persisted message append.
      const resetTurnState = () => {
        turnState.content = "";
        turnState.thinking = "";
        turnState.thinkingStartTime = null;
        turnState.thinkingEndTime = null;
        turnState.toolCalls = [];
        forceFlush();
      };

      const appendErrorMessage = async (message: string) => {
        const text = (message ?? "").toString();
        const trimmed = text.trim();
        const errorText = trimmed || "Unknown error";
        const errorMsg: DBMessage = {
          id: uuidv4(),
          threadId,
          role: "assistant",
          name: "error",
          content: errorText,
          createdAt: Date.now(),
          parentId: lastMsgId,
        };
        await persistMessage(errorMsg);
      };

      // Start streaming
      streamingStateMap.current.set(threadId, turnState);
      if (isCurrentThread()) {
        setIsStreaming(true);
        setStreamingContent("");
        setStreamingThinking("");
        setThinkingStartTime(null);
        setStreamingToolCalls([]);
      }
      setError(null);

      const abortController = new AbortController();
      abortMap.current.set(threadId, abortController);

      const toolContext = settingsToToolContext(settings);
      const toolRegistry = createToolRegistry(toolContext);

      const systemPrompt = buildSystemPrompt(
        settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        settings.searchEnabled,
      );

      try {
        await runReactLoop(
          {
            provider: settings.provider,
            baseUrl: settings.baseUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            requestMode: settings.requestMode ?? "auto",
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
          },
          chatMessages,
          toolRegistry,
          toolContext,
          systemPrompt,
          {
            onToken: (token) => {
              updateStreamingContent((prev) => prev + token);
            },
            onThinkingToken: (token) => {
              updateStreamingThinking(token);
            },
            onToolCallStart: (tcs) => {
              updateStreamingToolCalls(tcs);
            },
            onAssistantMessage: async (aMsg) => {
              // Nothing streamed at all (no text, no tool calls, no thinking):
              // don't persist an empty bubble; just clear the partial snapshot.
              if (
                !aMsg.content &&
                !aMsg.toolCalls?.length &&
                !aMsg.reasoningContent
              ) {
                resetTurnState();
                return;
              }
              const dbMsg: DBMessage = {
                id: uuidv4(),
                threadId,
                role: "assistant",
                content: aMsg.content,
                toolCalls: aMsg.toolCalls,
                createdAt: Date.now(),
                parentId: lastMsgId,
                ...(aMsg.reasoningContent
                  ? {
                      reasoningContent: aMsg.reasoningContent,
                      thinkingDuration: aMsg.thinkingDuration,
                    }
                  : {}),
              };
              await persistMessage(dbMsg);
              // Iteration boundary: clear partial so the next iteration (or an
              // abort) starts clean and this persisted message isn't shadowed
              // by a stale streaming snapshot.
              resetTurnState();
            },
            onToolResult: async (toolCallId, name, result) => {
              const toolResultMsg: DBMessage = {
                id: uuidv4(),
                threadId,
                role: "tool",
                content: result,
                toolCallId,
                name,
                createdAt: Date.now(),
                parentId: lastMsgId,
              };
              await persistMessage(toolResultMsg);
            },
            onDone: () => {},
          },
          abortController.signal,
        );
      } catch (err) {
        // A user-initiated abort can surface as Error("Aborted"), a fetch
        // DOMException, or a reader error — signal.aborted is the one
        // authoritative check.
        if (abortController.signal.aborted) {
          // Stop: keep the current iteration's streamed partial as a normal
          // assistant message. Never persist turnState.toolCalls — with early
          // tool-call indication those may be half-built (args:{}) and would
          // have no matching tool result, making replay invalid.
          if (turnState.content || turnState.thinking) {
            const partialMsg: DBMessage = {
              id: uuidv4(),
              threadId,
              role: "assistant",
              content: turnState.content,
              createdAt: Date.now(),
              parentId: lastMsgId,
              ...(turnState.thinking
                ? {
                    reasoningContent: turnState.thinking,
                    thinkingDuration: turnState.thinkingStartTime
                      ? (turnState.thinkingEndTime ?? Date.now()) -
                        turnState.thinkingStartTime
                      : undefined,
                  }
                : {}),
            };
            await persistMessage(partialMsg).catch(console.error);
          }
        } else {
          // Single error path: the providers throw, so any non-abort error
          // arrives here.
          const e = err instanceof Error ? err : new Error(String(err));
          await appendErrorMessage(e.message);
          if (isCurrentThread()) {
            setError(e.message);
          }
        }
      } finally {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        streamingStateMap.current.delete(threadId);
        if (abortMap.current.get(threadId) === abortController) {
          abortMap.current.delete(threadId);
        }

        if (isCurrentThread()) {
          setIsStreaming(false);
          setStreamingContent("");
          setStreamingThinking("");
          setThinkingStartTime(null);
          setStreamingToolCalls([]);
          // Reload from DB to get clean state
          await reloadThread(threadId);
        }
      }
    },
    [settings, reloadThread, appendMessageLocal],
  );

  const sendMessage = useCallback(
    async (input: SendMessageInput) => {
      if (isThreadStreaming(currentThreadId)) return;

      const content = typeof input === "string" ? input : (input.content ?? "");
      const pendingAttachments =
        typeof input === "string" ? [] : (input.attachments ?? []);

      let threadId = currentThreadId;
      let createdThreadId: string | null = null;
      let priorPath: DBMessage[] = [];
      if (!threadId) {
        threadId = await createNewThread(activeProfileId ?? undefined);
        createdThreadId = threadId;
        creatingThreadRef.current = threadId;
      } else {
        const [existing, thread] = await Promise.all([
          getMessages(threadId),
          getThread(threadId),
        ]);
        priorPath = getActivePath(existing, thread?.activeLeafId);
      }

      // Upload attachments (base64 data URLs for now)
      let attachments: Attachment[] = [];
      // Save user message at the end of the active branch
      const userMsg: DBMessage = {
        id: uuidv4(),
        threadId,
        role: "user",
        content,
        createdAt: Date.now(),
        parentId:
          priorPath.length > 0 ? priorPath[priorPath.length - 1].id : null,
      };
      try {
        if (pendingAttachments.length > 0) {
          attachments = await uploadAttachments(pendingAttachments);
          if (attachments.length > 0) userMsg.attachments = attachments;
        }
        await addMessage(userMsg);
        appendMessageLocal(userMsg);
      } catch (err) {
        // Never leave a freshly-created thread empty in the list/DB when its
        // first message failed to persist. removeThread also clears the URL
        // threadId (via ThreadProvider), whose thread-change effect resets the
        // local message state. Rethrow so the composer restores the input.
        if (createdThreadId) {
          await removeThread(createdThreadId).catch(console.error);
        }
        throw err;
      } finally {
        // Always release the guard, even if upload/persist throws, so the
        // thread-change effect isn't permanently blocked from reloading it.
        creatingThreadRef.current = null;
      }

      // Auto-generate title from first message
      if (priorPath.length === 0) {
        const title =
          content.length > 50
            ? content.slice(0, 50) + "..."
            : content || attachments[0]?.name || "New Chat";
        await updateThreadTitle(threadId, title);
      }

      const chatMessages = buildHistory([...priorPath, userMsg]);
      await runAssistantTurn(threadId, chatMessages, userMsg.id);
    },
    [
      isThreadStreaming,
      currentThreadId,
      createNewThread,
      removeThread,
      updateThreadTitle,
      activeProfileId,
      runAssistantTurn,
      appendMessageLocal,
    ],
  );

  // Edit a previous user message: create a sibling branch and generate a new
  // reply on it. Without attachmentEdit the original attachments carry over;
  // with it, the new message gets kept originals + newly uploaded files.
  const editMessage = useCallback(
    async (
      messageId: string,
      newContent: string,
      attachmentEdit?: AttachmentEdit,
    ) => {
      if (isThreadStreaming(currentThreadId) || !currentThreadId) return;
      const threadId = currentThreadId;
      const original = allMessages.find((m) => m.id === messageId);
      if (!original || original.role !== "user") return;

      let attachments = original.attachments ?? [];
      if (attachmentEdit) {
        const uploaded =
          attachmentEdit.added.length > 0
            ? await uploadAttachments(attachmentEdit.added)
            : [];
        attachments = [...attachmentEdit.kept, ...uploaded];
      }

      const newMsg: DBMessage = {
        id: uuidv4(),
        threadId,
        role: "user",
        content: newContent,
        createdAt: Date.now(),
        parentId: original.parentId ?? null,
        ...(attachments.length > 0 ? { attachments } : {}),
      };
      await addMessage(newMsg);
      appendMessageLocal(newMsg);

      const fresh = await getMessages(threadId);
      const path = getActivePath(fresh, newMsg.id);
      await runAssistantTurn(threadId, buildHistory(path), newMsg.id);
    },
    [isThreadStreaming, currentThreadId, allMessages, runAssistantTurn, appendMessageLocal],
  );

  // Switch to the previous/next sibling branch at the given message,
  // landing on that branch's most recent leaf.
  const switchBranch = useCallback(
    async (messageId: string, direction: "prev" | "next") => {
      if (isThreadStreaming(currentThreadId) || !currentThreadId) return;
      const msg = allMessages.find((m) => m.id === messageId);
      if (!msg) return;
      const siblings = getSiblings(allMessages, msg);
      const idx = siblings.findIndex((s) => s.id === messageId);
      const targetIdx = direction === "prev" ? idx - 1 : idx + 1;
      if (idx === -1 || targetIdx < 0 || targetIdx >= siblings.length) return;
      const newLeafId = findLatestLeaf(allMessages, siblings[targetIdx].id);
      // setActiveLeaf keeps updatedAt untouched so the thread list order
      // doesn't jump when merely viewing another branch.
      await setActiveLeaf(currentThreadId, newLeafId);
      setActiveLeafId(newLeafId);
    },
    [isThreadStreaming, currentThreadId, allMessages],
  );

  // Copy the active path up to and including the given assistant message
  // into a brand-new thread, then switch to it.
  const forkThreadFromMessage = useCallback(
    async (messageId: string) => {
      if (isThreadStreaming(currentThreadId) || !currentThreadId) return;
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      const pathSlice = messages.slice(0, idx + 1);
      const sourceThread = await getThread(currentThreadId);

      const newThreadId = uuidv4();
      const idMap = new Map<string, string>();
      for (const m of pathSlice) idMap.set(m.id, uuidv4());
      const clonedMessages: DBMessage[] = pathSlice.map((m) => ({
        ...m,
        id: idMap.get(m.id)!,
        threadId: newThreadId,
        parentId: m.parentId ? (idMap.get(m.parentId) ?? null) : null,
      }));

      const now = Date.now();
      await forkThread(
        {
          id: newThreadId,
          title: sourceThread ? `${sourceThread.title} (branch)` : "New Chat",
          createdAt: now,
          updatedAt: now,
          activeLeafId: idMap.get(messageId)!,
          ...(sourceThread?.configId
            ? { configId: sourceThread.configId }
            : {}),
        },
        clonedMessages,
      );
      await refreshThreads();
      switchThread(newThreadId);
    },
    [isThreadStreaming, currentThreadId, messages, refreshThreads, switchThread],
  );

  const regenerate = useCallback(async () => {
    if (isThreadStreaming(currentThreadId) || !currentThreadId) return;

    const threadId = currentThreadId;

    // Delete trailing assistant + tool messages of the active branch
    await deleteLastAssistantMessages(threadId);
    const [remaining, thread] = await Promise.all([
      getMessages(threadId),
      getThread(threadId),
    ]);
    setAllMessages(remaining);
    setActiveLeafId(thread?.activeLeafId);

    const path = getActivePath(remaining, thread?.activeLeafId);
    const lastMsg = path[path.length - 1];
    if (!lastMsg || lastMsg.role !== "user") return;

    await runAssistantTurn(threadId, buildHistory(path), lastMsg.id);
  }, [isThreadStreaming, currentThreadId, runAssistantTurn]);

  return (
    <ChatContext.Provider
      value={{
        messages,
        branchInfo,
        isStreaming,
        streamingContent,
        streamingThinking,
        thinkingStartTime,
        streamingToolCalls,
        error,
        sendMessage,
        stopStreaming,
        regenerate,
        editMessage,
        switchBranch,
        forkThreadFromMessage,
        clearError,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
