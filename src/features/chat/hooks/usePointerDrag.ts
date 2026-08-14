import { useMemo, useRef, useState } from "react";

interface PointerDragOptions {
  onMove?: (dx: number) => void;
  onScrub?: (ratio: number) => void;
}

export function usePointerDrag({ onMove, onScrub }: PointerDragOptions) {
  const origin = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);

  const bind = useMemo(
    () => ({
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        origin.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        if (origin.current == null) return;
        const dx = event.clientX - origin.current;
        setOffset(dx);
        onMove?.(dx);
        const rect = event.currentTarget.getBoundingClientRect();
        onScrub?.((event.clientX - rect.left) / rect.width);
      },
      onPointerUp: () => {
        origin.current = null;
        setOffset(0);
      },
    }),
    [onMove, onScrub],
  );

  return { bind, offset };
}
