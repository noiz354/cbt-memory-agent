import { useAuthStore, isSessionExpired } from "@/features/auth/store/authStore";
import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";

export function SessionGate({ children }: { children: React.ReactNode }) {
  const hydrated = useAuthStore((s) => s.hydrated);
  const status = useAuthStore((s) => s.status);
  const checkedExpiry = useRef(false);

  useEffect(() => {
    const mark = () => useAuthStore.getState().setHydrated(true);
    if (useAuthStore.persist.hasHydrated()) mark();
    return useAuthStore.persist.onFinishHydration(mark);
  }, []);

  // Session expiry: if the persisted session is past its TTL, sign out so the
  // status flips to anonymous and this component redirects to /auth below.
  useEffect(() => {
    if (!hydrated || checkedExpiry.current) return;
    checkedExpiry.current = true;
    const { status: s, sessionExpiresAt } = useAuthStore.getState();
    if (s !== "anonymous" && isSessionExpired(sessionExpiresAt)) {
      useAuthStore.getState().signOut();
    }
  }, [hydrated]);

  if (!hydrated) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-ink text-white">
        <p className="font-display text-sm tracking-wide text-white/70">Restoring local session…</p>
      </div>
    );
  }

  if (status === "anonymous") return <Navigate to="/auth" replace />;
  if (status === "authenticated") return <Navigate to="/onboarding" replace />;
  return children;
}
