import type { MoodLabel, SessionStatus } from "@/shared/types";

export interface TherapySession {
  id: string;
  title: string;
  status: SessionStatus;
  mood: number;
  moodLabel: MoodLabel;
  startedAt: string;
  durationMin: number;
  excerpt: string;
  thought: string;
  reframe: string | null;
}

export type SessionView = "kanban" | "timeline";
