import { nodeConfidence } from "@/features/memory/types";
import { useMemoryStore } from "@/features/memory/store/memoryStore";
import { useAuditStore } from "@/shared/store/auditStore";
import { formatDay } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Link2Off, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";

export function NodeInspector() {
  const selectedId = useMemoryStore((s) => s.selectedId);
  const nodes = useMemoryStore((s) => s.nodes);
  const edges = useMemoryStore((s) => s.edges);
  const select = useMemoryStore((s) => s.select);
  const unlink = useMemoryStore((s) => s.unlink);
  const startPurge = useMemoryStore((s) => s.startPurge);
  const finishPurge = useMemoryStore((s) => s.finishPurge);
  const verify = useMemoryStore((s) => s.verify);
  const updateNode = useMemoryStore((s) => s.updateNode);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftExcerpt, setDraftExcerpt] = useState("");

  const node = nodes.find((n) => n.id === selectedId) ?? null;
  const related = edges.filter((e) => e.source === selectedId || e.target === selectedId);

  return (
    <AnimatePresence>
      {node && (
        <motion.aside
          data-no-pan
          initial={{ x: 28, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 28, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="pointer-events-auto absolute bottom-5 right-[120px] top-20 z-20 hidden w-[300px] flex-col overflow-hidden rounded-[1.4rem] bg-white shadow-[var(--shadow-float)] ring-1 ring-line md:flex"
        >
          <header className="flex items-start justify-between gap-2 px-4 pt-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">
                {node.kind === "core" ? "Core memory" : "Transcript chunk"}
              </p>
              <h2 className="mt-1 font-display text-base font-bold leading-snug">{node.title}</h2>
            </div>
            <button type="button" aria-label="Close inspector" onClick={() => select(null)}>
              <X className="size-4 text-ink-mute" />
            </button>
          </header>
          <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-4 py-3">
            {editing ? (
              <div className="space-y-2">
                <input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="h-9 w-full rounded-lg border border-line px-2 text-sm"
                />
                <textarea
                  value={draftExcerpt}
                  onChange={(e) => setDraftExcerpt(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-line px-2 py-1 text-sm"
                />
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    updateNode(node.id, { title: draftTitle, excerpt: draftExcerpt });
                    setEditing(false);
                  }}
                >
                  Save correction
                </Button>
              </div>
            ) : (
              <p className="text-sm leading-6 text-ink-mute">{node.excerpt}</p>
            )}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">
                Confidence {Math.round(nodeConfidence(node) * 100)}%
                {node.verified ? " · verified" : " · unverified"}
                {typeof node.references === "number" ? ` · recalled ${node.references}×` : ""}
              </p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas">
                <div
                  className={nodeConfidence(node) < 0.6 ? "h-full bg-amber-500" : "h-full bg-teal"}
                  style={{ width: `${nodeConfidence(node) * 100}%` }}
                />
              </div>
              {nodeConfidence(node) < 0.6 && !node.verified && (
                <p className="mt-1 text-[11px] text-amber-700">
                  Below 0.6 — will not auto-inject into chat until you verify.
                </p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">Weight</p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas">
                <div className="h-full bg-teal" style={{ width: `${node.weight * 100}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-ink-mute">
                {node.weight < 0.45 ? "Decaying — visually shrinking on the canvas." : "Stable trace."}{" "}
                Touched {formatDay(node.lastTouched)}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {node.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-ink-mute">
                  {tag}
                </span>
              ))}
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">Custom links</p>
              <ul className="mt-2 space-y-1.5">
                {related.map((edge) => {
                  const otherId = edge.source === node.id ? edge.target : edge.source;
                  const other = nodes.find((n) => n.id === otherId);
                  return (
                    <li key={edge.id} className="flex items-center justify-between gap-2 rounded-xl bg-canvas px-2.5 py-2">
                      <span className="truncate text-xs font-medium">
                        {edge.label} · {other?.title ?? otherId}
                      </span>
                      <button type="button" aria-label="Remove link" onClick={() => unlink(edge.id)}>
                        <Link2Off className="size-3.5 text-ink-mute" />
                      </button>
                    </li>
                  );
                })}
                {related.length === 0 && (
                  <li className="text-xs text-ink-mute">Drag this node onto another to draw a link.</li>
                )}
              </ul>
            </div>
          </div>
          <footer className="space-y-2 p-3">
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setDraftTitle(node.title);
                setDraftExcerpt(node.excerpt);
                setEditing(true);
              }}
            >
              <Pencil className="size-4" />
              Edit memory text
            </Button>
            {!node.verified && (
              <Button
                variant="soft"
                className="w-full"
                onClick={() => {
                  verify(node.id);
                  useAuditStore.getState().log("MEMORY_VERIFIED", node.title);
                }}
              >
                <Check className="size-4" />
                Confirm this memory
              </Button>
            )}
            <Button
              variant="danger"
              className="w-full"
              onClick={() => {
                useAuditStore.getState().log("MEMORY_PURGED", node.title);
                startPurge(node.id);
                window.setTimeout(() => finishPurge(node.id), 720);
              }}
            >
              <Trash2 className="size-4" />
              Burn from vault
            </Button>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
