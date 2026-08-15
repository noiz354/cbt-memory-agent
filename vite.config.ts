import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Backend upstream untuk dev proxy — sama seperti BACKEND_URL di Docker/nginx.
  // Contoh: https://xxxxxx.lambda-url.ap-southeast-3.on.aws
  const backendUrl = (env.VITE_PROXY_TARGET ?? env.BACKEND_URL ?? "").replace(/\/$/, "");

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      allowedHosts: true,
      proxy: backendUrl
        ? {
            "/api/v1": {
              target: backendUrl,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    preview: {
      host: "0.0.0.0",
      port: 5173,
      allowedHosts: true,
      proxy: backendUrl
        ? {
            "/api/v1": {
              target: backendUrl,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    worker: {
      format: "es",
    },
  };
});
