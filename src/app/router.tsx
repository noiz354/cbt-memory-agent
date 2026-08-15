import { AppShell } from "@/app/layout/AppShell";
import { SessionGate } from "@/app/layout/SessionGate";
import { AuthCallbackPage } from "@/features/auth/pages/AuthCallbackPage";
import { AuthPage } from "@/features/auth/pages/AuthPage";
import { OnboardingPage } from "@/features/auth/pages/OnboardingPage";
import { ChatPage } from "@/features/chat/pages/ChatPage";
import { MemoryPage } from "@/features/memory/pages/MemoryPage";
import { MetricsPage } from "@/features/metrics/pages/MetricsPage";
import { PrivacyPage } from "@/features/privacy/pages/PrivacyPage";
import { SessionDetailPage } from "@/features/sessions/pages/SessionDetailPage";
import { SessionsPage } from "@/features/sessions/pages/SessionsPage";
import { createBrowserRouter, Navigate } from "react-router-dom";

export const router = createBrowserRouter([
  { path: "/auth", element: <AuthPage /> },
  { path: "/auth/callback", element: <AuthCallbackPage /> },
  { path: "/onboarding", element: <OnboardingPage /> },
  {
    path: "/",
    element: (
      <SessionGate>
        <AppShell />
      </SessionGate>
    ),
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: "chat", element: <ChatPage /> },
      { path: "sessions", element: <SessionsPage /> },
      { path: "sessions/:sessionId", element: <SessionDetailPage /> },
      { path: "memory", element: <MemoryPage /> },
      { path: "memory/:memoryId", element: <MemoryPage /> },
      { path: "metrics", element: <MetricsPage /> },
      { path: "settings/privacy", element: <PrivacyPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
