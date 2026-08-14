import { useAutoResize } from "@/shared/hooks/useAutoResize";
import { cn } from "@/shared/lib/cn";
import { useRef, type KeyboardEvent, type TextareaHTMLAttributes } from "react";

interface AutoExpandTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit?: () => void;
}

export function AutoExpandTextarea({
  value,
  onValueChange,
  onSubmit,
  className,
  maxLength = 8000,
  ...props
}: AutoExpandTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoResize(ref, value, { minRows: 1, maxHeight: 220 });

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    props.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!props.disabled) onSubmit?.();
    }
  };

  return (
    <textarea
      {...props}
      ref={ref}
      value={value}
      maxLength={maxLength}
      rows={1}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={onKeyDown}
      className={cn(
        "block w-full resize-none bg-transparent text-[15px] leading-6 text-ink placeholder:text-ink-mute/70",
        "border-0 p-0 focus:outline-none focus-visible:outline-none",
        className,
      )}
    />
  );
}
