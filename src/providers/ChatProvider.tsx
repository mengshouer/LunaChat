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
  updateThread,
  deleteLastAssistantMessages,
  forkThread,
} from "@/lib/db";
import { getActivePath, getSiblings, findLatestLeaf } from "@/lib/message-tree";
import { uploadAttachments } from "@/lib/attachment-storage";
import type {
  Attachment,
  AttachmentEdit,
  PendingAttachment,
} from "@/lib/attachments";
import { runReactLoop } from "@/lib/react-loop";
import { createToolRegistry } from "@/lib/tools/registry";
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

// Inlines extracted text from non-image attachments into the message content.
// Images are handled as multimodal blocks in the provider layer.
function buildLLMContent(
  content: string,
  nonImageAttachments?: Attachment[],
): string {
  if (!nonImageAttachments || nonImageAttachments.length === 0) return content;
  const sections = nonImageAttachments.map((a) => {
    if (a.extractedText) {
      return `<file name="${a.name}" type="${a.mimeType}">\n${a.extractedText}\n</file>`;
    }
    return `<file name="${a.name}" type="${a.mimeType}">[binary file — content not available]</file>`;
  });
  const block = sections.join("\n\n");
  return content ? `${content}\n\n${block}` : block;
}

// Builds LLM conversation history from the active branch path.
// - Images and PDFs go into ChatMessage.attachments for multimodal provider blocks.
// - Text/other files are inlined into content via buildLLMContent.
function buildHistory(path: DBMessage[]): ChatMessage[] {
  return path.map((m) => {
    const multimodalAttachments = (m.attachments ?? []).filter(
      (a) =>
        a.mimeType.startsWith("image/") || a.mimeType === "application/pdf",
    );
    // All non-image attachments get their extractedText inlined into content.
    // This covers PDFs (for OpenAI) and text files.
    const textAttachments = (m.attachments ?? []).filter(
      (a) => !a.mimeType.startsWith("image/"),
    );
    return {
      role: m.role,
      content: buildLLMContent(m.content, textAttachments),
      toolCalls: m.toolCalls as ToolCall[] | undefined,
      toolCallId: m.toolCallId,
      name: m.name,
      ...(multimodalAttachments.length > 0
        ? {
            attachments: multimodalAttachments.map((a) => ({
              url: a.url,
              mimeType: a.mimeType,
              name: a.name,
            })),
          }
        : {}),
    };
  });
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const {
    currentThreadId,
    createNewThread,
    updateThreadTitle,
    switchThread,
    refreshThreads,
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

      const defaultState = () => ({
        content: "",
        toolCalls: [] as ToolCall[],
        thinking: "",
        thinkingStartTime: null as number | null,
      });

      const updateStreamingContent = (updater: (prev: string) => string) => {
        const state = streamingStateMap.current.get(threadId) ?? defaultState();
        state.content = updater(state.content);
        streamingStateMap.current.set(threadId, state);
        if (isCurrentThread()) setStreamingContent(state.content);
      };

      const updateStreamingThinking = (token: string) => {
        const state = streamingStateMap.current.get(threadId) ?? defaultState();
        if (!state.thinkingStartTime) {
          state.thinkingStartTime = Date.now();
          if (isCurrentThread()) setThinkingStartTime(state.thinkingStartTime);
        }
        state.thinking += token;
        streamingStateMap.current.set(threadId, state);
        if (isCurrentThread()) setStreamingThinking(state.thinking);
      };

      const updateStreamingToolCalls = (toolCalls: ToolCall[]) => {
        const state = streamingStateMap.current.get(threadId) ?? defaultState();
        state.toolCalls = toolCalls;
        streamingStateMap.current.set(threadId, state);
        if (isCurrentThread()) setStreamingToolCalls(toolCalls);
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
      streamingStateMap.current.set(threadId, defaultState());
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

      const toolContext = {
        searchEnabled: settings.searchEnabled,
        searchProvider: settings.searchProvider,
        exaApiKey: settings.exaApiKey,
        exaBaseUrl: settings.exaBaseUrl,
        tavilyApiKey: settings.tavilyApiKey,
        tavilyBaseUrl: settings.tavilyBaseUrl,
      };
      const toolRegistry = createToolRegistry(toolContext);

      const systemPrompt = buildSystemPrompt(
        settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        settings.searchEnabled,
      );

      let loopError: Error | null = null;
      let errorAppended = false;

      try {
        const { assistantMessages } = await runReactLoop(
          {
            provider: settings.provider,
            baseUrl: settings.baseUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            requestMode: settings.requestMode ?? "auto",
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
              updateStreamingContent(() => "");
              updateStreamingToolCalls([]);
            },
            onDone: async () => {},
            onError: (err) => {
              if (!abortController.signal.aborted) {
                loopError = err;
                if (isCurrentThread()) {
                  setError(err.message);
                }
                if (!errorAppended) {
                  errorAppended = true;
                  appendErrorMessage(err.message).catch(console.error);
                }
              }
            },
          },
          abortController.signal,
        );

        // Save all assistant messages to DB (always); thinkingDuration is
        // measured per iteration inside runReactLoop.
        for (const aMsg of assistantMessages) {
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
        }
      } catch (err) {
        // A user-initiated abort can surface as Error("Aborted"), a fetch
        // DOMException, or a reader error — signal.aborted is the one
        // authoritative check.
        const e = err instanceof Error ? err : loopError;
        if (e && !abortController.signal.aborted && !errorAppended) {
          await appendErrorMessage(e.message);
          if (isCurrentThread()) {
            setError(e.message);
          }
        }
      } finally {
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
      let priorPath: DBMessage[] = [];
      if (!threadId) {
        threadId = await createNewThread(activeProfileId ?? undefined);
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
      if (pendingAttachments.length > 0) {
        attachments = await uploadAttachments(pendingAttachments);
      }

      // Save user message at the end of the active branch
      const userMsg: DBMessage = {
        id: uuidv4(),
        threadId,
        role: "user",
        content,
        createdAt: Date.now(),
        parentId:
          priorPath.length > 0 ? priorPath[priorPath.length - 1].id : null,
        ...(attachments.length > 0 ? { attachments } : {}),
      };
      await addMessage(userMsg);
      appendMessageLocal(userMsg);
      creatingThreadRef.current = null;

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
      await updateThread(currentThreadId, { activeLeafId: newLeafId });
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
