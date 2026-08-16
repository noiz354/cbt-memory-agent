import { useChatStore } from "@/features/chat/store/chatStore";
import { Badge } from "@/shared/ui/Badge";
import { ShieldCheck } from "lucide-react";
import { CameraPip } from "./CameraPip";

export function MediaDock() {
  const recording = useChatStore((s) => s.recording);
  const isStreaming = useChatStore((s) => s.isStreaming);

  return (
    <>
      <CameraPip />
      <div className="pointer-events-none absolute bottom-[7.5rem] left-1/2 z-20 hidden -translate-x-1/2 @3xl:block">
        <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-ink/90 px-3 py-1.5 text-[11px] font-medium text-white/80 shadow-[var(--shadow-float)]">
          <ShieldCheck className="size-3.5 text-teal-soft" />
          On-device analysis · raw media stays in-browser; only the clinical summary syncs
          {recording && <Badge tone="danger">REC</Badge>}
          {isStreaming && <Badge tone="teal">SSE</Badge>}
        </div>
      </div>
    </>
  );
}
