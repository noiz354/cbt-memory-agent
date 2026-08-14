import { cn } from "@/shared/lib/cn";
import { motion } from "framer-motion";
import { Flame, Trash2 } from "lucide-react";

interface PurgeZoneProps {
  armed: boolean;
}

export function PurgeZone({ armed }: PurgeZoneProps) {
  return (
    <motion.div
      data-purge-zone
      data-no-pan
      animate={{ scale: armed ? 1.08 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={cn(
        "pointer-events-auto absolute bottom-5 right-5 z-30 flex size-[88px] flex-col items-center justify-center rounded-full shadow-[var(--shadow-float)]",
        armed ? "bg-danger text-white drop-glow" : "glass text-ink-mute",
      )}
    >
      {armed ? <Flame className="size-6" /> : <Trash2 className="size-6" />}
      <span className="mt-1 text-[10px] font-bold uppercase tracking-wider">
        {armed ? "Release" : "Purge"}
      </span>
    </motion.div>
  );
}
