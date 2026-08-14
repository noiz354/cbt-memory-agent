import { useChatStore } from "@/features/chat/store/chatStore";
import { motion } from "framer-motion";
import { Mic } from "lucide-react";
import { useRef } from "react";

export function HoldToTalkOrb() {
  const setRecording = useChatStore((s) => s.setRecording);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const recording = useChatStore((s) => s.recording);
  const hold = useRef<number | null>(null);

  const start = () => {
    setRecording(true);
    hold.current = window.setTimeout(() => undefined, 0);
  };

  const stop = () => {
    if (!recording) return;
    setRecording(false);
    sendMessage(
      "Voice note (on-device): I notice my shoulders are up and I'm drafting replies I never send. The thought is that I'll sound incompetent.",
    );
  };

  return (
    <motion.button
      type="button"
      aria-label="Hold to talk"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      animate={{ scale: recording ? 1.12 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-white"
    >
      {recording && (
        <span className="absolute inset-0 animate-ping rounded-full bg-teal/40" />
      )}
      <Mic className="relative size-4" />
    </motion.button>
  );
}
