import { APP_NAV } from "@/app/layout/nav";
import { useAppStore } from "@/shared/store/appStore";
import { cn } from "@/shared/lib/cn";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const triggerCrisis = useAppStore((s) => s.triggerCrisis);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
        setQuery("");
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo<Command[]>(
    () => [
      ...APP_NAV.map((item) => ({
        id: item.to,
        label: `Go to ${item.label}`,
        hint: item.hint,
        run: () => navigate(item.to),
      })),
      {
        id: "crisis",
        label: "Open crisis protocol",
        hint: "Hard halt · 988 / 119",
        run: () => triggerCrisis("Manual override from command palette."),
      },
    ],
    [navigate, triggerCrisis],
  );

  const filtered = commands.filter((c) =>
    `${c.label} ${c.hint}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/40 p-4 pt-[12vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-float)]"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Jump, search, or run… Cmd/Ctrl+K"
              className="h-12 w-full border-b border-line px-4 text-sm outline-none"
            />
            <ul className="max-h-72 overflow-auto p-1">
              {filtered.map((cmd, i) => (
                <li key={cmd.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-canvas",
                      i === 0 && "bg-canvas",
                    )}
                    onClick={() => {
                      cmd.run();
                      setOpen(false);
                    }}
                  >
                    <span className="font-medium">{cmd.label}</span>
                    <span className="text-[11px] text-ink-mute">{cmd.hint}</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3 py-4 text-sm text-ink-mute">No matching action.</li>
              )}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
