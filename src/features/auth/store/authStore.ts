import { CONSENT_VERSION, type AuthMethod, type AuthStatus, type EmergencyContact, type OnboardingStep, type SessionProfile } from "@/features/auth/types";
import { useAuditStore } from "@/shared/store/auditStore";
import { uid } from "@/shared/lib/format";
import { createVersionedPersist } from "@/shared/lib/versionedPersist";
import type { TherapyGoal } from "@/shared/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  hydrated: boolean;
  status: AuthStatus;
  profile: SessionProfile | null;
  step: OnboardingStep;
  pendingEmail: string;
  magicToken: string | null;
  setHydrated: (value: boolean) => void;
  setPendingEmail: (email: string) => void;
  issueMagicLink: (email: string, displayName: string) => string;
  consumeMagicLink: (token: string) => boolean;
  completeAuth: (input: {
    email: string;
    displayName: string;
    method: AuthMethod;
    credentialId: string | null;
  }) => void;
  setStep: (step: OnboardingStep) => void;
  acceptConsent: () => void;
  toggleGoal: (goal: TherapyGoal) => void;
  addGoal: (goal: TherapyGoal) => void;
  removeGoal: (goal: TherapyGoal) => void;
  setEmergency: (contact: EmergencyContact | null) => void;
  finishOnboarding: () => void;
  signOut: () => void;
}

const emptyProfile = (input: {
  email: string;
  displayName: string;
  method: AuthMethod;
  credentialId: string | null;
}): SessionProfile => ({
  id: uid("usr"),
  email: input.email.trim().toLowerCase(),
  displayName: input.displayName.trim() || input.email.split("@")[0] || "Member",
  authMethod: input.method,
  goals: [],
  consentAcceptedAt: null,
  consentVersion: CONSENT_VERSION,
  credentialId: input.credentialId,
  emergency: null,
});

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      status: "anonymous",
      profile: null,
      step: "disclosure",
      pendingEmail: "",
      magicToken: null,
      setHydrated: (hydrated) => set({ hydrated }),
      setPendingEmail: (pendingEmail) => set({ pendingEmail }),
      issueMagicLink: (email, displayName) => {
        const token = uid("lnk");
        set({
          pendingEmail: email,
          magicToken: token,
          profile: emptyProfile({
            email,
            displayName,
            method: "magic-link",
            credentialId: null,
          }),
        });
        return token;
      },
      consumeMagicLink: (token) => {
        const state = get();
        if (!state.magicToken || state.magicToken !== token || !state.profile) return false;
        set({ status: "authenticated", magicToken: null, step: "disclosure" });
        return true;
      },
      completeAuth: (input) =>
        set({
          status: "authenticated",
          step: "disclosure",
          magicToken: null,
          profile: emptyProfile(input),
        }),
      setStep: (step) => set({ step }),
      acceptConsent: () =>
        set((s) => {
          useAuditStore.getState().log("CONSENT_GIVEN", `schema ${CONSENT_VERSION}`);
          return {
            profile: s.profile
              ? {
                  ...s.profile,
                  consentAcceptedAt: new Date().toISOString(),
                  consentVersion: CONSENT_VERSION,
                }
              : s.profile,
          };
        }),
      setEmergency: (emergency) =>
        set((s) => ({
          profile: s.profile ? { ...s.profile, emergency } : s.profile,
        })),
      toggleGoal: (goal) =>
        set((s) => {
          if (!s.profile) return s;
          const has = s.profile.goals.includes(goal);
          return {
            profile: {
              ...s.profile,
              goals: has ? s.profile.goals.filter((g) => g !== goal) : [...s.profile.goals, goal],
            },
          };
        }),
      addGoal: (goal) =>
        set((s) => {
          if (!s.profile || s.profile.goals.includes(goal)) return s;
          return { profile: { ...s.profile, goals: [...s.profile.goals, goal] } };
        }),
      removeGoal: (goal) =>
        set((s) => {
          if (!s.profile) return s;
          return { profile: { ...s.profile, goals: s.profile.goals.filter((g) => g !== goal) } };
        }),
      finishOnboarding: () => {
        const profile = get().profile;
        if (!profile?.consentAcceptedAt || profile.goals.length === 0) return;
        set({ status: "onboarded" });
      },
      signOut: () =>
        set({
          status: "anonymous",
          profile: null,
          step: "disclosure",
          pendingEmail: "",
          magicToken: null,
        }),
    }),
    createVersionedPersist<AuthState, { status: AuthStatus; profile: SessionProfile | null; step: OnboardingStep }>({
      name: "cbt-memory-agent-auth",
      partialize: (state) => ({
        status: state.status,
        profile: state.profile,
        step: state.step,
      }),
      migrate: (oldData, _fromVersion) => {
        // v0 → v1: add hydrated flag is not in partialize, so just pass through
        const data = oldData as { status?: AuthStatus; profile?: SessionProfile | null; step?: OnboardingStep };
        return {
          status: data.status ?? "anonymous",
          profile: data.profile ?? null,
          step: data.step ?? "disclosure",
        };
      },
      onRehydrateStorage: (state) => {
        state?.setHydrated(true);
      },
    }),
  ),
);
