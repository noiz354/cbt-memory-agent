// @vitest-environment jsdom
// Setup untuk test UI (React 19 + jsdom).
// Test UI memakai react-dom/client createRoot langsung (lihat ChatBubble.test.tsx)
// karena react 19.2.8 + @testing-library/react 16.3.2 punya konflik React.act.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
