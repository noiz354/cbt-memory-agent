import { useCallback, useEffect, useRef, useState } from "react";

interface Point {
  x: number;
  y: number;
}

export interface SpatialState {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.45;
const MAX_SCALE = 2.6;

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function zoomToward(current: SpatialState, nextScale: number, origin: Point): SpatialState {
  const scale = clampScale(nextScale);
  const ratio = scale / current.scale;
  return {
    scale,
    x: origin.x - (origin.x - current.x) * ratio,
    y: origin.y - (origin.y - current.y) * ratio,
  };
}

export function useSpatialCanvas(initial: SpatialState = { x: 48, y: 72, scale: 1 }) {
  const [transform, setTransform] = useState<SpatialState>(initial);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef<Map<number, Point>>(new Map());
  const lastPinch = useRef<number | null>(null);
  const panning = useRef(false);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const origin = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = event.deltaY > 0 ? 0.94 : 1.06;
      setTransform((t) => zoomToward(t, t.scale * factor, origin));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-no-pan]")) return;
    panning.current = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const pts = pointers.current;
    if (!pts.has(event.pointerId)) return;
    const prev = pts.get(event.pointerId)!;
    pts.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const el = viewportRef.current;
      if (el && lastPinch.current != null) {
        const rect = el.getBoundingClientRect();
        const origin = {
          x: (a.x + b.x) / 2 - rect.left,
          y: (a.y + b.y) / 2 - rect.top,
        };
        const delta = dist / lastPinch.current;
        setTransform((t) => zoomToward(t, t.scale * delta, origin));
      }
      lastPinch.current = dist;
      return;
    }

    if (panning.current && pts.size === 1 && event.buttons === 1) {
      const dx = event.clientX - prev.x;
      const dy = event.clientY - prev.y;
      setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
    }
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) lastPinch.current = null;
    if (pointers.current.size === 0) panning.current = false;
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const el = viewportRef.current;
    const origin = el
      ? { x: el.clientWidth / 2, y: el.clientHeight / 2 }
      : { x: 400, y: 300 };
    setTransform((t) => zoomToward(t, t.scale * factor, origin));
  }, []);

  const fit = useCallback((box: { minX: number; minY: number; maxX: number; maxY: number }) => {
    const el = viewportRef.current;
    if (!el) return;
    const pad = 80;
    const w = box.maxX - box.minX || 400;
    const h = box.maxY - box.minY || 300;
    const scale = clampScale(Math.min((el.clientWidth - pad * 2) / w, (el.clientHeight - pad * 2) / h));
    setTransform({
      scale,
      x: (el.clientWidth - w * scale) / 2 - box.minX * scale,
      y: (el.clientHeight - h * scale) / 2 - box.minY * scale,
    });
  }, []);

  const reset = useCallback(() => setTransform(initial), [initial]);

  return {
    viewportRef,
    transform,
    setTransform,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    zoomBy,
    fit,
    reset,
  };
}
