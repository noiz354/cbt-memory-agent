import { useAuthStore } from "@/features/auth/store/authStore";
import { useAuditStore } from "@/shared/store/auditStore";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const CHANNEL = "cbt-memory-agent-auth";

export function broadcastSignOut() {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ type: "SIGN_OUT" });
    channel.close();
  } catch {
    /* BroadcastChannel unavailable */
  }
}

export function TabSync() {
  const signOut = useAuthStore((s) => s.signOut);
  const navigate = useNavigate();

  useEffect(() => {
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(CHANNEL);
    } catch {
      return;
    }
    channel.onmessage = (event: MessageEvent<unknown>) => {
      // Strict: only accept exact { type: "SIGN_OUT" } — ignore everything else
      const data = event.data;
      if (
        typeof data !== "object" ||
        data === null ||
        !("type" in data) ||
        (data as { type?: unknown }).type !== "SIGN_OUT"
      ) {
        return;
      }
      // Ignore any additional fields
      useAuditStore.getState().log("SIGN_OUT", "Cross-tab sign-out");
      signOut();
      navigate("/auth");
    };
    return () => channel.close();
  }, [navigate, signOut]);

  return null;
}
