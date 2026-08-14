import { spring } from "@/shared/lib/motion";
import { cn } from "@/shared/lib/cn";
import { animate, motion, useMotionValue } from "framer-motion";
import { Phone } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const NUMBERS = [
  { id: "988", label: "988", hint: "Suicide & crisis lifeline" },
  { id: "119", label: "119", hint: "Emergency · Indonesia" },
] as const;

export function SwipeToCall() {
  const [dest, setDest] = useState<(typeof NUMBERS)[number]["id"]>("119");
  const trackRef = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(220);
  const x = useMotionValue(0);

  useEffect(() => {
    const measure = () => {
      const track = trackRef.current;
      if (!track) return;
      setMax(Math.max(140, track.clientWidth - 92));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (trackRef.current) observer.observe(trackRef.current);
    return () => observer.disconnect();
  }, []);

  const commit = (next: number) => {
    if (next / max >= 0.88) {
      void animate(x, max, spring);
      window.location.href = `tel:${dest}`;
      return;
    }
    void animate(x, 0, spring);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">
          Swipe to call
        </p>
        <div className="flex rounded-full bg-white/8 p-0.5">
          {NUMBERS.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setDest(n.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-bold",
                dest === n.id ? "bg-danger text-white" : "text-white/55",
              )}
            >
              {n.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={trackRef} className="relative h-16 overflow-hidden rounded-full bg-white/8">
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center pl-10 text-sm font-semibold text-white/70">
          Slide to dial {dest} · {NUMBERS.find((n) => n.id === dest)?.hint}
        </p>
        <motion.button
          type="button"
          aria-label={`Slide to call ${dest}`}
          drag="x"
          dragConstraints={{ left: 0, right: max }}
          dragElastic={0.04}
          dragMomentum={false}
          style={{ x }}
          onDragEnd={() => commit(x.get())}
          transition={spring}
          className="absolute left-1.5 top-1.5 z-10 flex h-[52px] items-center gap-2 rounded-full bg-danger px-4 text-sm font-bold text-white shadow-[var(--shadow-float)]"
        >
          <Phone className="size-4" />
          Call
        </motion.button>
      </div>
    </div>
  );
}
