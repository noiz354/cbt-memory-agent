import { useEffect, useRef } from "react";
import { useAuthStore } from "@/features/auth/store/authStore";
import { useMemoryStore } from "@/features/memory/store/memoryStore";
import { useSessionStore } from "@/features/sessions/store/sessionStore";

/**
 * BackendSync — trigger read-side hydration saat user terautentikasi.
 *
 * Server data menang (Option A): begitu listMemory/listSessions berhasil,
 * state lokal (seed/demo) diganti data CockroachDB. Dipanggil sekali per
 * siklus autentikasi, plus re-hydrate saat status berubah ke onboarded.
 */
export function useBackendSync() {
  const status = useAuthStore((s) => s.status);
  const profileId = useAuthStore((s) => s.profile?.id);
  const lastSyncedKey = useRef<string>("");

  useEffect(() => {
    const isAuthed = status === "authenticated" || status === "onboarded";
    if (!isAuthed || !profileId) return;

    const key = `${profileId}:${status}`;
    if (key === lastSyncedKey.current) return;
    lastSyncedKey.current = key;

    void useMemoryStore.getState().hydrate();
    void useSessionStore.getState().hydrate();
  }, [status, profileId]);
}
