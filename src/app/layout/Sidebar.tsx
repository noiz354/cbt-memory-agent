import { APP_NAV } from "@/app/layout/nav";
import { useAuthStore } from "@/features/auth/store/authStore";
import { useAppStore } from "@/shared/store/appStore";
import { cn } from "@/shared/lib/cn";
import { broadcastSignOut } from "@/shared/ui/TabSync";
import { NavLink, useNavigate } from "react-router-dom";
import { ChevronLeft, HeartPulse, LogOut } from "lucide-react";

export function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const triggerCrisis = useAppStore((s) => s.triggerCrisis);
  const distressHint = useAppStore((s) => s.distressHint);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const navigate = useNavigate();

  return (
    <aside
      className={cn(
        "hidden h-full shrink-0 flex-col bg-ink text-white lg:flex",
        collapsed ? "w-[84px]" : "w-[272px]",
      )}
    >
      <div className={cn("flex items-center gap-3 px-4 pt-6", collapsed && "justify-center px-2")}>
        <div className="flex size-10 items-center justify-center rounded-2xl bg-teal">
          <span className="font-display text-lg font-extrabold">C</span>
        </div>
        {!collapsed && (
          <div>
            <p className="font-display text-sm font-bold leading-tight">CBT Memory</p>
            <p className="text-[11px] text-white/50">Clinical agent</p>
          </div>
        )}
      </div>

      <nav className="mt-8 flex flex-1 flex-col gap-1 px-3">
        {APP_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors",
                  isActive ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/6 hover:text-white",
                  collapsed && "justify-center px-0",
                )
              }
            >
              <Icon className="size-5 shrink-0" />
              {!collapsed && (
                <span className="min-w-0">
                  <span className="block font-display font-semibold">{item.label}</span>
                  <span className="block text-[11px] text-white/60">{item.hint}</span>
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="space-y-2 p-3">
        {!collapsed && profile && (
          <div className="rounded-2xl bg-white/6 px-3 py-2.5">
            <p className="truncate font-display text-sm font-semibold">{profile.displayName}</p>
            <p className="truncate text-[11px] text-white/60">{profile.email}</p>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-teal-soft">
              {profile.goals.length} vault goals · {profile.authMethod}
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            broadcastSignOut();
            signOut();
            navigate("/auth");
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm text-white/50 hover:bg-white/6 hover:text-white",
            collapsed && "justify-center",
          )}
        >
          <LogOut className="size-4 shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
        <button
          type="button"
          onClick={() => triggerCrisis("Manual clinician override from sidebar.")}
          className={cn(
            "flex w-full items-center gap-2 rounded-2xl bg-danger/15 px-3 py-2.5 text-left text-sm text-red-200 hover:bg-danger/25",
            distressHint && "ring-2 ring-danger",
            collapsed && "justify-center",
          )}
        >
          <HeartPulse className="size-4 shrink-0" />
          {!collapsed && <span className="font-semibold">Crisis protocol</span>}
        </button>
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-2 text-white/40 hover:bg-white/6 hover:text-white"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>
    </aside>
  );
}
