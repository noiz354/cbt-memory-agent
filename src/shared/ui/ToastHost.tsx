import { useToastStore } from "@/shared/store/toastStore";
import { cn } from "@/shared/lib/cn";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100000] flex w-[min(100%-2rem,22rem)] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className={cn(
              "pointer-events-auto rounded-2xl px-3 py-2.5 text-sm shadow-[var(--shadow-float)]",
              item.tone === "danger" && "bg-danger text-white",
              item.tone === "success" && "bg-success text-white",
              item.tone === "teal" && "bg-teal text-white",
              item.tone === "ink" && "bg-ink text-white",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-display font-semibold">{item.title}</p>
                {item.detail && <p className="mt-0.5 text-xs opacity-80">{item.detail}</p>}
              </div>
              <button type="button" aria-label="Dismiss" onClick={() => dismiss(item.id)}>
                <X className="size-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
