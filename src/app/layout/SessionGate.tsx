import { useAuthStore } from "@/features/auth/store/authStore";
import { useEffect } from "react";
import { Navigate } from "react-router-dom";

export function SessionGate({ children }: { children: React.ReactNode }) {
  const hydrated = useAuthStore((s) => s.hydrated);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    const mark = () => useAuthStore.getState().setHydrated(true);
    if (useAuthStore.persist.hasHydrated()) mark();
    return useAuthStore.persist.onFinishHydration(mark);
  }, []);

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
