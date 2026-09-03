import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import { captureException } from '@/lib/observability';

interface Props {
  children: ReactNode;
  /** Label shown in error UI for the failing section */
  sectionName?: string;
  /** Optional fallback component override */
  fallback?: ReactNode;
  /** When this changes, a previously caught error is discarded. */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Granular error boundary for route groups.
 * Unlike the global ErrorBoundary, this allows recovery without
 * a full page reload — users can navigate back or retry.
 *
 * AppShell renders sibling routes through a single <Outlet />, so React
 * reuses this component instance across Home ↔ Orders. Without a pathname
 * remount / reset, a crash on Orders would keep showing an error after
 * navigating to Home ("Error loading Home").
 */
class RouteErrorBoundaryInner extends Component<Props, State> {
  public state: State = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[RouteErrorBoundary:${this.props.sectionName || 'unknown'}]`, error, errorInfo);
    captureException(error, {
      boundary: 'route',
      sectionName: this.props.sectionName || 'unknown',
      componentStack: errorInfo.componentStack,
    });
  }

  public componentDidUpdate(prevProps: Props) {
    if (
      this.state.hasError &&
      (this.props.resetKey !== prevProps.resetKey || this.props.sectionName !== prevProps.sectionName)
    ) {
      this.setState({ hasError: false, error: null });
    }
  }

  private isAuthError(): boolean {
    const msg = this.state.error?.message || '';
    const patterns = ['JWT expired', 'jwt expired', 'not authenticated', 'Auth session missing', 'session_not_found', 'Invalid Refresh Token'];
    return patterns.some((p) => msg.toLowerCase().includes(p.toLowerCase()));
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleGoBack = () => {
    window.history.back();
  };

  private handleLogin = () => {
    window.location.hash = '#/auth';
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const isAuth = this.isAuthError();

      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center p-6">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertTriangle className="text-destructive" size={32} />
          </div>

          <h2 className="text-lg font-semibold text-center mb-1">
            {isAuth
              ? 'Session Expired'
              : this.props.sectionName
              ? `Error loading ${this.props.sectionName}`
              : 'Something went wrong'}
          </h2>

          <p className="text-sm text-muted-foreground text-center mb-6 max-w-xs">
            {isAuth
              ? 'Your session has expired. Please log in again to continue.'
              : 'This section encountered an error. You can try again or go back.'}
          </p>

          <div className="flex gap-3">
            {isAuth ? (
              <Button size="sm" onClick={this.handleLogin}>
                Log In Again
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={this.handleGoBack}>
                  <ArrowLeft size={14} className="mr-1.5" />
                  Go Back
                </Button>
                <Button size="sm" onClick={this.handleRetry}>
                  <RefreshCw size={14} className="mr-1.5" />
                  Retry
                </Button>
              </>
            )}
          </div>

          {import.meta.env.DEV && this.state.error && (
            <details className="mt-6 p-3 bg-muted rounded-lg max-w-md w-full">
              <summary className="cursor-pointer text-xs font-medium">
                Error Details (Dev)
              </summary>
              <pre className="mt-2 text-xs text-destructive overflow-auto whitespace-pre-wrap">
                {this.state.error.toString()}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export function RouteErrorBoundary({ sectionName, children, fallback }: Props) {
  const location = useLocation();
  return (
    <RouteErrorBoundaryInner
      key={location.pathname}
      resetKey={location.pathname}
      sectionName={sectionName}
      fallback={fallback}
    >
      {children}
    </RouteErrorBoundaryInner>
  );
}
