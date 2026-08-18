import { detectCrisis } from "@/features/crisis/lib/detectCrisis";
import { useMemoryStore } from "@/features/memory/store/memoryStore";
import { turnsToMessages } from "@/features/chat/lib/chatTurns";
import { create } from "zustand";
import { uid } from "@/shared/lib/format";
import { useAppStore } from "@/shared/store/appStore";
import { getAuthHeaders } from "@/shared/lib/authSession";
import { callLLMWithFallback, isAbortError, type LLMMessage } from "@/shared/lib/llmClient";
import type { LLMProviderId } from "@/shared/lib/llmRegistry";
import {
  readPreferredModel,
  writePreferredModel,
} from "@/features/chat/lib/modelSelection";
import { apiClient } from "@/shared/lib/apiClient";
import { assistantErrorMessage, isSpecificLLMFailure } from "@/features/chat/lib/chatError";
import { metric } from "@/shared/lib/metrics";
import { track, TELEMETRY_EVENTS } from "@/shared/lib/telemetryEvents";
import type {
  ChatAttachment,
  ChatMessage,
  CoreMemory,
  FaceSignal,
  InjectedMemory,
  QuoteDraft,
} from "@/features/chat/types";

interface ChatState {
  messages: ChatMessage[];
  composer: string;
  quote: QuoteDraft | null;
  pendingAttachments: ChatAttachment[];
  pendingMemories: InjectedMemory[];
  isStreaming: boolean;
  activeDropZone: string | null;
  activeSessionId: string;
  /** Whether the active session's turns have been hydrated from the backend. */
  hydrated: boolean;
  hydrating: boolean;
  hydrateError: string | null;
  face: FaceSignal;
  cameraOpen: boolean;
  recording: boolean;
  bargeIn: boolean;
  /** Live mic RMS (0..1) while recording; 0 when idle. Feeds crisis fusion. */
  prosody: number;
  /** User's selected provider for replies (validated against registry). */
  preferredProviderId: string;
  preferredModelId: string;
  setPreferredModel: (providerId: string, modelId: string) => void;
  setComposer: (value: string) => void;
  setActiveDropZone: (id: string | null) => void;
  setQuote: (quote: QuoteDraft | null) => void;
  attachFiles: (files: ChatAttachment[]) => void;
  removeAttachment: (id: string) => void;
  injectMemory: (memory: CoreMemory) => void;
  removePendingMemory: (id: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  hydrate: (sessionId?: string) => Promise<void>;
  sendMessage: (content?: string, audio?: { durationMs: number; peaks: number[]; src: string }) => void;
  appendStreamToken: (token: string) => void;
  finishStream: () => void;
  recordBackendRecall: (memoryIds: string[]) => void;
  recordBackendRecallTitles: (titles: string[]) => void;
  setCameraOpen: (open: boolean) => void;
  setFace: (face: FaceSignal) => void;
  setRecording: (recording: boolean) => void;
  triggerBargeIn: () => void;
  attachSnapshot: (previewUrl: string) => void;
  hardHalt: () => void;
  resumeStream: () => void;
  setProsody: (rms: number) => void;
  wipe: () => void;
}

/** Active stream's AbortController — lets barge-in/hard-halt actually cancel the fetch. */
let activeAbort: AbortController | null = null;

function abortActiveStream(): void {
  activeAbort?.abort();
}

const ACTIVE_SESSION_KEY = "cbt-memory-agent-active-session";

function readStoredSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

function persistSessionId(sessionId: string): void {
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
  } catch {
    // localStorage unavailable (private mode) — session simply won't restore.
  }
}

function toInjected(memory: CoreMemory): InjectedMemory {
  return {
    id: memory.id,
    title: memory.title,
    excerpt: memory.excerpt,
    weight: memory.weight,
  };
}

function buildCBTPrompt(userText: string, memories: InjectedMemory[]): string {
  const memoryNote =
    memories.length > 0
      ? `\n\nWorking context: ${memories.map((m) => m.title).join(", ")}.`
      : "";

  // Master prompt (klinik psikolog) disuntikkan sebagai system message oleh
  // callLLM; di sini hanya membungkus pesan user + konteks memory yang dipilih.
  return `User message: "${userText.slice(0, 200)}${userText.length > 200 ? "…" : ""}"${memoryNote}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  composer: "",
  quote: null,
  pendingAttachments: [],
  pendingMemories: [],
  isStreaming: false,
  activeDropZone: null,
  activeSessionId: readStoredSessionId() ?? uid("ses"),
  hydrated: false,
  hydrating: false,
  hydrateError: null,
  face: { expression: "neutral", confidence: 0.42, updatedAt: Date.now(), model: "fallback" },
  cameraOpen: false,
  recording: false,
  bargeIn: false,
  prosody: 0,
  preferredProviderId: readPreferredModel()?.providerId ?? "",
  preferredModelId: readPreferredModel()?.modelId ?? "",
  setComposer: (composer) => set({ composer }),
  setPreferredModel: (providerId, modelId) => {
    writePreferredModel({ providerId: providerId as LLMProviderId, modelId });
    set({ preferredProviderId: providerId, preferredModelId: modelId });
  },
  setActiveDropZone: (activeDropZone) => set({ activeDropZone }),
  setQuote: (quote) => set({ quote }),
  attachFiles: (files) =>
    set((s) => ({ pendingAttachments: [...s.pendingAttachments, ...files] })),
  removeAttachment: (id) =>
    set((s) => ({
      pendingAttachments: s.pendingAttachments.filter((f) => f.id !== id),
    })),
  injectMemory: (memory) =>
    set((s) => {
      if (s.pendingMemories.some((m) => m.id === memory.id)) return s;
      useMemoryStore.getState().touchRecall(memory.id);
      return { pendingMemories: [...s.pendingMemories, toInjected(memory)] };
    }),
  removePendingMemory: (id) =>
    set((s) => ({
      pendingMemories: s.pendingMemories.filter((m) => m.id !== id),
    })),
  setActiveSession: (sessionId) => {
    const created = !sessionId;
    const next = sessionId ?? uid("ses");
    persistSessionId(next);
    set({
      activeSessionId: next,
    });
    if (created) track(TELEMETRY_EVENTS.sessionStarted);
  },
  hydrate: async (sessionId) => {
    const target = sessionId ?? get().activeSessionId;
    const auth = getAuthHeaders();
    if (!auth || get().hydrating) return;
    set({ hydrating: true, hydrateError: null });
    try {
      const res = await apiClient.listSessionTurns(target, auth.token, auth.deviceId);
      set({
        messages: turnsToMessages(res.turns),
        hydrated: true,
        hydrating: false,
      });
    } catch (err) {
      // FAIL-CLOSED: keep the stream empty rather than fabricate a transcript.
      set({
        messages: [],
        hydrated: true,
        hydrating: false,
        hydrateError: err instanceof Error ? err.message : "Failed to load conversation",
      });
    }
  },
  sendMessage: (content, audio?) => {
    const state = get();
    const text = (content ?? state.composer).trim();
    if (!text && state.pendingAttachments.length === 0) return;

    const crisis = text ? detectCrisis(text) : null;
    const userMessage: ChatMessage = {
      id: uid("msg"),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
      quotedFromId: state.quote?.messageId,
      attachments: state.pendingAttachments,
      injectedMemories: state.pendingMemories,
      audio,
    };

    if (crisis) {
      const halt: ChatMessage = {
        id: uid("msg"),
        role: "system",
        content:
          "**Crisis protocol engaged.** The CBT turn was hard-halted on this device. No further generation will run until you mark yourself safe.",
        createdAt: new Date().toISOString(),
      };
      set({
        messages: [...state.messages, userMessage, halt],
        composer: "",
        quote: null,
        pendingAttachments: [],
        pendingMemories: [],
        isStreaming: false,
        recording: false,
        bargeIn: true,
      });
      // Fail-closed: if triggerCrisis throws, streaming is already false above
      try {
        useAppStore.getState().triggerCrisis(crisis.reason);
      } catch {
        // Crisis overlay failed to engage — streaming is still false, safe state
        // The halt message informs the user; no further generation will run
      }
      return;
    }

    const assistant: ChatMessage = {
      id: uid("msg"),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      streaming: true,
    };

    set({
      messages: [...state.messages, userMessage, assistant],
      composer: "",
      quote: null,
      pendingAttachments: [],
      pendingMemories: [],
      isStreaming: true,
      bargeIn: false,
    });
    track(TELEMETRY_EVENTS.messageSent);

    const reply = buildCBTPrompt(text || "(media only)", userMessage.injectedMemories ?? []);

    // Call LLM with fallback chain (on-device → backend → BYOK)
    void (async () => {
      const controller = new AbortController();
      activeAbort = controller;
      try {
        const messages: LLMMessage[] = [{ role: "user", content: reply }];
        let fullResponse = "";

        const hasPref = Boolean(state.preferredProviderId && state.preferredModelId);
        const response = await callLLMWithFallback(
          messages,
          (chunk) => {
            if (chunk.injectedMemoryIds && chunk.injectedMemoryIds.length > 0) {
              get().recordBackendRecall(chunk.injectedMemoryIds);
            }
            if (chunk.recalledTitles && chunk.recalledTitles.length > 0) {
              get().recordBackendRecallTitles(chunk.recalledTitles);
            }
            if (!chunk.done) {
              fullResponse += chunk.delta;
              get().appendStreamToken(chunk.delta);
            } else {
              get().finishStream();
              metric.streamDone();
              track(TELEMETRY_EVENTS.streamDone);
            }
          },
          controller.signal,
          {
            backendUserText: text || "(media only)",
            preferred: hasPref
              ? { providerId: state.preferredProviderId as LLMProviderId, modelId: state.preferredModelId }
              : undefined,
          },
        );

        // Stamp the model that actually produced this reply onto the message.
        if (response?.providerId && response?.modelId) {
          set((s) => ({
            messages: s.messages.map((m) =>
              m.streaming
                ? { ...m, providerId: response.providerId, model: response.modelId }
                : m,
            ),
          }));
        }

        // Sync to backend (CockroachDB) — fire and forget
        const auth = getAuthHeaders();
        if (auth && fullResponse) {
          try {
            await apiClient.chatTurn(
              {
                v: 1,
                sessionId: get().activeSessionId || uid("ses"),
                userMessage: text || "(media only)",
                memoryIds: userMessage.injectedMemories?.map((m) => m.id),
                clientTs: new Date().toISOString(),
                deviceOnly: true,
              },
              auth.token,
              auth.deviceId,
            );
          } catch (err) {
            console.warn("[API] Failed to sync chat turn to backend:", err);
          }
        }
      } catch (err) {
        // User-initiated cancel (barge-in / hard-halt) — bubbles already closed.
        if (isAbortError(err)) return;
        // All LLM fallbacks failed — show error message
        const content = assistantErrorMessage(err);
        set((s) => ({
          isStreaming: false,
          messages: s.messages.map((m, i) =>
            i === s.messages.length - 1 && m.streaming
              ? { ...m, streaming: false, content }
              : m,
          ),
        }));
      } finally {
        if (activeAbort === controller) activeAbort = null;
      }
    })();
  },
  appendStreamToken: (token) =>
    set((s) => {
      const messages = s.messages.map((m, i) =>
        i === s.messages.length - 1 && m.streaming
          ? { ...m, content: m.content + token }
          : m,
      );
      return { messages };
    }),
  finishStream: () =>
    set((s) => ({
      isStreaming: false,
      messages: s.messages.map((m) =>
        m.streaming ? { ...m, streaming: false } : m,
      ),
    })),
  recordBackendRecall: (memoryIds) =>
    set((s) => ({
      messages: s.messages.map((m, i) =>
        i === s.messages.length - 1 && m.streaming
          ? { ...m, recalledMemoryIds: memoryIds }
          : m,
      ),
    })),
  recordBackendRecallTitles: (titles) =>
    set((s) => ({
      messages: s.messages.map((m, i) =>
        i === s.messages.length - 1 && m.streaming
          ? { ...m, recalledTitles: titles }
          : m,
      ),
    })),
  setCameraOpen: (cameraOpen) => set({ cameraOpen }),
  setFace: (face) => set({ face }),
  setRecording: (recording) => set({ recording }),
  setProsody: (prosody) => set({ prosody }),
  triggerBargeIn: () => {
    const { isStreaming } = get();
    if (!isStreaming) return;
    abortActiveStream();
    set((s) => ({
      bargeIn: true,
      isStreaming: false,
      messages: s.messages.map((m) =>
        m.streaming
          ? {
              ...m,
              streaming: false,
              truncated: true,
              content: `${m.content}\n\n*— barge-in: generation halted locally —*`,
            }
              : m,
      ),
    }));
    metric.streamTruncated();
    track(TELEMETRY_EVENTS.streamTruncated);
  },
  attachSnapshot: (previewUrl) =>
    set((s) => ({
      pendingAttachments: [
        ...s.pendingAttachments,
        {
          id: uid("snap"),
          kind: "image",
          name: "on-device-snapshot.jpg",
          sizeLabel: "local",
          previewUrl,
        },
      ],
    })),
  hardHalt: () => {
    abortActiveStream();
    set((s) => ({
      isStreaming: false,
      recording: false,
      cameraOpen: false,
      bargeIn: true,
      messages: s.messages.map((m) =>
        m.streaming
          ? {
              ...m,
              streaming: false,
              content: `${m.content}\n\n*— session hard-halted by crisis protocol —*`,
            }
              : m,
      ),
    }));
    metric.streamTruncated();
    track(TELEMETRY_EVENTS.streamTruncated);
  },
  resumeStream: () => {
    const last = get().messages.at(-1);
    if (!last?.truncated) return;
    set((s) => ({
      isStreaming: true,
      messages: s.messages.map((m) =>
        m.id === last.id ? { ...m, truncated: false, streaming: true } : m,
      ),
    }));

    // Resume via LLM fallback chain
    void (async () => {
      const controller = new AbortController();
      activeAbort = controller;
      try {
        const messages: LLMMessage[] = [{ role: "user", content: "Continue your previous response from where it was truncated." }];
        const hasPref = Boolean(get().preferredProviderId && get().preferredModelId);
        await callLLMWithFallback(
          messages,
          (chunk) => {
            if (!chunk.done) {
              get().appendStreamToken(chunk.delta);
            } else {
              get().finishStream();
              metric.resumeSuccess();
              metric.streamDone();
              track(TELEMETRY_EVENTS.streamDone);
            }
          },
          controller.signal,
          hasPref
            ? { preferred: { providerId: get().preferredProviderId as LLMProviderId, modelId: get().preferredModelId } }
            : undefined,
        );
      } catch (err) {
        if (isAbortError(err)) return;
        const specific = isSpecificLLMFailure(err);
        set((s) => ({
          isStreaming: false,
          messages: s.messages.map((m, i) =>
            i === s.messages.length - 1 && m.streaming
              ? {
                  ...m,
                  streaming: false,
                  content: specific
                    ? `${m.content}\n\n${assistantErrorMessage(err)}`
                    : `${m.content}\n\n*— resume failed —*`,
                }
              : m,
          ),
        }));
      } finally {
        if (activeAbort === controller) activeAbort = null;
      }
    })();
  },
  wipe: () => {
    const next = uid("ses");
    persistSessionId(next);
    set({
      messages: [],
      composer: "",
      quote: null,
      pendingAttachments: [],
      pendingMemories: [],
      isStreaming: false,
      activeSessionId: next,
      hydrated: false,
      hydrating: false,
      hydrateError: null,
      recording: false,
      cameraOpen: false,
      bargeIn: false,
    });
  },
}));
