import { useChatStore } from "@/features/chat/store/chatStore";
import { cancelVoiceNote, startVoiceNote, stopVoiceNote } from "@/features/chat/lib/voiceNote";
import { toast } from "@/shared/store/toastStore";
import { motion } from "framer-motion";
import { Mic } from "lucide-react";
import { useRef, useState } from "react";

export function HoldToTalkOrb() {
  const setRecording = useChatStore((s) => s.setRecording);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const recording = useChatStore((s) => s.recording);
  const [level, setLevel] = useState(0);
  const cancelling = useRef(false);

  const start = async () => {
    cancelling.current = false;
    const res = await startVoiceNote((rms) => setLevel(Math.min(1, rms / 0.5)));
    if (!res.ok) {
      toast("Microphone unavailable", res.error ?? "Permission denied.", "danger");
      return;
    }
    setRecording(true);
  };

  const stop = async () => {
    if (!recording) return;
    setRecording(false);
    setLevel(0);
    if (cancelling.current) return;
    const note = await stopVoiceNote();
    if (!note.ok) {
      if (note.blobUrl) {
        sendMessage("[voice note]", {
          durationMs: note.durationMs ?? 0,
          peaks: Array.from({ length: 32 }, () => 0.3 + Math.random() * 0.5),
          src: note.blobUrl,
        });
      } else {
        toast("Voice note failed", note.error ?? "Recording failed.", "danger");
      }
      return;
    }
    if (note.via === "web-speech") {
      toast(
        "On-device speech model unavailable",
        "Transcribed with your browser's speech service instead.",
        "ink",
      );
    }
    sendMessage(note.text ?? "[voice note]", {
      durationMs: note.durationMs ?? 0,
      peaks: Array.from({ length: 32 }, () => 0.3 + Math.random() * 0.5),
      src: note.blobUrl ?? "",
    });
  };

  return (
    <motion.button
      type="button"
      aria-label="Hold to talk — record a voice note and transcribe it on-device"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={() => {
        cancelling.current = true;
        cancelVoiceNote();
        setRecording(false);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        cancelling.current = true;
        cancelVoiceNote();
        setRecording(false);
      }}
      animate={{ scale: recording ? 1.12 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-white"
    >
      {recording && (
        <>
          <span className="absolute inset-0 animate-ping rounded-full bg-teal/40" />
          <span
            className="absolute bottom-1 right-1 size-1.5 rounded-full bg-danger"
            style={{ transform: `scale(${1 + level * 2})` }}
          />
        </>
      )}
      <Mic className="relative size-4" />
    </motion.button>
  );
}
