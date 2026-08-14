import { router } from "@/app/router";
import { ErrorBoundary } from "@/shared/ui/ErrorBoundary";
import { RouterProvider } from "react-router-dom";

export function App() {
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}
