import { App } from "@/app/App";
import { Providers } from "@/app/providers";
import { applyTheme, useThemeStore } from "@/shared/store/themeStore";
import "@/shared/styles/index.css";
import { initTelemetry } from "@/shared/lib/telemetry";
import { setUnauthorizedHandler } from "@/shared/lib/apiClient";
import { useAuthStore } from "@/features/auth/store/authStore";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

initTelemetry();
applyTheme(useThemeStore.getState().mode);

// Any 401 from the backend means the session token is no longer accepted
// (revoked/expired). Sign out locally; SessionGate redirects to /auth.
setUnauthorizedHandler(() => {
  const status = useAuthStore.getState().status;
  if (status !== "anonymous") useAuthStore.getState().signOut();
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root is missing");

createRoot(root).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
