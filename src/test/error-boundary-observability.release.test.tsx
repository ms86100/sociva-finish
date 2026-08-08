import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { captureException } = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/observability', () => ({ captureException }));

import { ErrorBoundary } from '@/components/ErrorBoundary';

function ControlledFailure(): never {
  throw new Error('controlled release validation error');
}

describe('release observability boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    captureException.mockReset();
  });

  it('captures a controlled render failure with component context', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ControlledFailure />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'controlled release validation error',
      }),
      expect.objectContaining({
        boundary: 'root',
        componentStack: expect.any(String),
      }),
    );
  });
});
