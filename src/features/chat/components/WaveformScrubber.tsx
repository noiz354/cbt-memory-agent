import { cn } from "@/shared/lib/cn";
import { usePointerDrag } from "@/features/chat/hooks/usePointerDrag";
import { Play, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface WaveformScrubberProps {
  peaks: number[];
  durationMs: number;
  onBargeIn?: () => void;
  /** Real audio source (e.g. voice-note blob URL). When absent, renders decorative peaks only. */
  src?: string;
}

export function WaveformScrubber({ peaks, durationMs, onBargeIn, src }: WaveformScrubberProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bars = useMemo(() => (peaks.length ? peaks : Array.from({ length: 24 }, () => 0.4)), [peaks]);

  useEffect(() => {
    if (!src) return;
    const audio = new Audio(src);
    audio.preload = "auto";
    audioRef.current = audio;
    const onTime = () => {
      if (audio.duration) setProgress(audio.currentTime / audio.duration);
    };
    const onEnd = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
      audioRef.current = null;
    };
  }, [src]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const { bind, offset } = usePointerDrag({
    onMove: (dx) => {
      if (dx < -48) onBargeIn?.();
    },
    onScrub: (ratio) => {
      const clamped = Math.min(1, Math.max(0, ratio));
      setProgress(clamped);
      if (audioRef.current && audioRef.current.duration) {
        audioRef.current.currentTime = clamped * audioRef.current.duration;
      }
    },
  });

  return (
    <div className="space-y-1">
      <div
        {...bind}
        className="flex cursor-ew-resize touch-none select-none items-end gap-0.5 rounded-xl bg-canvas px-2 py-2"
        style={{ transform: `translateX(${Math.min(0, offset)}px)` }}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={durationMs}
        aria-valuenow={Math.round(progress * durationMs)}
        aria-label="Audio waveform scrubber"
      >
        {bars.map((peak, i) => {
          const filled = i / bars.length <= progress;
          return (
            <span
              key={i}
              className={cn("w-1 rounded-full", filled ? "bg-teal" : "bg-ink/15")}
              style={{ height: `${10 + peak * 22}px` }}
            />
          );
        })}
      </div>
      {src && (
        <button
          type="button"
          onClick={togglePlayback}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-white"
        >
          {playing ? <Square className="size-3" /> : <Play className="size-3" />}
          {playing ? "Stop" : "Play"}
        </button>
      )}
    </div>
  );
}
