import { cn } from "@/shared/lib/cn";
import { usePointerDrag } from "@/features/chat/hooks/usePointerDrag";
import { useMemo, useState } from "react";

interface WaveformScrubberProps {
  peaks: number[];
  durationMs: number;
  onBargeIn?: () => void;
}

export function WaveformScrubber({ peaks, durationMs, onBargeIn }: WaveformScrubberProps) {
  const [progress, setProgress] = useState(0.22);
  const bars = useMemo(() => (peaks.length ? peaks : Array.from({ length: 24 }, () => 0.4)), [peaks]);

  const { bind, offset } = usePointerDrag({
    onMove: (dx) => {
      if (dx < -48) onBargeIn?.();
    },
    onScrub: (ratio) => setProgress(Math.min(1, Math.max(0, ratio))),
  });

  return (
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
  );
}
