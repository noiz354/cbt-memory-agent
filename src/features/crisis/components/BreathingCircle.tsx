import { cn } from "@/shared/lib/cn";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "inhale" | "hold" | "exhale";

const PHASES: { id: Exclude<Phase, "idle">; ms: number; label: string; scale: number }[] = [
  { id: "inhale", ms: 4000, label: "Inhale", scale: 1.32 },
  { id: "hold", ms: 7000, label: "Hold", scale: 1.32 },
  { id: "exhale", ms: 8000, label: "Exhale", scale: 1 },
];

export function BreathingCircle({ onCycle }: { onCycle?: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [remaining, setRemaining] = useState(0);
  const [cycles, setCycles] = useState(0);
  const holding = useRef(false);
  const index = useRef(0);
  const timer = useRef<number | null>(null);
  const ticker = useRef<number | null>(null);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (ticker.current) window.clearInterval(ticker.current);
    timer.current = null;
    ticker.current = null;
  };

  const runPhase = (i: number) => {
    const current = PHASES[i];
    setPhase(current.id);
    setRemaining(Math.ceil(current.ms / 1000));
    const started = Date.now();
    ticker.current = window.setInterval(() => {
      const left = Math.max(0, current.ms - (Date.now() - started));
      setRemaining(Math.ceil(left / 1000));
    }, 200);
    timer.current = window.setTimeout(() => {
      if (!holding.current) return;
      const next = i + 1;
      if (next >= PHASES.length) {
        setCycles((c) => c + 1);
        onCycle?.();
        index.current = 0;
        runPhase(0);
        return;
      }
      index.current = next;
      runPhase(next);
    }, current.ms);
  };

  const start = () => {
    holding.current = true;
    index.current = 0;
    runPhase(0);
  };

  const stop = () => {
    holding.current = false;
    clear();
    setPhase("idle");
    setRemaining(0);
  };

  useEffect(() => () => clear(), []);

  const active = PHASES.find((p) => p.id === phase);
  const scale = phase === "idle" ? 1 : (active?.scale ?? 1);

  return (
    <div className="flex flex-col items-center">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-teal-soft">
        4-7-8 grounding · touch & hold
      </p>
      <motion.button
        type="button"
        aria-label="Hold to breathe 4-7-8"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start();
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        animate={{ scale }}
        transition={
          phase === "hold" || phase === "idle"
            ? { type: "spring", stiffness: 300, damping: 25 }
            : { duration: (active?.ms ?? 400) / 1000, ease: "easeInOut" }
        }
        className={cn(
          "relative flex size-[168px] items-center justify-center rounded-full text-white",
          phase === "idle" ? "bg-white/10" : "bg-teal",
        )}
      >
        <span className="absolute inset-3 rounded-full border border-white/20" />
        <span className="text-center">
          <span className="block font-display text-lg font-bold">
            {phase === "idle" ? "Hold" : active?.label}
          </span>
          <span className="block text-sm tabular-nums text-white/80">
            {phase === "idle" ? "4 · 7 · 8" : `${remaining}s`}
          </span>
        </span>
      </motion.button>
      <p className="mt-3 text-xs text-white/50">
        {cycles === 0
          ? "Keep your finger down. Release pauses the cycle."
          : `${cycles} full cycle${cycles === 1 ? "" : "s"} completed on this device.`}
      </p>
    </div>
  );
}
