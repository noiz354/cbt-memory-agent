import type { OnboardingStep } from "@/features/auth/types";
import { cn } from "@/shared/lib/cn";

const STEPS: { id: OnboardingStep; label: string }[] = [
  { id: "disclosure", label: "Scope" },
  { id: "consent", label: "Consent" },
  { id: "goals", label: "Vault" },
  { id: "emergency", label: "Contact" },
];

export function OnboardingStepper({ current }: { current: OnboardingStep }) {
  const index = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="mb-8 flex items-center gap-2">
      {STEPS.map((step, i) => (
        <li key={step.id} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-full font-display text-xs font-bold",
              i < index && "bg-success text-white",
              i === index && "bg-ink text-white",
              i > index && "bg-ink/10 text-ink-mute",
            )}
          >
            {i + 1}
          </span>
          <span className={cn("hidden text-xs font-semibold sm:inline", i === index ? "text-ink" : "text-ink-mute")}>
            {step.label}
          </span>
          {i < STEPS.length - 1 && (
            <span className={cn("h-px flex-1", i < index ? "bg-success" : "bg-line")} />
          )}
        </li>
      ))}
    </ol>
  );
}
