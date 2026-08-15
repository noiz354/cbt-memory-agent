import { buildExportBundle, downloadJson, uploadExportBundle } from "@/features/privacy/lib/exportBundle";
import { usePrivacyStore } from "@/features/privacy/store/privacyStore";
import type { ExportKind } from "@/features/privacy/types";
import { cn } from "@/shared/lib/cn";
import { DROP_ZONES, springDropAnimation } from "@/shared/lib/dnd";
import { toast } from "@/shared/store/toastStore";
import { Button } from "@/shared/ui/Button";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Brain, CloudUpload, Download, Loader2, MessageSquare, Smile, X } from "lucide-react";
import { useState } from "react";

const CHIPS: { id: ExportKind; label: string; icon: typeof Brain }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "mood", label: "Mood", icon: Smile },
  { id: "memory", label: "Memory", icon: Brain },
];

function Chip({ id, label, icon: Icon, parked }: { id: ExportKind; label: string; icon: typeof Brain; parked: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `export:${id}`,
    data: { type: "export-chip", kind: id },
    disabled: parked,
  });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      disabled={parked}
      className={cn(
        "inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold ring-1",
        parked ? "bg-canvas text-ink-mute ring-line" : "bg-white text-ink ring-line",
        isDragging && "opacity-40",
      )}
      {...listeners}
      {...attributes}
    >
      <Icon className="size-4 text-teal" />
      {label}
    </button>
  );
}

export function ExportBuilder() {
  const crate = usePrivacyStore((s) => s.crate);
  const addToCrate = usePrivacyStore((s) => s.addToCrate);
  const removeFromCrate = usePrivacyStore((s) => s.removeFromCrate);
  const clearCrate = usePrivacyStore((s) => s.clearCrate);
  const [active, setActive] = useState<ExportKind | null>(null);
  const [uploading, setUploading] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const { setNodeRef, isOver } = useDroppable({ id: DROP_ZONES.EXPORT });

  const onDragEnd = (event: DragEndEvent) => {
    const kind = event.active.data.current?.kind as ExportKind | undefined;
    setActive(null);
    if (kind && event.over?.id === DROP_ZONES.EXPORT) addToCrate(kind);
  };

  const mint = () => {
    if (crate.length === 0) return;
    const bundle = buildExportBundle(crate);
    downloadJson(bundle, `cbt-export-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const upload = async () => {
    if (crate.length === 0) return;
    setUploading(true);
    try {
      const url = await uploadExportBundle(crate);
      if (url) {
        toast("Export uploaded", "Your bundle is in S3. Use the download link below.", "success");
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        toast("Export upload failed", "Server export unavailable — local JSON still works.", "danger");
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setActive((e.active.data.current?.kind as ExportKind) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <Chip key={chip.id} {...chip} parked={crate.includes(chip.id)} />
        ))}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "mt-4 min-h-[140px] rounded-[1.4rem] border-2 border-dashed p-4",
          isOver ? "border-teal bg-teal-mist/40 drop-glow" : "border-line bg-canvas/60",
        )}
      >
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-mute">Export crate</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {crate.map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-line">
              {kind}
              <button type="button" aria-label={`Remove ${kind}`} onClick={() => removeFromCrate(kind)}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          {crate.length === 0 && <p className="text-sm text-ink-mute">Drag Chat, Mood, or Memory here.</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={mint} disabled={crate.length === 0}>
          <Download className="size-4" />
          Mint local JSON
        </Button>
        <Button variant="soft" onClick={upload} disabled={crate.length === 0 || uploading}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
          {uploading ? "Uploading…" : "Upload to S3"}
        </Button>
        {crate.length > 0 && (
          <Button variant="ghost" onClick={clearCrate}>
            Clear
          </Button>
        )}
      </div>
      <DragOverlay dropAnimation={springDropAnimation}>
        {active ? (
          <div className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold shadow-[var(--shadow-float)] ring-2 ring-teal">
            {active}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
