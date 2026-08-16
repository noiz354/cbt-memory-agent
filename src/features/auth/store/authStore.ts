import { CONSENT_VERSION, type AuthMethod, type AuthStatus, type EmergencyContact, type OnboardingStep, type SessionProfile } from "@/features/auth/types";
import { authenticatePasskey, readPasskeyRegistry, registerPasskey } from "@/features/auth/lib/passkey";
import { useAuditStore } from "@/shared/store/auditStore";
import { uid, secureToken } from "@/shared/lib/format";
import { apiClient } from "@/shared/lib/apiClient";
import { track, TELEMETRY_EVENTS } from "@/shared/lib/telemetryEvents";
import { createVersionedPersist } from "@/shared/lib/versionedPersist";
import type { TherapyGoal } from "@/shared/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const MAGIC_LINK_TTL_MS = 10 * 60 * 1000;

/** Client-side session TTL. The backend session_token is long-lived, so the
 *  app enforces its own expiry to re-prompt sign-in after extended inactivity. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function isSessionExpired(sessionExpiresAt: number | null, now: number = Date.now()): boolean {
  return sessionExpiresAt !== null && now > sessionExpiresAt;
}

export interface MagicLinkIssueResult {
  ok: boolean;
  sent: boolean;
  token: string | null;
  error?: string;
}

export interface PasskeySignInResult {
  ok: boolean;
  reason?: "unsupported" | "empty" | "cancelled" | "failed" | "unregistered";
}

interface AuthState {
  hydrated: boolean;
  status: AuthStatus;
  profile: SessionProfile | null;
  step: OnboardingStep;
  pendingEmail: string;
  magicToken: string | null;
  magicTokenExpiresAt: number | null;
  /** Epoch ms when this session expires; null when signed out. */
  sessionExpiresAt: number | null;
  setHydrated: (value: boolean) => void;
  setPendingEmail: (email: string) => void;
  issueMagicLink: (email: string, displayName: string) => Promise<MagicLinkIssueResult>;
  consumeMagicLink: (token: string) => Promise<boolean>;
  completeAuth: (input: {
    email: string;
    displayName: string;
    method: AuthMethod;
    credentialId: string | null;
  }) => void;
  signInWithPasskey: () => Promise<PasskeySignInResult>;
  hasRegisteredPasskey: () => boolean;
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
      magicTokenExpiresAt: null,
      sessionExpiresAt: null,
      setHydrated: (hydrated) => set({ hydrated }),
      setPendingEmail: (pendingEmail) => set({ pendingEmail }),
      issueMagicLink: async (email, displayName) => {
        set({
          pendingEmail: email,
          profile: emptyProfile({
            email,
            displayName,
            method: "magic-link",
            credentialId: null,
          }),
        });

        try {
          const res = await apiClient.requestMagicLink(email, displayName);
          if (res.ok && res.sent) {
            // Real email sent by the backend (Resend). No preview token available.
            set({ magicToken: null, magicTokenExpiresAt: null });
            return { ok: true, sent: true, token: null };
          }
          if (res.ok && res.devUrl) {
            // Dev mode: backend has no RESEND_API_KEY, it returned a preview URL.
            const url = new URL(res.devUrl);
            const token = url.searchParams.get("token") ?? secureToken("lnk");
            set({
              magicToken: token,
              magicTokenExpiresAt: Date.now() + MAGIC_LINK_TTL_MS,
            });
            return { ok: true, sent: false, token };
          }
          return {
            ok: false,
            sent: false,
            token: null,
            error: res.error ?? "Failed to request a magic link.",
          };
        } catch (err) {
          return {
            ok: false,
            sent: false,
            token: null,
            error: err instanceof Error ? err.message : "Failed to request a magic link.",
          };
        }
      },
      consumeMagicLink: async (token) => {
        try {
          const res = await apiClient.consumeMagicLink(token);
          if (!res.ok) {
            set({ magicToken: null, magicTokenExpiresAt: null });
            return false;
          }
          set((s) => ({
            status: "authenticated",
            magicToken: null,
            magicTokenExpiresAt: null,
            sessionExpiresAt: Date.now() + SESSION_TTL_MS,
            step: "disclosure",
            profile: s.profile
              ? {
                  ...s.profile,
                  email: res.email ?? s.profile.email,
                  sessionToken: res.sessionToken ?? s.profile.sessionToken,
                }
              : s.profile,
          }));
          track(TELEMETRY_EVENTS.loginCompleted, { method: "magic-link" });
          return true;
        } catch {
          set({ magicToken: null, magicTokenExpiresAt: null });
          return false;
        }
      },
      completeAuth: (input) => {
        const profile = emptyProfile(input);
        if (input.method === "passkey" && input.credentialId) {
          registerPasskey({
            credentialId: input.credentialId,
            source: "webauthn",
            email: profile.email,
            displayName: profile.displayName,
            profileId: profile.id,
            registeredAt: new Date().toISOString(),
          });
        }
        set({
          status: "authenticated",
          step: "disclosure",
          magicToken: null,
          magicTokenExpiresAt: null,
          sessionExpiresAt: Date.now() + SESSION_TTL_MS,
          profile,
        });
        track(TELEMETRY_EVENTS.loginCompleted, { method: input.method });
      },
      signInWithPasskey: async () => {
        const result = await authenticatePasskey();
        if (!result.ok) return { ok: false, reason: result.reason };
        const entry = readPasskeyRegistry().find((e) => e.credentialId === result.credentialId);
        if (!entry) return { ok: false, reason: "unregistered" };
        set({
          status: "authenticated",
          step: "disclosure",
          magicToken: null,
          magicTokenExpiresAt: null,
          sessionExpiresAt: Date.now() + SESSION_TTL_MS,
          profile: {
            id: entry.profileId,
            email: entry.email,
            displayName: entry.displayName,
            authMethod: "passkey",
            goals: [],
            consentAcceptedAt: null,
            consentVersion: CONSENT_VERSION,
            credentialId: entry.credentialId,
            emergency: null,
          },
        });
        track(TELEMETRY_EVENTS.loginCompleted, { method: "passkey" });
        return { ok: true };
      },
      hasRegisteredPasskey: () =>
        readPasskeyRegistry().some((e) => e.source === "webauthn"),
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
        track(TELEMETRY_EVENTS.onboardingCompleted);
      },
      signOut: () =>
        set({
          status: "anonymous",
          profile: null,
          step: "disclosure",
          pendingEmail: "",
          magicToken: null,
          magicTokenExpiresAt: null,
          sessionExpiresAt: null,
        }),
    }),
    createVersionedPersist<
      AuthState,
      { status: AuthStatus; profile: SessionProfile | null; step: OnboardingStep; sessionExpiresAt: number | null }
    >({
      name: "cbt-memory-agent-auth",
      partialize: (state) => ({
        status: state.status,
        profile: state.profile,
        step: state.step,
        sessionExpiresAt: state.sessionExpiresAt,
      }),
      migrate: (oldData, _fromVersion) => {
        // v0 → v1: add hydrated flag is not in partialize, so just pass through
        const data = oldData as {
          status?: AuthStatus;
          profile?: SessionProfile | null;
          step?: OnboardingStep;
          sessionExpiresAt?: number | null;
        };
        return {
          status: data.status ?? "anonymous",
          profile: data.profile ?? null,
          step: data.step ?? "disclosure",
          sessionExpiresAt: data.sessionExpiresAt ?? null,
        };
      },
      onRehydrateStorage: (state) => {
        state?.setHydrated(true);
      },
    }),
  ),
);
