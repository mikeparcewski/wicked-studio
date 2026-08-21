import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Custom fallback — defaults to the built-in reload screen. */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          className="flex flex-col items-center justify-center h-full gap-4 p-8 font-mono"
          style={{ color: 'var(--ink-muted)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--status-fail)' }}>
            Something went wrong
          </p>
          <p
            className="text-xs text-center max-w-sm"
            style={{ color: 'var(--ink-dim)' }}
          >
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-xs px-4 py-1.5 rounded-lg transition-opacity hover:opacity-80"
            style={{ background: 'var(--surface-raised)', color: 'var(--ink-high)' }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
