import type { TherapySession } from "@/features/sessions/types";
import { uid } from "@/shared/lib/format";
import { createVersionedPersist } from "@/shared/lib/versionedPersist";
import { apiClient } from "@/shared/lib/apiClient";
import { getAuthHeaders } from "@/shared/lib/authSession";
import type { SessionStatus } from "@/shared/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SessionState {
  sessions: TherapySession[];
  highlightedId: string | null;
  compare: [string, string] | null;
  setStatus: (id: string, status: SessionStatus) => void;
  highlight: (id: string | null) => void;
  openCompare: (a: string, b: string) => void;
  closeCompare: () => void;
  retryInterrupted: () => number;
  addSession: (session: Omit<TherapySession, "id">) => void;
  query: string;
  statusFilter: "all" | SessionStatus;
  setQuery: (query: string) => void;
  setStatusFilter: (status: "all" | SessionStatus) => void;
  wipe: () => void;
}

const seed: TherapySession[] = [
  {
    id: "ses_slack",
    title: "Slack spiral",
    status: "extracted",
    mood: 4,
    moodLabel: "anxious",
    startedAt: "2026-08-13T08:02:00.000Z",
    durationMin: 18,
    excerpt: "Unsent drafts. Tight chest. Threat-scan of the thread.",
    thought: "If I send the wrong thing, I'll damage the relationship.",
    reframe: "A delayed, imperfect message can still be relationally safe.",
  },
  {
    id: "ses_kitchen",
    title: "Sunday kitchen spiral",
    status: "extracted",
    mood: 3,
    moodLabel: "agitated",
    startedAt: "2026-08-11T09:20:00.000Z",
    durationMin: 24,
    excerpt: "Catastrophizing after a delayed text. Body 7/10.",
    thought: "Delay means rejection.",
    reframe: "Delay ≠ rejection. Three prior late-but-warm replies.",
  },
  {
    id: "ses_reframe",
    title: "Reappraisal that landed",
    status: "extracted",
    mood: 7,
    moodLabel: "hopeful",
    startedAt: "2026-08-10T16:02:00.000Z",
    durationMin: 16,
    excerpt: "Evidence collection. The catastrophe probability dropped.",
    thought: "I always get this wrong.",
    reframe: "I have a record of repair, not just of mistakes.",
  },
  {
    id: "ses_sleep",
    title: "2 a.m. rumination",
    status: "pending",
    mood: 3,
    moodLabel: "low",
    startedAt: "2026-08-08T02:14:00.000Z",
    durationMin: 11,
    excerpt: "Meeting replay. Sleep onset 94 min. 4-7-8 used twice.",
    thought: "If I don't settle this tonight, tomorrow is ruined.",
    reframe: null,
  },
  {
    id: "ses_walk",
    title: "Walk after supervision",
    status: "pending",
    mood: 6,
    moodLabel: "grounded",
    startedAt: "2026-08-06T17:40:00.000Z",
    durationMin: 12,
    excerpt: "Named the critic. Shoulders dropped on the second block.",
    thought: "They saw through me.",
    reframe: "Feedback is data, not a verdict on worth.",
  },
  {
    id: "ses_drop",
    title: "Interrupted mid-thought-record",
    status: "interrupted",
    mood: 2,
    moodLabel: "numb",
    startedAt: "2026-08-04T21:05:00.000Z",
    durationMin: 6,
    excerpt: "Connection dropped while rating the belief. No extraction yet.",
    thought: "I can't even finish a worksheet.",
    reframe: null,
  },
];

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: seed,
      highlightedId: null,
      compare: null,
      setStatus: (id, status) =>
        set((s) => ({
          sessions: s.sessions.map((session) => (session.id === id ? { ...session, status } : session)),
        })),
      highlight: (highlightedId) => set({ highlightedId }),
      openCompare: (a, b) => {
        if (a === b) return;
        set({ compare: [a, b] });
      },
      closeCompare: () => set({ compare: null }),
      query: "",
      statusFilter: "all",
      setQuery: (query) => set({ query }),
      setStatusFilter: (statusFilter) => set({ statusFilter }),
      addSession: (session) => {
        const newSession = { ...session, id: uid("ses") };
        set((s) => ({ sessions: [newSession, ...s.sessions] }));

        // Sync to backend — fire and forget
        const auth = getAuthHeaders();
        if (auth) {
          apiClient.saveSession(
            { v: 1, session: newSession },
            auth.token,
            auth.deviceId,
          ).catch((err) => console.warn("[API] Failed to sync session to backend:", err));
        }
      },
      retryInterrupted: () => {
        const interrupted = get().sessions.filter((s) => s.status === "interrupted");
        if (interrupted.length === 0) return 0;
        set((s) => ({
          sessions: s.sessions.map((session) =>
            session.status === "interrupted" ? { ...session, status: "pending" } : session,
          ),
        }));
        return interrupted.length;
      },
      wipe: () => set({ sessions: [], highlightedId: null, compare: null }),
    }),
    createVersionedPersist<SessionState, { sessions: TherapySession[] }>({
      name: "cbt-sessions",
      partialize: (s) => ({ sessions: s.sessions }),
    }),
  ),
);
