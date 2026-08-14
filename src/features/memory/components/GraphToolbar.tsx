import { IconButton } from "@/shared/ui/IconButton";
import { Badge } from "@/shared/ui/Badge";
import { Focus, Minus, Plus, RotateCcw } from "lucide-react";

interface GraphToolbarProps {
  scale: number;
  nodeCount: number;
  edgeCount: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onReset: () => void;
}

export function GraphToolbar({
  scale,
  nodeCount,
  edgeCount,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
}: GraphToolbarProps) {
  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-20 flex flex-wrap items-center gap-2">
      <div className="glass flex items-center rounded-2xl p-1 shadow-[var(--shadow-glass)]">
        <IconButton label="Zoom out" onClick={onZoomOut}>
          <Minus className="size-4" />
        </IconButton>
        <span className="min-w-12 text-center text-xs font-semibold tabular-nums text-ink-mute">
          {Math.round(scale * 100)}%
        </span>
        <IconButton label="Zoom in" onClick={onZoomIn}>
          <Plus className="size-4" />
        </IconButton>
        <IconButton label="Fit graph" onClick={onFit}>
          <Focus className="size-4" />
        </IconButton>
        <IconButton label="Reset view" onClick={onReset}>
          <RotateCcw className="size-4" />
        </IconButton>
      </div>
      <Badge tone="teal">{nodeCount} nodes</Badge>
      <Badge>{edgeCount} links</Badge>
    </div>
  );
}
