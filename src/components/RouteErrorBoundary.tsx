// @ts-nocheck
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Label shown in error UI for the failing section */
  sectionName?: string;
  /** Optional fallback component override */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Granular error boundary for route groups.
 * Unlike the global ErrorBoundary, this allows recovery without
 * a full page reload — users can navigate back or retry.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[RouteErrorBoundary:${this.props.sectionName || 'unknown'}]`, error, errorInfo);
  }

  private isAuthError(): boolean {
    const msg = this.state.error?.message || '';
    const patterns = ['JWT expired', 'jwt expired', 'not authenticated', 'Auth session missing', 'session_not_found', 'Invalid Refresh Token'];
    return patterns.some(p => msg.toLowerCase().includes(p.toLowerCase()));
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
