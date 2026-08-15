import { useCallback, useReducer, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ChatMessage, ToolCall, ReasoningEffort } from "@/lib/llm/types";
import type { ConfigProfile } from "@/lib/settings-types";
import { textBlocks } from "@/lib/content-blocks";
import {
  type Message as DBMessage,
  type Thread,
  addMessage,
  createThreadWithFirstMessage,
  deleteLastAssistantMessages,
  deleteThread as deleteThreadFromDb,
  forkThread,
  getMessages,
  getThread,
  setActiveLeaf,
  setThreadSearchEnabled,
  updateThread,
} from "@/lib/db";
import { findLatestLeaf, getActivePath, getSiblings } from "@/lib/message-tree";
import { buildHistory } from "@/lib/chat-history";
import { uploadAttachments } from "@/lib/attachment-storage";
import type { Attachment, AttachmentEdit, PendingAttachment } from "@/lib/attachments";
import { runReactLoop } from "@/lib/react-loop";
import {
  createToolRegistry,
  isSearchToolEnabled,
  settingsToToolContext,
} from "@/lib/tools/registry";
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "@/lib/prompts";
import { profileToSettings, type Settings } from "@/lib/settings-types";
import {
  checkTurnAdmission,
  resolveSearchEnabled,
  resolveTurnFailure,
  type TurnStatus,
} from "@/lib/turn-policy";

export type SendMessageInput =
  | string
  | { content: string; attachments?: PendingAttachment[]; reasoningEffort?: ReasoningEffort };

interface TurnSession {
  turnId: string;
  threadId: string;
  status: TurnStatus;
  controller: AbortController;
  completion: Promise<void>;
  resolveCompletion: () => void;
  completed: boolean;
  content: string;
  toolCalls: ToolCall[];
  thinking: string;
  thinkingStartTime: number | null;
  thinkingEndTime: number | null;
  settings: Settings;
  searchEnabled: boolean;
  reasoningEffort?: ReasoningEffort;
}

export interface TurnDeps {
  currentThreadId: string | null;
  currentConversationId: string;
  draftThreadId: string;
  draftProfileId: string | null;
  profiles: ConfigProfile[];
  activeProfileId: string | null;
  keysLocked: boolean;
  searchEnabled: boolean;
  currentProfile: ConfigProfile | undefined;
  // ThreadProvider callbacks
  activateDraftThread: (id: string) => Promise<void>;
  syncAfterDelete: (id: string) => Promise<void>;
  switchThread: (id: string) => void;
  refreshThreads: () => Promise<void>;
  // useThreadMessages outputs
  allMessages: DBMessage[];
  messages: DBMessage[];
  reloadThread: (threadId: string) => Promise<void>;
  appendMessageLocal: (message: DBMessage) => void;
  setAllMessages: (messages: DBMessage[]) => void;
  setActiveLeafId: (id: string | undefined) => void;
  currentThreadIdRef: React.MutableRefObject<string | null>;
  currentConversationIdRef: React.MutableRefObject<string>;
  draftSearchOverridesRef: React.MutableRefObject<Map<string, boolean>>;
  // Error state
  setError: (error: string | null) => void;
}

export interface TurnState {
  sessionsRef: React.MutableRefObject<Map<string, TurnSession>>;
  invalidateSessions: () => void;
}

export function useAssistantTurn(deps: TurnDeps) {
  const {
    currentThreadId,
    currentConversationId,
    draftThreadId,
    draftProfileId,
    profiles,
    activeProfileId,
    keysLocked,
    searchEnabled,
    currentProfile: currentProfileFromDeps,
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
  } = deps;

  const [, invalidateSessions] = useReducer((value: number) => value + 1, 0);
  const sessionsRef = useRef<Map<string, TurnSession>>(new Map());

  const isOwner = useCallback(
    (session: TurnSession) =>
      sessionsRef.current.get(session.threadId) === session,
    [],
  );

  const reserveSession = useCallback(
    (
      threadId: string,
      settings: Settings,
      turnSearchEnabled: boolean,
    ): TurnSession => {
      const rejection = checkTurnAdmission(sessionsRef.current, threadId);
      if (rejection) throw new Error(rejection);
      let resolveCompletion = () => {};
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });
      const session: TurnSession = {
        turnId: uuidv4(),
        threadId,
        status: "preparing",
        controller: new AbortController(),
        completion,
        resolveCompletion,
        completed: false,
        content: "",
        toolCalls: [],
        thinking: "",
        thinkingStartTime: null,
        thinkingEndTime: null,
        settings: { ...settings },
        searchEnabled: turnSearchEnabled,
      };
      sessionsRef.current.set(threadId, session);
      invalidateSessions();
      return session;
    },
    [],
  );

  const finishSession = useCallback((session: TurnSession) => {
    if (session.completed) return;
    session.completed = true;
    if (sessionsRef.current.get(session.threadId) === session) {
      sessionsRef.current.delete(session.threadId);
    }
    session.resolveCompletion();
    invalidateSessions();
  }, []);

  const resolveTurnConfig = useCallback(
    (thread: Thread | undefined) => {
      let profileId: string | null;
      if (thread?.configId) {
        profileId = thread.configId;
      } else if (thread) {
        // Existing thread without configId (legacy) — use global default
        profileId = activeProfileId;
      } else {
        // Draft — prefer local draft override
        profileId = draftProfileId ?? activeProfileId;
      }
      const profile = profiles.find((item) => item.id === profileId);
      if (!profile) {
        throw new Error(
          thread?.configId
            ? "This thread's profile is missing. Select a profile first."
            : "Select or create a profile first",
        );
      }
      if (keysLocked) throw new Error("Unlock API keys first");
      const settings = profileToSettings(profile);
      if (!settings.baseUrl || !settings.model) {
        throw new Error("Set Base URL and Model first");
      }
      const turnSearchEnabled = resolveSearchEnabled({
        thread,
        draftOverride: draftSearchOverridesRef.current.get(draftThreadId),
        profileDefault: settings.searchEnabledByDefault,
      });
      return { profile, settings, searchEnabled: turnSearchEnabled };
    },
    [activeProfileId, draftProfileId, draftThreadId, keysLocked, profiles, draftSearchOverridesRef],
  );

  const runAssistantTurn = useCallback(
    async (
      session: TurnSession,
      chatMessages: ChatMessage[],
      startParentId: string,
    ) => {
      if (!isOwner(session) || session.controller.signal.aborted) {
        finishSession(session);
        return;
      }
      session.status = "running";
      invalidateSessions();
      let lastMessageId = startParentId;
      let rafId: number | null = null;

      const isVisible = () =>
        currentConversationIdRef.current === session.threadId;
      const scheduleUpdate = () => {
        if (!isVisible() || !isOwner(session) || rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (isVisible() && isOwner(session)) invalidateSessions();
        });
      };
      const forceUpdate = () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
        if (isVisible()) invalidateSessions();
      };
      const resetStreamState = () => {
        session.content = "";
        session.toolCalls = [];
        session.thinking = "";
        session.thinkingStartTime = null;
        session.thinkingEndTime = null;
        forceUpdate();
      };
      const persistMessage = async (message: DBMessage) => {
        if (!isOwner(session) || session.status === "deleting") {
          throw new Error("Turn is no longer writable");
        }
        await addMessage(message);
        lastMessageId = message.id;
        appendMessageLocal(message);
      };
      const appendErrorMessage = async (message: string) => {
        await persistMessage({
          id: uuidv4(),
          threadId: session.threadId,
          role: "assistant",
          name: "error",
          content: textBlocks(message.trim() || "Unknown error"),
          createdAt: Date.now(),
          parentId: lastMessageId,
        });
      };

      try {
        const toolContext = settingsToToolContext(
          session.settings,
          session.searchEnabled,
          session.controller.signal,
        );
        const toolRegistry = createToolRegistry(toolContext);
        // Search is available either via local net_search tool or via built-in web_search
        const builtinSearchEnabled =
          (session.settings.provider === "openai-responses" &&
            !!(session.settings.responseBuiltinTools?.web_search ||
              session.settings.responseBuiltinTools?.web_search_preview)) ||
          (session.settings.provider === "anthropic" &&
            !!session.settings.anthropicBuiltinTools?.web_search);
        const effectiveSearchEnabled =
          isSearchToolEnabled(toolContext) || builtinSearchEnabled;
        const systemPrompt = buildSystemPrompt(
          session.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
          effectiveSearchEnabled,
        );
        await runReactLoop(
          {
            provider: session.settings.provider,
            baseUrl: session.settings.baseUrl,
            apiKey: session.settings.apiKey,
            model: session.settings.model,
            requestMode: session.settings.requestMode,
            temperature: session.settings.temperature,
            maxTokens: session.settings.maxTokens,
            responseBuiltinTools: session.settings.responseBuiltinTools,
            responseStore: session.settings.responseStore,
            anthropicBuiltinTools: session.settings.anthropicBuiltinTools,
            reasoningEffort: session.reasoningEffort,
          },
          chatMessages,
          toolRegistry,
          toolContext,
          systemPrompt,
          {
            onToken: (token) => {
              if (session.thinkingStartTime && !session.thinkingEndTime) {
                session.thinkingEndTime = Date.now();
              }
              session.content += token;
              scheduleUpdate();
            },
            onThinkingToken: (token) => {
              if (!session.thinkingStartTime)
                session.thinkingStartTime = Date.now();
              session.thinking += token;
              scheduleUpdate();
            },
            onToolCallStart: (toolCalls) => {
              session.toolCalls = toolCalls;
              scheduleUpdate();
            },
            onAssistantMessage: async (assistantMessage) => {
              if (session.controller.signal.aborted)
                throw new Error("Aborted");
              if (
                !assistantMessage.content.trim() &&
                !assistantMessage.toolCalls?.length &&
                !assistantMessage.reasoningContent
              ) {
                resetStreamState();
                return;
              }
              await persistMessage({
                id: uuidv4(),
                threadId: session.threadId,
                role: "assistant",
                content: textBlocks(assistantMessage.content),
                toolCalls: assistantMessage.toolCalls,
                createdAt: Date.now(),
                parentId: lastMessageId,
                ...(assistantMessage.reasoningContent
                  ? {
                      reasoningContent: assistantMessage.reasoningContent,
                      thinkingDuration: assistantMessage.thinkingDuration,
                    }
                  : {}),
              });
              resetStreamState();
            },
            onToolResult: async (toolCallId, name, result) => {
              if (session.controller.signal.aborted)
                throw new Error("Aborted");
              await persistMessage({
                id: uuidv4(),
                threadId: session.threadId,
                role: "tool",
                content: textBlocks(result),
                toolCallId,
                name,
                createdAt: Date.now(),
                parentId: lastMessageId,
              });
            },
            onDone: () => {},
          },
          session.controller.signal,
        );
      } catch (caught) {
        const action = resolveTurnFailure({
          aborted: session.controller.signal.aborted,
          status: sessionsRef.current.get(session.threadId)?.status,
          hasPartialContent: Boolean(session.content || session.thinking),
          isOwner: isOwner(session),
        });
        if (action === "persist-partial") {
          await persistMessage({
            id: uuidv4(),
            threadId: session.threadId,
            role: "assistant",
            content: textBlocks(session.content),
            createdAt: Date.now(),
            parentId: lastMessageId,
            ...(session.thinking
              ? {
                  reasoningContent: session.thinking,
                  thinkingDuration: session.thinkingStartTime
                    ? (session.thinkingEndTime ?? Date.now()) -
                      session.thinkingStartTime
                    : undefined,
                }
              : {}),
          }).catch(console.error);
        } else if (action === "append-error") {
          const exception =
            caught instanceof Error ? caught : new Error(String(caught));
          await appendErrorMessage(exception.message).catch(console.error);
          if (isVisible()) setError(exception.message);
        }
      } finally {
        if (rafId !== null) cancelAnimationFrame(rafId);
        finishSession(session);
        if (currentThreadIdRef.current === session.threadId) {
          await reloadThread(session.threadId).catch(console.error);
        }
      }
    },
    [
      appendMessageLocal,
      currentConversationIdRef,
      currentThreadIdRef,
      finishSession,
      isOwner,
      reloadThread,
      setError,
    ],
  );

  // --- User-facing actions ---

  const sendMessage = useCallback(
    async (input: SendMessageInput) => {
      const content = typeof input === "string" ? input : (input.content ?? "");
      const pendingAttachments =
        typeof input === "string" ? [] : (input.attachments ?? []);
      const inputReasoningEffort =
        typeof input === "string" ? undefined : input.reasoningEffort;
      const selectedThreadId = currentThreadId;
      const conversationId = currentConversationId;
      const thread = selectedThreadId
        ? await getThread(selectedThreadId)
        : undefined;
      if (selectedThreadId && !thread)
        throw new Error("Thread no longer exists");
      const turnConfig = resolveTurnConfig(thread);
      const session = reserveSession(
        conversationId,
        turnConfig.settings,
        turnConfig.searchEnabled,
      );
      session.reasoningEffort = inputReasoningEffort;

      let userMessageCommitted = false;
      try {
        let attachments: Attachment[] = [];
        if (pendingAttachments.length > 0) {
          attachments = await uploadAttachments(pendingAttachments);
        }
        if (
          session.controller.signal.aborted ||
          session.status !== "preparing"
        ) {
          throw new Error("Aborted");
        }

        let priorPath: DBMessage[] = [];
        if (thread) {
          const existingMessages = await getMessages(thread.id);
          priorPath = getActivePath(existingMessages, thread.activeLeafId);
        }
        if (
          session.controller.signal.aborted ||
          session.status !== "preparing"
        ) {
          throw new Error("Aborted");
        }
        const userMessage: DBMessage = {
          id: uuidv4(),
          threadId: conversationId,
          role: "user",
          content: textBlocks(content),
          createdAt: Date.now(),
          parentId:
            priorPath.length > 0
              ? priorPath[priorPath.length - 1].id
              : null,
          ...(attachments.length > 0 ? { attachments } : {}),
        };
        const chatHistory = buildHistory([...priorPath, userMessage]);

        if (thread) {
          await addMessage(userMessage, turnConfig.profile.id);
        } else {
          const title =
            content.length > 50
              ? `${content.slice(0, 50)}...`
              : content || attachments[0]?.name || "New Chat";
          const now = Date.now();
          await createThreadWithFirstMessage(
            {
              id: conversationId,
              title,
              configId: turnConfig.profile.id,
              searchEnabled: turnConfig.searchEnabled,
              createdAt: now,
              updatedAt: now,
            },
            userMessage,
          );
          draftSearchOverridesRef.current.delete(conversationId);
        }
        userMessageCommitted = true;
        appendMessageLocal(userMessage);

        if (!thread) {
          await activateDraftThread(conversationId).catch((caught) => {
            console.error("Failed to activate the new thread:", caught);
          });
        }

        if (thread && priorPath.length === 0) {
          const title =
            content.length > 50
              ? `${content.slice(0, 50)}...`
              : content || attachments[0]?.name || "New Chat";
          await updateThread(thread.id, { title })
            .then(refreshThreads)
            .catch((caught) => {
              console.error("Failed to update the thread title:", caught);
            });
        }
        await runAssistantTurn(session, chatHistory, userMessage.id);
      } catch (caught) {
        if (isOwner(session)) finishSession(session);
        if (userMessageCommitted) {
          const message =
            caught instanceof Error ? caught.message : String(caught);
          console.error(
            "Assistant turn failed after saving the user message:",
            caught,
          );
          if (currentConversationIdRef.current === conversationId) {
            setError(message);
          }
          return;
        }
        throw caught;
      }
    },
    [
      activateDraftThread,
      appendMessageLocal,
      currentConversationId,
      currentConversationIdRef,
      currentThreadId,
      draftSearchOverridesRef,
      finishSession,
      isOwner,
      refreshThreads,
      reserveSession,
      resolveTurnConfig,
      runAssistantTurn,
      setError,
    ],
  );

  const stopStreaming = useCallback(async () => {
    const session = sessionsRef.current.get(currentConversationIdRef.current);
    if (!session) return;
    if (session.status === "preparing" || session.status === "running") {
      session.status = "stopping";
      session.controller.abort();
      invalidateSessions();
    }
    await session.completion;
  }, [currentConversationIdRef]);

  const deleteThread = useCallback(
    async (threadId: string) => {
      const session = sessionsRef.current.get(threadId);
      if (session) {
        session.status = "deleting";
        session.controller.abort();
        invalidateSessions();
        await session.completion;
      }
      await deleteThreadFromDb(threadId);
      await syncAfterDelete(threadId);
    },
    [syncAfterDelete],
  );

  const abortAllTurns = useCallback(async () => {
    const sessions = Array.from(sessionsRef.current.values());
    for (const session of sessions) {
      session.status = "deleting";
      session.controller.abort();
    }
    invalidateSessions();
    await Promise.all(sessions.map((session) => session.completion));
  }, []);

  const editMessage = useCallback(
    async (
      messageId: string,
      newContent: string,
      attachmentEdit?: AttachmentEdit,
    ) => {
      if (!currentThreadId) throw new Error("Select a thread first");
      const thread = await getThread(currentThreadId);
      if (!thread) throw new Error("Thread no longer exists");
      const turnConfig = resolveTurnConfig(thread);
      const session = reserveSession(
        thread.id,
        turnConfig.settings,
        turnConfig.searchEnabled,
      );
      let editedMessageCommitted = false;
      try {
        const original = allMessages.find(
          (message) => message.id === messageId,
        );
        if (!original || original.role !== "user") {
          throw new Error("Message no longer exists");
        }
        let attachments = original.attachments ?? [];
        if (attachmentEdit) {
          const uploaded =
            attachmentEdit.added.length > 0
              ? await uploadAttachments(attachmentEdit.added)
              : [];
          attachments = [...attachmentEdit.kept, ...uploaded];
        }
        if (
          session.controller.signal.aborted ||
          session.status !== "preparing"
        ) {
          throw new Error("Aborted");
        }
        const newMessage: DBMessage = {
          id: uuidv4(),
          threadId: thread.id,
          role: "user",
          content: textBlocks(newContent),
          createdAt: Date.now(),
          parentId: original.parentId ?? null,
          ...(attachments.length > 0 ? { attachments } : {}),
        };
        const chatHistory = buildHistory(
          getActivePath([...allMessages, newMessage], newMessage.id),
        );
        await addMessage(newMessage);
        editedMessageCommitted = true;
        appendMessageLocal(newMessage);
        await runAssistantTurn(session, chatHistory, newMessage.id);
      } catch (caught) {
        if (isOwner(session)) finishSession(session);
        if (editedMessageCommitted) {
          const message =
            caught instanceof Error ? caught.message : String(caught);
          console.error(
            "Assistant turn failed after saving the edit:",
            caught,
          );
          if (currentConversationIdRef.current === thread.id)
            setError(message);
          return;
        }
        throw caught;
      }
    },
    [
      allMessages,
      appendMessageLocal,
      currentConversationIdRef,
      currentThreadId,
      finishSession,
      isOwner,
      reserveSession,
      resolveTurnConfig,
      runAssistantTurn,
      setError,
    ],
  );

  const regenerate = useCallback(async () => {
    if (!currentThreadId) throw new Error("Select a thread first");
    const thread = await getThread(currentThreadId);
    if (!thread) throw new Error("Thread no longer exists");
    const turnConfig = resolveTurnConfig(thread);
    const session = reserveSession(
      thread.id,
      turnConfig.settings,
      turnConfig.searchEnabled,
    );
    try {
      await deleteLastAssistantMessages(thread.id);
      const [remaining, updatedThread] = await Promise.all([
        getMessages(thread.id),
        getThread(thread.id),
      ]);
      if (currentThreadIdRef.current === thread.id) {
        setAllMessages(remaining);
        setActiveLeafId(updatedThread?.activeLeafId);
      }
      const path = getActivePath(remaining, updatedThread?.activeLeafId);
      const lastMessage = path[path.length - 1];
      if (!lastMessage || lastMessage.role !== "user") {
        throw new Error("No user message to regenerate");
      }
      await runAssistantTurn(session, buildHistory(path), lastMessage.id);
    } catch (caught) {
      if (isOwner(session)) finishSession(session);
      throw caught;
    }
  }, [
    currentThreadId,
    currentThreadIdRef,
    finishSession,
    isOwner,
    reserveSession,
    resolveTurnConfig,
    runAssistantTurn,
    setActiveLeafId,
    setAllMessages,
  ]);

  const switchBranch = useCallback(
    async (messageId: string, direction: "prev" | "next") => {
      if (!currentThreadId || sessionsRef.current.has(currentThreadId)) return;
      const message = allMessages.find((item) => item.id === messageId);
      if (!message) return;
      const siblings = getSiblings(allMessages, message);
      const index = siblings.findIndex((sibling) => sibling.id === messageId);
      const targetIndex = direction === "prev" ? index - 1 : index + 1;
      if (index === -1 || targetIndex < 0 || targetIndex >= siblings.length)
        return;
      const leafId = findLatestLeaf(allMessages, siblings[targetIndex].id);
      await setActiveLeaf(currentThreadId, leafId);
      setActiveLeafId(leafId);
    },
    [allMessages, currentThreadId, setActiveLeafId],
  );

  const forkThreadFromMessage = useCallback(
    async (messageId: string) => {
      if (!currentThreadId || sessionsRef.current.has(currentThreadId)) return;
      const index = messages.findIndex((message) => message.id === messageId);
      if (index === -1) return;
      const sourceThread = await getThread(currentThreadId);
      const path = messages.slice(0, index + 1);
      const newThreadId = uuidv4();
      const idMap = new Map(path.map((message) => [message.id, uuidv4()]));
      const clonedMessages = path.map((message) => ({
        ...message,
        id: idMap.get(message.id)!,
        threadId: newThreadId,
        parentId: message.parentId
          ? (idMap.get(message.parentId) ?? null)
          : null,
      }));
      const now = Date.now();
      await forkThread(
        {
          id: newThreadId,
          title: sourceThread
            ? `${sourceThread.title} (branch)`
            : "New Chat",
          createdAt: now,
          updatedAt: now,
          activeLeafId: idMap.get(messageId)!,
          ...(sourceThread?.configId
            ? { configId: sourceThread.configId }
            : {}),
          ...(sourceThread?.searchEnabled !== undefined
            ? { searchEnabled: sourceThread.searchEnabled }
            : {}),
        },
        clonedMessages,
      );
      await refreshThreads();
      switchThread(newThreadId);
    },
    [currentThreadId, messages, refreshThreads, switchThread],
  );

  const toggleSearchEnabled = useCallback(async () => {
    if (!currentProfileFromDeps) throw new Error("Select a profile first");
    const next = !searchEnabled;
    if (currentThreadId) {
      await setThreadSearchEnabled(currentThreadId, next);
      await refreshThreads();
    } else {
      draftSearchOverridesRef.current.set(draftThreadId, next);
      invalidateSessions();
    }
  }, [currentProfileFromDeps, currentThreadId, draftSearchOverridesRef, draftThreadId, refreshThreads, searchEnabled]);

  const clearError = useCallback(() => setError(null), [setError]);

  return {
    sessionsRef,
    sendMessage,
    stopStreaming,
    deleteThread,
    abortAllTurns,
    editMessage,
    regenerate,
    switchBranch,
    forkThreadFromMessage,
    toggleSearchEnabled,
    clearError,
  };
}
