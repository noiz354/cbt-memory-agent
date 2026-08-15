import { useAuthStore } from "@/features/auth/store/authStore";
import { useChatStore } from "@/features/chat/store/chatStore";
import { useSessionStore } from "@/features/sessions/store/sessionStore";
import { useAuditStore } from "@/shared/store/auditStore";
import { useAppStore } from "@/shared/store/appStore";
import { toast } from "@/shared/store/toastStore";
import { Badge } from "@/shared/ui/Badge";
import { Phone, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export function ChatSafetyHeader() {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const recording = useChatStore((s) => s.recording);
  const messages = useChatStore((s) => s.messages);
  const triggerCrisis = useAppStore((s) => s.triggerCrisis);
  const addSession = useSessionStore((s) => s.addSession);
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  const finalize = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    addSession({
      title: lastUser ? lastUser.content.slice(0, 42) : "Live workspace",
      status: "extracted",
      mood: 5,
      moodLabel: "grounded",
      startedAt: new Date(Date.now() - elapsed * 1000).toISOString(),
      durationMin: Math.max(1, Math.round(elapsed / 60)),
      excerpt: lastUser?.content.slice(0, 140) ?? "Session finalized from the workspace.",
      thought: lastUser?.content ?? "",
      reframe: null,
    });
    useAuditStore.getState().log("SESSION_FINALIZED", `${mm}:${ss} · ${messages.length} turns`);
    toast("Session finalized", "Trace written to history.", "success");
    navigate("/sessions");
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Badge tone="teal">CBT Master · on-device</Badge>
      <Badge>TTS pending</Badge>
      <Badge>
        Sesi · {mm}:{ss}
      </Badge>
      {isStreaming && <Badge>SSE</Badge>}
      {recording && <Badge tone="danger">Mic</Badge>}
      <a
        href="tel:988"
        className="inline-flex h-8 items-center gap-1 rounded-full bg-danger px-3 text-[11px] font-bold uppercase tracking-wide text-white"
      >
        <Phone className="size-3" />
        988
      </a>
      <button
        type="button"
        onClick={() => triggerCrisis("Emergency pill from chat header.")}
        className="inline-flex h-8 items-center rounded-full bg-danger/10 px-3 text-[11px] font-bold uppercase tracking-wide text-danger"
      >
        119
      </button>
      <button
        type="button"
        onClick={finalize}
        className="inline-flex h-8 items-center gap-1 rounded-full bg-ink px-3 text-[11px] font-bold uppercase tracking-wide text-white"
      >
        <Square className="size-3" />
        End session
      </button>
      <span className="sr-only">{useAuthStore.getState().profile?.displayName}</span>
    </div>
  );
}
