import React, { Component, type ReactNode } from 'react';

interface Props {
  name: string;
  children: ReactNode;
  fallback?: ReactNode;
  /** When this changes after a crash, the section is allowed to render again. */
  resetKey?: string;
}

interface State {
  hasError: boolean;
}

export class SafeSectionWrapper extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[SafeSection][${this.props.name}] Crashed:`, error.message);
  }

  componentDidUpdate(prevProps: Props) {
    if (
      this.state.hasError &&
      (this.props.resetKey !== prevProps.resetKey || this.props.name !== prevProps.name)
    ) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
