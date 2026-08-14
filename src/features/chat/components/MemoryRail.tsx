import { MemoryCard } from "./MemoryCard";
import { useMemoryStore } from "@/features/memory/store/memoryStore";

export function MemoryRail() {
  const memories = useMemoryStore((s) =>
    s.nodes.filter((n) => n.kind === "core" && (n.verified || (n.confidence ?? n.weight) >= 0.6)),
  );
  const hidden = useMemoryStore((s) => {
    const core = s.nodes.filter((n) => n.kind === "core");
    const shown = core.filter((n) => n.verified || (n.confidence ?? n.weight) >= 0.6);
    return core.length - shown.length;
  });

  return (
    <section className="shrink-0" aria-label="Core memories">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="font-display text-xs font-bold uppercase tracking-[0.16em] text-ink-mute">
          Vault · drag into stream
        </h2>
        <span className="text-[11px] text-ink-mute">
          {memories.length} pinned{hidden > 0 ? ` · ${hidden} unverified hidden` : ""}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin">
        {memories.map((memory) => (
          <MemoryCard key={memory.id} memory={memory} />
        ))}
        {memories.length === 0 && (
          <p className="px-1 py-3 text-xs text-ink-mute">Vault empty — purged memories stay gone.</p>
        )}
      </div>
    </section>
  );
}
