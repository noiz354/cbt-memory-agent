import { AlignmentGuides } from "@/features/memory/components/AlignmentGuides";
import { AddMemoryModal } from "@/features/memory/components/AddMemoryModal";
import { GraphEdges } from "@/features/memory/components/GraphEdges";
import { GraphNodeCard } from "@/features/memory/components/GraphNodeCard";
import { GraphToolbar } from "@/features/memory/components/GraphToolbar";
import { NodeInspector } from "@/features/memory/components/NodeInspector";
import { PurgeZone } from "@/features/memory/components/PurgeZone";
import { boundsOf, nodeCenter, snapWithGuides } from "@/features/memory/lib/geometry";
import { useMemoryStore } from "@/features/memory/store/memoryStore";
import type { AlignmentGuide, GraphNode } from "@/features/memory/types";
import { useSpatialCanvas } from "@/shared/hooks/useSpatialCanvas";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface DragSession {
  id: string;
  pointerId: number;
  startClient: { x: number; y: number };
  origin: { x: number; y: number };
}

export function GraphCanvas() {
  const nodes = useMemoryStore((s) => s.nodes);
  const edges = useMemoryStore((s) => s.edges);
  const selectedId = useMemoryStore((s) => s.selectedId);
  const burningIds = useMemoryStore((s) => s.burningIds);
  const moveNode = useMemoryStore((s) => s.moveNode);
  const linkNodes = useMemoryStore((s) => s.linkNodes);
  const touch = useMemoryStore((s) => s.touch);
  const select = useMemoryStore((s) => s.select);
  const startPurge = useMemoryStore((s) => s.startPurge);
  const finishPurge = useMemoryStore((s) => s.finishPurge);

  const { viewportRef, transform, onPointerDown, onPointerMove, onPointerUp, zoomBy, fit, reset } =
    useSpatialCanvas({ x: 36, y: 64, scale: 1 });

  const drag = useRef<DragSession | null>(null);
  const [guides, setGuides] = useState<AlignmentGuide>({ vertical: null, horizontal: null });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [purgeArmed, setPurgeArmed] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || nodes.length === 0) return;
    fitted.current = true;
    const timer = window.setTimeout(() => fit(boundsOf(nodes)), 40);
    return () => window.clearTimeout(timer);
  }, [fit, nodes]);

  const announce = (message: string) => {
    setBanner(message);
    window.setTimeout(() => setBanner(null), 2200);
  };

  const hitNode = (clientX: number, clientY: number, except?: string) => {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const el of stack) {
      const host = (el as HTMLElement).closest?.("[data-graph-node]");
      const id = host?.getAttribute("data-graph-node");
      if (id && id !== except) return id;
    }
    return null;
  };

  const overPurge = (clientX: number, clientY: number) => {
    const zone = viewportRef.current?.querySelector("[data-purge-zone]");
    if (!zone) return false;
    const rect = zone.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  };

  const onNodePointerDown = useCallback(
    (node: GraphNode) => (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      drag.current = {
        id: node.id,
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        origin: { x: node.x, y: node.y },
      };
      setDraggingId(node.id);
      touch(node.id);
    },
    [touch],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const session = drag.current;
      if (!session || session.pointerId !== event.pointerId) return;
      event.preventDefault();
      const dx = (event.clientX - session.startClient.x) / transform.scale;
      const dy = (event.clientY - session.startClient.y) / transform.scale;
      const snapped = snapWithGuides(
        { x: session.origin.x + dx, y: session.origin.y + dy },
        session.id,
        useMemoryStore.getState().nodes,
      );
      moveNode(session.id, snapped.x, snapped.y);
      setGuides(snapped.guides);
      setHoverId(hitNode(event.clientX, event.clientY, session.id));
      setPurgeArmed(overPurge(event.clientX, event.clientY));
    };

    const onUp = (event: PointerEvent) => {
      const session = drag.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const targetId = hitNode(event.clientX, event.clientY, session.id);
      const burn = overPurge(event.clientX, event.clientY);
      drag.current = null;
      setGuides({ vertical: null, horizontal: null });
      setHoverId(null);
      setPurgeArmed(false);

      if (burn) {
        startPurge(session.id);
        window.setTimeout(() => finishPurge(session.id), 720);
        announce("Memory burned locally — removed from the vault.");
        return;
      }
      if (targetId) {
        const created = linkNodes(session.id, targetId);
        announce(created ? "Custom link drawn." : "Those nodes are already linked.");
      }
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [finishPurge, linkNodes, moveNode, startPurge, transform.scale]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") select(null);
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        const tag = (event.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        event.preventDefault();
        startPurge(selectedId);
        window.setTimeout(() => finishPurge(selectedId), 720);
        announce("Memory burned locally — removed from the vault.");
      }
      if (event.key === "=" || event.key === "+") zoomBy(1.08);
      if (event.key === "-" || event.key === "_") zoomBy(0.92);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishPurge, select, selectedId, startPurge, zoomBy]);

  const preview = useMemo(() => {
    if (!drag.current || !hoverId) return null;
    const from = nodes.find((n) => n.id === drag.current?.id);
    const to = nodes.find((n) => n.id === hoverId);
    if (!from || !to) return null;
    return { from: nodeCenter(from), to: nodeCenter(to) };
  }, [hoverId, nodes]);

  return (
    <div
      ref={viewportRef}
      className="relative h-full touch-none overflow-hidden spatial-grid"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="absolute left-0 top-0 will-change-transform"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <div className="relative h-[1200px] w-[1600px]">
          <GraphEdges nodes={nodes} edges={edges} highlight={preview} />
          <AlignmentGuides guides={guides} />
          {nodes.map((node) => (
            <GraphNodeCard
              key={node.id}
              node={node}
              selected={selectedId === node.id}
              linking={hoverId === node.id}
              burning={burningIds.includes(node.id)}
              dragging={draggingId === node.id}
              onPointerDown={onNodePointerDown(node)}
            />
          ))}
        </div>
      </div>

      <GraphToolbar
        scale={transform.scale}
        nodeCount={nodes.length}
        edgeCount={edges.length}
        onZoomIn={() => zoomBy(1.1)}
        onZoomOut={() => zoomBy(0.9)}
        onFit={() => fit(boundsOf(nodes))}
        onReset={reset}
        onAddNode={() => setAddOpen(true)}
      />

      <div className="pointer-events-none absolute bottom-5 left-4 z-20 max-w-xs text-[11px] leading-5 text-ink-mute">
        Drag a node to move · drop onto another to link · drop on Purge to burn.
        Pinch or scroll to zoom. Low-weight nodes shrink as they decay.
      </div>

      {banner && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white shadow-[var(--shadow-float)]">
          {banner}
        </div>
      )}

      <PurgeZone armed={purgeArmed} />
      <NodeInspector />
      {addOpen && <AddMemoryModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}
