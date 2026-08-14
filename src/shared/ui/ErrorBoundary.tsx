import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("CBT workspace crash", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
        <p className="font-display text-xs font-bold uppercase tracking-[0.18em] text-danger">
          Isolated fault
        </p>
        <h1 className="font-display text-2xl font-bold">Workspace hit an unhandled error</h1>
        <p className="max-w-md text-sm text-ink-mute">{this.state.error.message}</p>
        <button
          type="button"
          className="mt-2 h-11 rounded-xl bg-ink px-4 text-sm font-semibold text-white"
          onClick={() => {
            this.setState({ error: null });
            window.location.assign("/chat");
          }}
        >
          Reload workspace
        </button>
      </div>
    );
  }
}
