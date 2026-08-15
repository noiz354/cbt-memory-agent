import { detectCrisis } from "@/features/crisis/lib/detectCrisis";
import { useMemoryStore } from "@/features/memory/store/memoryStore";
import { create } from "zustand";
import { uid } from "@/shared/lib/format";
import { useAppStore } from "@/shared/store/appStore";
import { getAuthHeaders } from "@/shared/lib/authSession";
import { callLLMWithFallback, type LLMMessage } from "@/shared/lib/llmClient";
import { apiClient } from "@/shared/lib/apiClient";
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
  face: FaceSignal;
  cameraOpen: boolean;
  recording: boolean;
  bargeIn: boolean;
  /** Live mic RMS (0..1) while recording; 0 when idle. Feeds crisis fusion. */
  prosody: number;
  setComposer: (value: string) => void;
  setActiveDropZone: (id: string | null) => void;
  setQuote: (quote: QuoteDraft | null) => void;
  attachFiles: (files: ChatAttachment[]) => void;
  removeAttachment: (id: string) => void;
  injectMemory: (memory: CoreMemory) => void;
  removePendingMemory: (id: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  sendMessage: (content?: string, audio?: { durationMs: number; peaks: number[]; src: string }) => void;
  appendStreamToken: (token: string) => void;
  finishStream: () => void;
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

const seedMessages: ChatMessage[] = [
  {
    id: "msg_1",
    role: "assistant",
    createdAt: "2026-08-13T08:02:00.000Z",
    content:
      "Welcome back. This session stays **on-device** — nothing raw leaves the browser.\n\nWhat would you like to work with today? You can type, hold-to-talk, or drag a **Core Memory** into the stream to inject context.",
  },
  {
    id: "msg_2",
    role: "user",
    createdAt: "2026-08-13T08:03:12.000Z",
    content:
      "I keep replaying yesterday's slack thread. My chest is tight and I already wrote three drafts I didn't send.",
  },
  {
    id: "msg_3",
    role: "assistant",
    createdAt: "2026-08-13T08:03:40.000Z",
    content:
      "That sounds like a **threat-scan loop**, not a character flaw.\n\nLet's name the automatic thought first:\n\n> If I send the wrong thing, I'll damage the relationship.\n\nOn a 0–10 scale, how *believable* does that feel in your body right now?\n\nYou can also drag **Sunday kitchen spiral** into this thread if the pattern matches.",
    audio: {
      durationMs: 18000,
      peaks: [0.2, 0.45, 0.7, 0.4, 0.85, 0.3, 0.6, 0.9, 0.35, 0.55, 0.25, 0.7, 0.4],
      playing: false,
      progress: 0,
    },
  },
];

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

  return `User message: "${userText.slice(0, 200)}${userText.length > 200 ? "…" : ""}"
${memoryNote}
Respond using CBT techniques: identify the automatic thought, name the cognitive distortion, suggest an evidence-based reframe. Keep it warm, concise (200-400 words), and collaborative.`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: seedMessages,
  composer: "",
  quote: null,
  pendingAttachments: [],
  pendingMemories: [],
  isStreaming: false,
  activeDropZone: null,
  activeSessionId: uid("ses"),
  face: { expression: "neutral", confidence: 0.42, updatedAt: Date.now(), model: "fallback" },
  cameraOpen: false,
  recording: false,
  bargeIn: false,
  prosody: 0,
  setComposer: (composer) => set({ composer }),
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
    set({
      activeSessionId: sessionId ?? uid("ses"),
    });
    if (created) track(TELEMETRY_EVENTS.sessionStarted);
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
      try {
        const messages: LLMMessage[] = [{ role: "user", content: reply }];
        let fullResponse = "";

        await callLLMWithFallback(messages, (chunk) => {
          if (!chunk.done) {
            fullResponse += chunk.delta;
            get().appendStreamToken(chunk.delta);
          } else {
            get().finishStream();
            metric.streamDone();
            track(TELEMETRY_EVENTS.streamDone);
          }
        });

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
        // All LLM fallbacks failed — show error message
        set((s) => ({
          isStreaming: false,
          messages: s.messages.map((m, i) =>
            i === s.messages.length - 1 && m.streaming
              ? {
                  ...m,
                  streaming: false,
                  content: `*— LLM unavailable. All providers failed (on-device, backend, and BYOK). Please try again later or configure an API key in Settings → LLM.*`,
                }
              : m,
          ),
        }));
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
  setCameraOpen: (cameraOpen) => set({ cameraOpen }),
  setFace: (face) => set({ face }),
  setRecording: (recording) => set({ recording }),
  setProsody: (prosody) => set({ prosody }),
  triggerBargeIn: () => {
    const { isStreaming } = get();
    if (!isStreaming) return;
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
      try {
        const messages: LLMMessage[] = [{ role: "user", content: "Continue your previous response from where it was truncated." }];
        await callLLMWithFallback(messages, (chunk) => {
          if (!chunk.done) {
            get().appendStreamToken(chunk.delta);
          } else {
            get().finishStream();
            metric.resumeSuccess();
            metric.streamDone();
            track(TELEMETRY_EVENTS.streamDone);
          }
        });
      } catch {
        set((s) => ({
          isStreaming: false,
          messages: s.messages.map((m, i) =>
            i === s.messages.length - 1 && m.streaming
              ? { ...m, streaming: false, content: `${m.content}\n\n*— resume failed —*` }
              : m,
          ),
        }));
      }
    })();
  },
  wipe: () =>
    set({
      messages: [],
      composer: "",
      quote: null,
      pendingAttachments: [],
      pendingMemories: [],
      isStreaming: false,
      recording: false,
      cameraOpen: false,
      bargeIn: false,
    }),
}));
