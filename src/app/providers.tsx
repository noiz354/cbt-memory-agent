import type { ReactNode } from "react";

interface ProvidersProps {
  children: ReactNode;
}

/** Composition root for future query / i18n / consent providers. */
export function Providers({ children }: ProvidersProps) {
  return children;
}
