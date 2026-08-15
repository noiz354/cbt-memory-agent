import { useMemoryStore } from "@/features/memory/store/memoryStore";
import { toast } from "@/shared/store/toastStore";
import { useEffect, useRef, useState } from "react";

interface AddMemoryModalProps {
  onClose: () => void;
}

export function AddMemoryModal({ onClose }: AddMemoryModalProps) {
  const addNode = useMemoryStore((s) => s.addNode);
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const id = addNode({ title, excerpt });
    if (id) {
      toast("Memory added", "Node created in the spatial vault.", "success");
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add memory"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-[var(--shadow-float)]">
        <h2 className="font-display text-lg font-bold">Add memory</h2>
        <p className="mt-1 text-sm text-ink-mute">
          A new core node appears in the graph and syncs to CockroachDB.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-mute">Title</span>
            <input
              ref={inputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="e.g. Reappraisal that landed"
              className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-teal"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-mute">Excerpt</span>
            <textarea
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              rows={3}
              placeholder="What to remember…"
              className="mt-1 w-full resize-none rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-teal"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-ink-mute hover:bg-canvas"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim()}
            className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Add memory
          </button>
        </div>
      </div>
    </div>
  );
}
