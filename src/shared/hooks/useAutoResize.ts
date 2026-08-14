import { useCallback, useLayoutEffect, type RefObject } from "react";

interface AutoResizeOptions {
  minRows?: number;
  maxHeight?: number;
}

export function useAutoResize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  { minRows = 1, maxHeight = 220 }: AutoResizeOptions = {},
) {
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
    const min = line * minRows + 16;
    const next = Math.min(Math.max(el.scrollHeight, min), maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxHeight, minRows, ref]);

  useLayoutEffect(() => {
    resize();
  }, [resize, value]);

  return resize;
}
