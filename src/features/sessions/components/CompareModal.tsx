import { useSessionStore } from "@/features/sessions/store/sessionStore";
import { formatDay } from "@/shared/lib/format";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

export function CompareModal() {
  const compare = useSessionStore((s) => s.compare);
  const sessions = useSessionStore((s) => s.sessions);
  const closeCompare = useSessionStore((s) => s.closeCompare);

  const pair = compare
    ? (compare.map((id) => sessions.find((s) => s.id === id)).filter(Boolean) as typeof sessions)
    : [];

  return (
    <AnimatePresence>
      {pair.length === 2 && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={closeCompare}
        >
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="w-full max-w-3xl rounded-[1.4rem] bg-white p-5 shadow-[var(--shadow-float)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Drag-to-compare</h2>
              <button type="button" aria-label="Close compare" onClick={closeCompare}>
                <X className="size-4 text-ink-mute" />
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {pair.map((session) => (
                <article key={session.id} className="rounded-2xl bg-canvas p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-teal">{session.status}</p>
                  <h3 className="mt-1 font-display text-base font-bold">{session.title}</h3>
                  <p className="mt-1 text-xs text-ink-mute">
                    {formatDay(session.startedAt)} · mood {session.mood}/10 · {session.moodLabel}
                  </p>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-mute">Thought</p>
                  <p className="text-sm leading-6 text-ink">{session.thought}</p>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-mute">Reframe</p>
                  <p className="text-sm leading-6 text-ink">{session.reframe ?? "Still open — not yet extracted."}</p>
                </article>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
