export type TherapyGoal =
  | "anxiety"
  | "rumination"
  | "sleep"
  | "self-compassion"
  | "exposure"
  | "relapse-prevention";

export type MoodLabel =
  | "grounded"
  | "anxious"
  | "low"
  | "agitated"
  | "hopeful"
  | "numb";

export type SessionStatus = "extracted" | "pending" | "interrupted";

export interface UserProfile {
  id: string;
  displayName: string;
  goals: TherapyGoal[];
  consentAcceptedAt: string | null;
}
