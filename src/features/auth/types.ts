import type { TherapyGoal } from "@/shared/types";

export type AuthMethod = "passkey" | "magic-link";

export type AuthStatus = "anonymous" | "authenticated" | "onboarded";

export type OnboardingStep = "disclosure" | "consent" | "goals" | "emergency";

export interface EmergencyContact {
  name: string;
  phone: string;
  notify: boolean;
}

export interface SessionProfile {
  id: string;
  email: string;
  displayName: string;
  authMethod: AuthMethod;
  goals: TherapyGoal[];
  consentAcceptedAt: string | null;
  consentVersion: string;
  credentialId: string | null;
  sessionToken?: string;
  emergency: EmergencyContact | null;
}

export interface GoalDefinition {
  id: TherapyGoal;
  label: string;
  headline: string;
  detail: string;
}

export const CONSENT_VERSION = "2026.08-cbt-1";
