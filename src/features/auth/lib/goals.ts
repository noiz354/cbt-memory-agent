import type { GoalDefinition } from "@/features/auth/types";

export const THERAPY_GOALS: GoalDefinition[] = [
  {
    id: "anxiety",
    label: "Anxiety",
    headline: "Threat-scan loops",
    detail: "Body alarm, chest tightness, and future-forecasting that outruns the evidence.",
  },
  {
    id: "rumination",
    label: "Rumination",
    headline: "Mental replay",
    detail: "Re-running conversations and meetings as if a better cut will finally land.",
  },
  {
    id: "sleep",
    label: "Sleep",
    headline: "Bedtime cognition",
    detail: "Long sleep-onset, 2 a.m. loops, and the bed becoming a thinking desk.",
  },
  {
    id: "self-compassion",
    label: "Self-compassion",
    headline: "Harsh inner critic",
    detail: "Standards that would never be applied to a friend in the same situation.",
  },
  {
    id: "exposure",
    label: "Exposure",
    headline: "Avoidance & approach",
    detail: "Shrinking life to stay safe. Graded contact with the thing being postponed.",
  },
  {
    id: "relapse-prevention",
    label: "Relapse prevention",
    headline: "Keeping gains",
    detail: "Early-warning signs, if-then plans, and a map back when the old pattern returns.",
  },
];

export function goalById(id: string) {
  return THERAPY_GOALS.find((goal) => goal.id === id);
}
