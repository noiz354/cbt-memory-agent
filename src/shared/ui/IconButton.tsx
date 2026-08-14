import { cn } from "@/shared/lib/cn";
import type { ButtonHTMLAttributes } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: "default" | "teal" | "danger";
}

export function IconButton({
  label,
  className,
  tone = "default",
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-xl transition-colors",
        tone === "default" && "text-ink-mute hover:bg-ink/6 hover:text-ink",
        tone === "teal" && "text-teal hover:bg-teal-mist",
        tone === "danger" && "text-danger hover:bg-danger-mist",
        className,
      )}
      {...props}
    />
  );
}
