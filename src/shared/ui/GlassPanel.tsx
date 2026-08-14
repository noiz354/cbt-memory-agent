import { cn } from "@/shared/lib/cn";
import type { HTMLAttributes } from "react";

export function GlassPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass rounded-[var(--radius-card)] shadow-[var(--shadow-glass)]", className)} {...props} />;
}
