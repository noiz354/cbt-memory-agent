import { spring } from "@/shared/lib/motion";
import { cn } from "@/shared/lib/cn";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { Check, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ConsentSliderProps {
  accepted: boolean;
  onAccept: () => void;
}

const THRESHOLD = 0.9;

export function ConsentSlider({ accepted, onAccept }: ConsentSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(240);
  const x = useMotionValue(0);
  const fill = useTransform(x, [0, max], [72, max + 72]);

  useEffect(() => {
    const measure = () => {
      const track = trackRef.current;
      if (!track) return;
      setMax(Math.max(160, track.clientWidth - 72));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (trackRef.current) observer.observe(trackRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (accepted) void animate(x, max, spring);
  }, [accepted, max, x]);

  const commit = (next: number) => {
    if (accepted) return;
    if (next / max >= THRESHOLD) {
      void animate(x, max, spring);
      onAccept();
      return;
    }
    void animate(x, 0, spring);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (accepted) return;
    if (event.key === "End" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(max);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const next = Math.min(max, x.get() + max * 0.12);
      void animate(x, next, spring);
      if (next / max >= THRESHOLD) commit(next);
    }
    if (event.key === "Home" || event.key === "ArrowLeft") {
      event.preventDefault();
      void animate(x, 0, spring);
    }
  };

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative h-16 overflow-hidden rounded-full",
        accepted ? "bg-success-mist" : "bg-ink/[0.06]",
      )}
    >
      <motion.div
        aria-hidden
        className={cn("absolute inset-y-0 left-0 rounded-full", accepted ? "bg-success" : "bg-teal/25")}
        style={{ width: fill }}
      />
      <p
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center pl-10 text-sm font-semibold tracking-wide",
          accepted ? "text-white" : "text-ink-mute",
        )}
      >
        {accepted ? "Consent recorded on this device" : "Drag to accept informed consent"}
      </p>
      <motion.button
        type="button"
        role="slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={accepted ? 100 : 0}
        aria-label="Drag to accept informed consent"
        aria-disabled={accepted}
        disabled={accepted}
        drag={accepted ? false : "x"}
        dragConstraints={{ left: 0, right: max }}
        dragElastic={0.04}
        dragMomentum={false}
        style={{ x }}
        onDragEnd={() => commit(x.get())}
        onKeyDown={onKeyDown}
        transition={spring}
        className={cn(
          "absolute left-1.5 top-1.5 z-10 flex size-[52px] items-center justify-center rounded-full text-white shadow-[var(--shadow-float)]",
          accepted ? "bg-success cursor-default" : "bg-ink cursor-grab active:cursor-grabbing",
        )}
      >
        {accepted ? <Check className="size-5" /> : <ChevronRight className="size-5" />}
      </motion.button>
    </div>
  );
}
