import { CrisisHaltBridge } from "@/features/crisis/components/CrisisHaltBridge";
import { CrisisFusionBridge } from "@/features/crisis/components/CrisisFusionBridge";
import { CrisisOverlay } from "@/features/crisis/components/CrisisOverlay";
import { MobileDock } from "@/app/layout/MobileDock";
import { Sidebar } from "@/app/layout/Sidebar";
import { CommandPalette } from "@/shared/ui/CommandPalette";
import { OfflineBanner } from "@/shared/ui/OfflineBanner";
import { TabSync } from "@/shared/ui/TabSync";
import { ToastHost } from "@/shared/ui/ToastHost";
import { Outlet, useLocation } from "react-router-dom";
import { useBackendSync } from "@/shared/hooks/useBackendSync";
import { track, TELEMETRY_EVENTS } from "@/shared/lib/telemetryEvents";
import { useEffect } from "react";

export function AppShell() {
  useBackendSync();
  const { pathname } = useLocation();

  useEffect(() => {
    track(TELEMETRY_EVENTS.appLaunch);
  }, []);

  useEffect(() => {
    track(TELEMETRY_EVENTS.pageView, { path: pathname });
  }, [pathname]);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-canvas">
      <Sidebar />
      <main className="relative min-w-0 flex-1 safe-dock lg:pb-0">
        <Outlet />
      </main>
      <MobileDock />
      <CrisisHaltBridge />
      <CrisisFusionBridge />
      <CrisisOverlay />
      <CommandPalette />
      <ToastHost />
      <OfflineBanner />
      <TabSync />
    </div>
  );
}
