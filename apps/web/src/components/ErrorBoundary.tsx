import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../services/errorReporter.ts';

interface State {
  failed: boolean;
}

/** Last line of defence: a crash in the UI shows a recoverable screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(
      'react',
      Object.assign(error, { stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}` }),
    );
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="panel" role="alert">
        <p className="eyebrow">SOMETHING WENT WRONG</p>
        <h2>The game hit an error</h2>
        <p className="note">The problem was reported automatically. Reloading usually fixes it.</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
