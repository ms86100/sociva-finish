// @ts-nocheck
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Copy } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).toUpperCase().slice(0, 8);
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  constructor(props: Props) {
    super(props);
    // Signal EARLY that React has begun processing — before any child
    // render errors can fire. This prevents the 10-second safety net
    // in main.tsx from showing the raw HTML fallback while ErrorBoundary
    // is handling the error with its own UI.
    document.getElementById('root')?.setAttribute('data-app-mounted', 'true');
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReload = () => {
    // Only clear auth tokens after repeated crashes (3+), not on first reload
    const fails = Number(sessionStorage.getItem('boot-fails') || '0');
    if (fails >= 3) {
      // Clear whatever Supabase auth token this project uses — the key is
      // derived from the project ref, so never hardcode a single ref here.
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
          .forEach((k) => localStorage.removeItem(k));
      } catch {}
    }
    window.location.reload();
  };


  private handleGoHome = () => {
    // Reset error state first so the app can re-render normally
    this.setState({ hasError: false, error: null });
    window.location.hash = '#/';
    // If state reset alone doesn't recover, force reload after a tick
    setTimeout(() => window.location.reload(), 150);
  };

  private handleCopyError = () => {
    if (this.state.error) {
      const details = `${this.state.error.toString()}\n\n${this.state.error.stack || ''}`;
      navigator.clipboard?.writeText(details).then(() => {
        // Brief visual feedback
        const btn = document.getElementById('copy-error-btn');
        if (btn) btn.textContent = 'Copied!';
        setTimeout(() => { if (btn) btn.textContent = 'Copy Error Details'; }, 2000);
      });
    }
  };

  // data-app-mounted is now set in the constructor (earlier signal)

  public render() {
    if (this.state.hasError) {
      const errorCode = this.state.error ? hashCode(this.state.error.message) : '00000000';

      return (
        <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 bg-background">
          <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
            <AlertTriangle className="text-destructive" size={40} />
          </div>
          
          <h1 className="text-xl font-bold text-center mb-2">
            Something went wrong
          </h1>
          
          <p className="text-muted-foreground text-center mb-2 max-w-sm">
            We're sorry, but something unexpected happened. Please try again.
          </p>

          <p className="text-xs text-muted-foreground/60 mb-6 font-mono">
            Error code: {errorCode}
          </p>
          
          <div className="flex gap-3 mb-4">
            <Button variant="outline" onClick={this.handleGoHome}>
              Go Home
            </Button>
            <Button onClick={this.handleReload}>
              <RefreshCw size={16} className="mr-2" />
              Reload App
            </Button>
          </div>

          <Button
            id="copy-error-btn"
            variant="ghost"
            size="sm"
            onClick={this.handleCopyError}
            className="text-xs text-muted-foreground"
          >
            <Copy size={12} className="mr-1" />
            Copy Error Details
          </Button>
          
          {import.meta.env.DEV && this.state.error && (
            <details className="mt-8 p-4 bg-muted rounded-lg max-w-lg w-full">
              <summary className="cursor-pointer text-sm font-medium">
                Error Details (Development Only)
              </summary>
              <pre className="mt-2 text-xs text-destructive overflow-auto">
                {this.state.error.toString()}
                {'\n\n'}
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
