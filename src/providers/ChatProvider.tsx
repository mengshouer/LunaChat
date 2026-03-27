"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
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
  deleteLastAssistantMessages,
  deleteMessagesFrom,
} from "@/lib/db";
import { uploadAttachments } from "@/lib/attachment-storage";
import type { Attachment, PendingAttachment } from "@/lib/attachments";
import { runReactLoop } from "@/lib/react-loop";
import { createToolRegistry } from "@/lib/tools/registry";
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "@/lib/prompts";

export type SendMessageInput =
  | string
  | { content: string; attachments?: PendingAttachment[] };

interface ChatContextValue {
  messages: DBMessage[];
  isStreaming: boolean;
  streamingContent: string;
  streamingThinking: string;
  thinkingStartTime: number | null;
  streamingToolCalls: ToolCall[];
  error: string | null;
  sendMessage: (input: SendMessageInput) => Promise<void>;
  stopStreaming: () => void;
  regenerate: () => Promise<void>;
  rollbackToMessage: (messageId: string) => Promise<string | null>;
  clearError: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { currentThreadId, createNewThread, updateThreadTitle } = useThreads();
  const { settings, activeProfileId } = useSettings();
  const [messages, setMessages] = useState<DBMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null);
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const currentThreadIdRef = useRef(currentThreadId);
  useEffect(() => {
    currentThreadIdRef.current = currentThreadId;
  }, [currentThreadId]);

  // Per-thread streaming state cache
  const streamingStateMap = useRef<
    Map<string, { content: string; toolCalls: ToolCall[]; thinking: string; thinkingStartTime: number | null }>
  >(new Map());

  // Load messages and restore streaming state when thread changes
  useEffect(() => {
    setError(null);
    if (!currentThreadId) {
      setMessages([]);
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
    getMessages(currentThreadId).then(setMessages).catch(console.error);
  }, [currentThreadId]);

  const clearError = useCallback(() => setError(null), []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setStreamingContent("");
    setStreamingThinking("");
    setThinkingStartTime(null);
    setStreamingToolCalls([]);
    streamingStateMap.current.clear();
  }, []);

  // Inlines extracted text from non-image attachments into the message content.
  // Images are handled as multimodal blocks in the provider layer.
  function buildLLMContent(
    content: string,
    nonImageAttachments?: Attachment[],
  ): string {
    if (!nonImageAttachments || nonImageAttachments.length === 0)
      return content;
    const sections = nonImageAttachments.map((a) => {
      if (a.extractedText) {
        return `<file name="${a.name}" type="${a.mimeType}">\n${a.extractedText}\n</file>`;
      }
      return `<file name="${a.name}" type="${a.mimeType}">[binary file — content not available]</file>`;
    });
    const block = sections.join("\n\n");
    return content ? `${content}\n\n${block}` : block;
  }

  const sendMessage = useCallback(
    async (input: SendMessageInput) => {
      if (isStreaming) return;

      const content = typeof input === "string" ? input : (input.content ?? "");
      const pendingAttachments =
        typeof input === "string" ? [] : (input.attachments ?? []);

      let threadId = currentThreadId;
      if (!threadId) {
        threadId = await createNewThread(activeProfileId ?? undefined);
      }

      // Upload attachments (base64 data URLs for now)
      let attachments: Attachment[] = [];
      if (pendingAttachments.length > 0) {
        attachments = await uploadAttachments(pendingAttachments);
      }

      // Save user message
      const userMsg: DBMessage = {
        id: uuidv4(),
        threadId,
        role: "user",
        content,
        createdAt: Date.now(),
        ...(attachments.length > 0 ? { attachments } : {}),
      };
      await addMessage(userMsg);
      setMessages((prev) => [...prev, userMsg]);

      // Auto-generate title from first message
      const currentMessages = await getMessages(threadId);
      if (currentMessages.length === 1) {
        const title =
          content.length > 50
            ? content.slice(0, 50) + "..."
            : content || attachments[0]?.name || "New Chat";
        await updateThreadTitle(threadId, title);
      }

      // Build conversation history.
      // - Images and PDFs go into ChatMessage.attachments for multimodal provider blocks.
      // - Text/other files are inlined into content via buildLLMContent.
      const chatMessages: ChatMessage[] = currentMessages.map((m) => {
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

      // Thread guard helpers
      const isCurrentThread = () => currentThreadIdRef.current === threadId;

      const defaultState = () => ({
        content: "",
        toolCalls: [] as ToolCall[],
        thinking: "",
        thinkingStartTime: null as number | null,
      });

      const updateStreamingContent = (updater: (prev: string) => string) => {
        const state = streamingStateMap.current.get(threadId!) ?? defaultState();
        state.content = updater(state.content);
        streamingStateMap.current.set(threadId!, state);
        if (isCurrentThread()) setStreamingContent(state.content);
      };

      const updateStreamingThinking = (token: string) => {
        const state = streamingStateMap.current.get(threadId!) ?? defaultState();
        if (!state.thinkingStartTime) {
          state.thinkingStartTime = Date.now();
          if (isCurrentThread()) setThinkingStartTime(state.thinkingStartTime);
        }
        state.thinking += token;
        streamingStateMap.current.set(threadId!, state);
        if (isCurrentThread()) setStreamingThinking(state.thinking);
      };

      const updateStreamingToolCalls = (toolCalls: ToolCall[]) => {
        const state = streamingStateMap.current.get(threadId!) ?? defaultState();
        state.toolCalls = toolCalls;
        streamingStateMap.current.set(threadId!, state);
        if (isCurrentThread()) setStreamingToolCalls(toolCalls);
      };

      const appendErrorMessage = async (message: string) => {
        const text = (message ?? "").toString();
        const trimmed = text.trim();
        const errorText = trimmed || "Unknown error";
        const errorMsg: DBMessage = {
          id: uuidv4(),
          threadId: threadId!,
          role: "assistant",
          name: "error",
          content: errorText,
          createdAt: Date.now(),
        };

        await addMessage(errorMsg);

        if (isCurrentThread()) {
          setMessages((prev) => [...prev, errorMsg]);
        }
      };

      // Start streaming
      streamingStateMap.current.set(threadId!, {
        content: "",
        toolCalls: [],
        thinking: "",
        thinkingStartTime: null,
      });
      if (isCurrentThread()) {
        setIsStreaming(true);
        setStreamingContent("");
        setStreamingThinking("");
        setThinkingStartTime(null);
        setStreamingToolCalls([]);
      }
      setError(null);

      const abortController = new AbortController();
      abortRef.current = abortController;

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
                threadId: threadId!,
                role: "tool",
                content: result,
                toolCallId,
                name,
                createdAt: Date.now(),
              };
              await addMessage(toolResultMsg);
              if (isCurrentThread()) {
                setMessages((prev) => [...prev, toolResultMsg]);
              }
              updateStreamingContent(() => "");
              updateStreamingToolCalls([]);
            },
            onDone: async () => {},
            onError: (err) => {
              if (err.message !== "Aborted") {
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

        // Save all assistant messages to DB (always)
        const thinkingDuration = streamingStateMap.current.get(threadId!)?.thinkingStartTime
          ? Date.now() - streamingStateMap.current.get(threadId!)!.thinkingStartTime!
          : undefined;
        for (const aMsg of assistantMessages) {
          const reasoning = (aMsg as typeof aMsg & { reasoningContent?: string }).reasoningContent;
          const dbMsg: DBMessage = {
            id: uuidv4(),
            threadId: threadId!,
            role: "assistant",
            content: aMsg.content,
            toolCalls: aMsg.toolCalls,
            createdAt: Date.now(),
            ...(reasoning ? { reasoningContent: reasoning, thinkingDuration } : {}),
          };
          await addMessage(dbMsg);
          if (isCurrentThread()) {
            setMessages((prev) => [...prev, dbMsg]);
          }
        }
      } catch (err) {
        const e = err instanceof Error ? err : loopError;
        if (e && e.message !== "Aborted" && !errorAppended) {
          await appendErrorMessage(e.message);
          if (isCurrentThread()) {
            setError(e.message);
          }
        }
      } finally {
        streamingStateMap.current.delete(threadId!);
        abortRef.current = null;

        if (isCurrentThread()) {
          setIsStreaming(false);
          setStreamingContent("");
          setStreamingThinking("");
          setThinkingStartTime(null);
          setStreamingToolCalls([]);
          // Reload messages from DB to get clean state
          const freshMessages = await getMessages(threadId!);
          setMessages(freshMessages);
        }
      }
    },
    [
      isStreaming,
      currentThreadId,
      createNewThread,
      updateThreadTitle,
      settings,
    ],
  );

  const regenerate = useCallback(async () => {
    if (isStreaming || !currentThreadId) return;

    const threadId = currentThreadId;

    // Delete last assistant + tool messages
    await deleteLastAssistantMessages(threadId);
    const remainingMessages = await getMessages(threadId);
    setMessages(remainingMessages);

    // Get the last user message to re-send
    const lastUserMsg = remainingMessages
      .filter((m) => m.role === "user")
      .pop();
    if (!lastUserMsg) return;

    // Build conversation up to but not including the re-send
    const chatMessages: ChatMessage[] = remainingMessages.map((m) => ({
      role: m.role,
      content: buildLLMContent(m.content, m.attachments),
      toolCalls: m.toolCalls as ToolCall[] | undefined,
      toolCallId: m.toolCallId,
      name: m.name,
    }));

    // Thread guard helpers
    const isCurrentThread = () => currentThreadIdRef.current === threadId;

    const regenDefaultState = () => ({
      content: "",
      toolCalls: [] as ToolCall[],
      thinking: "",
      thinkingStartTime: null as number | null,
    });

    const updateStreamingContent = (updater: (prev: string) => string) => {
      const state = streamingStateMap.current.get(threadId) ?? regenDefaultState();
      state.content = updater(state.content);
      streamingStateMap.current.set(threadId, state);
      if (isCurrentThread()) setStreamingContent(state.content);
    };

    const updateStreamingThinkingRegen = (token: string) => {
      const state = streamingStateMap.current.get(threadId) ?? regenDefaultState();
      if (!state.thinkingStartTime) {
        state.thinkingStartTime = Date.now();
        if (isCurrentThread()) setThinkingStartTime(state.thinkingStartTime);
      }
      state.thinking += token;
      streamingStateMap.current.set(threadId, state);
      if (isCurrentThread()) setStreamingThinking(state.thinking);
    };

    const updateStreamingToolCalls = (toolCalls: ToolCall[]) => {
      const state = streamingStateMap.current.get(threadId) ?? regenDefaultState();
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
      };

      await addMessage(errorMsg);

      if (isCurrentThread()) {
        setMessages((prev) => [...prev, errorMsg]);
      }
    };

    streamingStateMap.current.set(threadId, regenDefaultState());
    if (isCurrentThread()) {
      setIsStreaming(true);
      setStreamingContent("");
      setStreamingThinking("");
      setThinkingStartTime(null);
      setStreamingToolCalls([]);
    }
    setError(null);

    const abortController = new AbortController();
    abortRef.current = abortController;

    const regenToolContext = {
      searchEnabled: settings.searchEnabled,
      searchProvider: settings.searchProvider,
      exaApiKey: settings.exaApiKey,
      exaBaseUrl: settings.exaBaseUrl,
      tavilyApiKey: settings.tavilyApiKey,
      tavilyBaseUrl: settings.tavilyBaseUrl,
    };
    const toolRegistry = createToolRegistry(regenToolContext);

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
        regenToolContext,
        systemPrompt,
        {
          onToken: (token) => {
            updateStreamingContent((prev) => prev + token);
          },
          onThinkingToken: (token) => {
            updateStreamingThinkingRegen(token);
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
            };
            await addMessage(toolResultMsg);
            if (isCurrentThread()) {
              setMessages((prev) => [...prev, toolResultMsg]);
            }
            updateStreamingContent(() => "");
            updateStreamingToolCalls([]);
          },
          onDone: async () => {},
          onError: (err) => {
            if (err.message !== "Aborted") {
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

      const thinkingDurationRegen = streamingStateMap.current.get(threadId)?.thinkingStartTime
        ? Date.now() - streamingStateMap.current.get(threadId)!.thinkingStartTime!
        : undefined;
      for (const aMsg of assistantMessages) {
        const reasoning = (aMsg as typeof aMsg & { reasoningContent?: string }).reasoningContent;
        const dbMsg: DBMessage = {
          id: uuidv4(),
          threadId,
          role: "assistant",
          content: aMsg.content,
          toolCalls: aMsg.toolCalls,
          createdAt: Date.now(),
          ...(reasoning ? { reasoningContent: reasoning, thinkingDuration: thinkingDurationRegen } : {}),
        };
        await addMessage(dbMsg);
        if (isCurrentThread()) {
          setMessages((prev) => [...prev, dbMsg]);
        }
      }
    } catch (err) {
      const e = err instanceof Error ? err : loopError;
      if (e && e.message !== "Aborted" && !errorAppended) {
        await appendErrorMessage(e.message);
        if (isCurrentThread()) {
          setError(e.message);
        }
      }
    } finally {
      streamingStateMap.current.delete(threadId);
      abortRef.current = null;

      if (isCurrentThread()) {
        setIsStreaming(false);
        setStreamingContent("");
        setStreamingThinking("");
        setThinkingStartTime(null);
        setStreamingToolCalls([]);
        const freshMessages = await getMessages(threadId);
        setMessages(freshMessages);
      }
    }
  }, [isStreaming, currentThreadId, settings]);

  const rollbackToMessage = useCallback(
    async (messageId: string): Promise<string | null> => {
      if (isStreaming || !currentThreadId) return null;
      const target = messages.find((m) => m.id === messageId);
      if (!target) return null;
      await deleteMessagesFrom(currentThreadId, messageId);
      const freshMessages = await getMessages(currentThreadId);
      setMessages(freshMessages);
      return target.content;
    },
    [isStreaming, currentThreadId, messages],
  );

  return (
    <ChatContext.Provider
      value={{
        messages,
        isStreaming,
        streamingContent,
        streamingThinking,
        thinkingStartTime,
        streamingToolCalls,
        error,
        sendMessage,
        stopStreaming,
        regenerate,
        rollbackToMessage,
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
