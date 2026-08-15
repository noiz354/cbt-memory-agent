import { GraphCanvas } from "@/features/memory/components/GraphCanvas";
import { useMemoryStore } from "@/features/memory/store/memoryStore";
import { apiClient, type SemanticSearchResult } from "@/shared/lib/apiClient";
import { getAuthHeaders } from "@/shared/lib/authSession";
import { track, TELEMETRY_EVENTS } from "@/shared/lib/telemetryEvents";
import { BackendSyncStatus } from "@/shared/ui/BackendSyncStatus";
import { Search, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  const [results, setResults] = useState<SemanticSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<number | null>(null);
  const { memoryId } = useParams();

  useEffect(() => {
    if (memoryId) select(memoryId);
  }, [memoryId, select]);

  // Semantic search (backend embeddings) with debounce + local substring fallback.
  const runSearch = (value: string) => {
    if (!value.trim()) {
      setResults([]);
      return;
    }
    track(TELEMETRY_EVENTS.memorySearched);
    const auth = getAuthHeaders();
    setSearching(true);
    apiClient
      .searchMemory(value, auth?.token ?? "", auth?.deviceId ?? "")
      .then((res) => {
        setResults(Array.isArray(res.results) ? res.results : []);
      })
      .catch(() => {
        setResults([]);
      })
      .finally(() => setSearching(false));
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => runSearch(value), 400);
    const hit = nodes.find((n) =>
      `${n.title} ${n.excerpt} ${n.tags.join(" ")}`.toLowerCase().includes(value.toLowerCase()),
    );
    if (value && hit) select(hit.id);
  };

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
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-ink-mute" />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search vault…"
              aria-label="Search memories (local substring + semantic embeddings)"
              className="h-9 w-56 rounded-xl border border-line bg-white pl-8 pr-3 text-sm outline-none focus:border-teal"
            />
          </div>
          <p className="text-xs text-ink-mute">
            {cores} core · {chunks} transcript · on-device
          </p>
        </div>
      </header>
      {query.trim() && (
        <div className="shrink-0 border-b border-line bg-white/60 px-4 py-2 md:px-5">
          {searching ? (
            <p className="text-xs text-ink-mute">Searching semantically…</p>
          ) : results.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {results.map((r) => (
                <button
                  key={r.node.id}
                  type="button"
                  onClick={() => select(r.node.id)}
                  className="inline-flex max-w-xs items-center gap-1.5 rounded-full bg-teal-mist px-2.5 py-1 text-left text-[11px] font-semibold text-teal hover:bg-teal/15"
                >
                  <Sparkles className="size-3 shrink-0" />
                  <span className="truncate">{r.node.title}</span>
                  <span className="shrink-0 text-ink-mute">{Math.round(r.score * 100)}%</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-mute">
              No semantic matches — embeddings may be empty server-side. Use the local substring search or add memories.
            </p>
          )}
        </div>
      )}
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
