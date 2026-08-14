import { CrisisHaltBridge } from "@/features/crisis/components/CrisisHaltBridge";
import { CrisisOverlay } from "@/features/crisis/components/CrisisOverlay";
import { MobileDock } from "@/app/layout/MobileDock";
import { Sidebar } from "@/app/layout/Sidebar";
import { CommandPalette } from "@/shared/ui/CommandPalette";
import { OfflineBanner } from "@/shared/ui/OfflineBanner";
import { TabSync } from "@/shared/ui/TabSync";
import { ToastHost } from "@/shared/ui/ToastHost";
import { Outlet } from "react-router-dom";

export function AppShell() {
  return (
    <div className="flex h-[100dvh] overflow-hidden bg-canvas">
      <Sidebar />
      <main className="relative min-w-0 flex-1 safe-dock lg:pb-0">
        <Outlet />
      </main>
      <MobileDock />
      <CrisisHaltBridge />
      <CrisisOverlay />
      <CommandPalette />
      <ToastHost />
      <OfflineBanner />
      <TabSync />
    </div>
  );
}
