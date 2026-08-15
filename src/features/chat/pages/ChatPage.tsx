import { ChatStream } from "@/features/chat/components/ChatStream";
import { Composer } from "@/features/chat/components/Composer";
import { FileDropzone } from "@/features/chat/components/FileDropzone";
import { MediaDock } from "@/features/chat/components/MediaDock";
import { MemoryRail } from "@/features/chat/components/MemoryRail";
import { SpatialDndProvider } from "@/features/chat/components/SpatialDndProvider";
import { useAuthStore } from "@/features/auth/store/authStore";
import { useChatStore } from "@/features/chat/store/chatStore";
import { THERAPY_GOALS } from "@/features/auth/lib/goals";
import { ChatSafetyHeader } from "@/features/chat/components/ChatSafetyHeader";
import { Badge } from "@/shared/ui/Badge";
import { Lock } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export function ChatPage() {
  const profile = useAuthStore((s) => s.profile);
  const seated = THERAPY_GOALS.filter((goal) => profile?.goals.includes(goal.id));
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const sessionId = searchParams.get("session");
    if (sessionId) setActiveSession(sessionId);
  }, [searchParams, setActiveSession]);

  return (
    <SpatialDndProvider>
      <div className="@container container-chat relative flex h-full min-h-0 flex-col spatial-grid">
        <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 @md:px-6">
          <div>
            <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
              Live session
            </p>
            <h1 className="font-display text-lg font-bold text-ink @md:text-xl">
              {profile ? `${profile.displayName}'s workspace` : "Spatial workspace"}
            </h1>
            {seated.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {seated.map((goal) => (
                  <span
                    key={goal.id}
                    className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-ink-mute ring-1 ring-line"
                  >
                    {goal.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex max-w-full flex-col items-end gap-2">
            <Badge tone="teal">
              <Lock className="size-3" />
              On-device
            </Badge>
            <ChatSafetyHeader />
          </div>
        </header>

        <FileDropzone>
          <div className="relative flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 @md:px-5">
            <MemoryRail />
            <ChatStream />
            <Composer />
            <MediaDock />
          </div>
        </FileDropzone>
      </div>
    </SpatialDndProvider>
  );
}
