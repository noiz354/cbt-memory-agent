import { cn } from "@/shared/lib/cn";
import type { HTMLAttributes } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "teal" | "ink" | "success" | "danger";
}

export function Badge({ className, tone = "ink", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase",
        tone === "teal" && "bg-teal-mist text-teal",
        tone === "ink" && "bg-ink/8 text-ink-mute",
        tone === "success" && "bg-success-mist text-success",
        tone === "danger" && "bg-danger-mist text-danger",
        className,
      )}
      {...props}
    />
  );
}
