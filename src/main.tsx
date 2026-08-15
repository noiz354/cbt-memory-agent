import { App } from "@/app/App";
import { Providers } from "@/app/providers";
import { applyTheme, useThemeStore } from "@/shared/store/themeStore";
import "@/shared/styles/index.css";
import { initTelemetry } from "@/shared/lib/telemetry";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

initTelemetry();
applyTheme(useThemeStore.getState().mode);

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root is missing");

createRoot(root).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
