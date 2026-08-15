import { GraphCanvas } from "@/features/memory/components/GraphCanvas";
import { useMemoryStore } from "@/features/memory/store/memoryStore";
import { BackendSyncStatus } from "@/shared/ui/BackendSyncStatus";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export function MemoryPage() {
  const nodes = useMemoryStore((s) => s.nodes);
  const select = useMemoryStore((s) => s.select);
  const hydrate = useMemoryStore((s) => s.hydrate);
  const hydrated = useMemoryStore((s) => s.hydrated);
  const hydrating = useMemoryStore((s) => s.hydrating);
  const hydrateError = useMemoryStore((s) => s.hydrateError);
  const cores = nodes.filter((n) => n.kind === "core").length;
  const chunks = nodes.filter((n) => n.kind === "transcript").length;
  const [query, setQuery] = useState("");
  const { memoryId } = useParams();

  useEffect(() => {
    if (memoryId) select(memoryId);
  }, [memoryId, select]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3 px-4 py-3 md:px-5">
        <div>
          <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
            Vault
          </p>
          <h1 className="font-display text-xl font-bold md:text-2xl">Spatial memory graph</h1>
          <BackendSyncStatus
            className="mt-2 max-w-md"
            hydrating={hydrating}
            hydrateError={hydrateError}
            empty={false}
            emptyTitle=""
            emptyHint=""
            onRetry={() => void hydrate()}
          />
        </div>
        <div className="flex items-center gap-3">
          <input
            value={query}
            onChange={(e) => {
              const value = e.target.value;
              setQuery(value);
              const hit = nodes.find((n) =>
                `${n.title} ${n.excerpt} ${n.tags.join(" ")}`.toLowerCase().includes(value.toLowerCase()),
              );
              if (value && hit) select(hit.id);
            }}
            placeholder="Search vault…"
            className="h-9 w-48 rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-teal"
          />
          <p className="text-xs text-ink-mute">
            {cores} core · {chunks} transcript · on-device
          </p>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        {hydrated && nodes.length === 0 ? (
          <BackendSyncStatus
            className="absolute inset-0 m-auto h-fit max-w-sm"
            hydrating={false}
            hydrateError={null}
            empty
            emptyTitle="No memories yet"
            emptyHint="Your vault is empty. Memories you create during therapy sessions will appear here as graph nodes — synced to CockroachDB."
            onRetry={() => void hydrate()}
          />
        ) : (
          <GraphCanvas />
        )}
      </div>
    </div>
  );
}
