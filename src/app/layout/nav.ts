import {
  MessageSquareText,
  History,
  Network,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export const APP_NAV: NavItem[] = [
  { to: "/chat", label: "Workspace", hint: "Live CBT stream", icon: MessageSquareText },
  { to: "/sessions", label: "Sessions", hint: "History & mood", icon: History },
  { to: "/memory", label: "Memory", hint: "Spatial vault", icon: Network },
  { to: "/settings/privacy", label: "Privacy", hint: "Data hub", icon: ShieldCheck },
];
