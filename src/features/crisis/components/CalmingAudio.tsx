import { cn } from "@/shared/lib/cn";
import { Waves } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * On-device binaural bed. No file fetch. Starts only on user gesture.
 * Two oscillators panned hard L/R (StereoPannerNode) so the carrier-fre- quency
 * difference (174 vs 180 Hz) is perceived as a true 6 Hz binaural beat.
 */
export function CalmingAudio() {
  const [on, setOn] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodes = useRef<{ a: OscillatorNode; b: OscillatorNode; pL: StereoPannerNode; pR: StereoPannerNode; gain: GainNode } | null>(null);

  const stop = () => {
    nodes.current?.a.stop();
    nodes.current?.b.stop();
    void ctxRef.current?.close();
    nodes.current = null;
    ctxRef.current = null;
    setOn(false);
  };

  const start = async () => {
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.type = "sine";
    b.type = "sine";
    a.frequency.value = 174;
    b.frequency.value = 180;
    const pL = ctx.createStereoPanner();
    const pR = ctx.createStereoPanner();
    pL.pan.value = -1;
    pR.pan.value = 1;
    a.connect(pL);
    pL.connect(gain);
    b.connect(pR);
    pR.connect(gain);
    gain.connect(ctx.destination);
    a.start();
    b.start();
    nodes.current = { a, b, pL, pR, gain };
    setOn(true);
  };

  useEffect(() => () => stop(), []);

  return (
    <button
      type="button"
      onClick={() => (on ? stop() : void start())}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold",
        on ? "bg-teal text-white" : "bg-white/10 text-white/80",
      )}
    >
      <Waves className="size-3.5" />
      {on ? "Calming bed on · tap to stop" : "Play on-device calming tone"}
    </button>
  );
}
