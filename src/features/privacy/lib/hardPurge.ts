import { useAuthStore } from "@/features/auth/store/authStore";
import { useChatStore } from "@/features/chat/store/chatStore";
import { useMemoryStore } from "@/features/memory/store/memoryStore";
import { useSessionStore } from "@/features/sessions/store/sessionStore";
import { wipeAllApiKeys } from "@/shared/lib/byokKeyManager";
import { getAuthHeaders } from "@/shared/lib/authSession";
import { apiClient } from "@/shared/lib/apiClient";
import { useAuditStore } from "@/shared/store/auditStore";
import { useThemeStore } from "@/shared/store/themeStore";
import { toast } from "@/shared/store/toastStore";

/**
 * All localStorage keys owned by this app.
 * Only these keys are wiped during hard purge — never `localStorage.clear()`.
 */
const CBT_KEYS = [
  "cbt-memory-graph",
  "cbt-sessions",
  "cbt-memory-agent-auth",
  "cbt-audit-log",
  "cbt-theme",
] as const;

/**
 * Hard purge: remove only `cbt-*` keys from localStorage and reset all stores.
 *
 * Never calls `localStorage.clear()` — that could destroy keys from other apps
 * sharing the same origin.
 *
 * After removal, verifies no `cbt-*` keys remain; if they do, retries once
 * and shows a failure toast.
 */
export async function hardPurgeLocalData() {
  useAuditStore.getState().log("HARD_PURGE", "Local vault and account erased");

  // Reset in-memory stores first
  useChatStore.getState().wipe();
  useMemoryStore.getState().wipe();
  useSessionStore.getState().wipe();
  useThemeStore.getState().setMode("light");

  // Wipe BYOK keys in IndexedDB (they are NOT in localStorage's cbt-* keys).
  // Fail-open: continue even if IndexedDB is unavailable.
  try {
    await wipeAllApiKeys();
  } catch {
    // IndexedDB unavailable (private mode / blocked) — nothing more we can do
  }

  // Best-effort server purge: delete all rows keyed to this user in CRDB.
  // Failure is surfaced via toast, not swallowed silently.
  const auth = getAuthHeaders();
  if (auth) {
    try {
      await apiClient.purge("hard-purge", auth.token, auth.deviceId);
    } catch (err) {
      toast(
        "Server data not purged",
        "Cloud rows could not be removed. Re-run purge when online.",
        "danger",
      );
      console.warn("[API] Failed to purge server data:", err);
    }
  }

  // Remove only allowlisted keys
  for (const key of CBT_KEYS) {
    localStorage.removeItem(key);
  }

  // Sign out (also clears its own persist on next save)
  useAuthStore.getState().signOut();

  // Verify: re-read keys that might have been re-hydrated
  const remaining = CBT_KEYS.filter((k) => localStorage.getItem(k) !== null);
  if (remaining.length > 0) {
    // Retry once
    for (const key of remaining) {
      localStorage.removeItem(key);
    }
    const stillRemaining = remaining.filter((k) => localStorage.getItem(k) !== null);
    if (stillRemaining.length > 0) {
      toast("Hard purge incomplete", `${stillRemaining.length} key(s) could not be removed.`, "danger");
    }
  }
}
