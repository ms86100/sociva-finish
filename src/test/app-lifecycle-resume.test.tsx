import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAppLifecycle } from '@/hooks/useAppLifecycle';

describe('useAppLifecycle background/resume revalidation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('mounts without throwing and registers event listeners', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { unmount } = renderHook(() => useAppLifecycle(), { wrapper });
    expect(unmount).toBeDefined();
    unmount();
  });

  it('triggers query invalidation and profile refresh event on visibilitychange', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries');
    const refreshProfileListener = vi.fn();
    const resumeListener = vi.fn();

    window.addEventListener('app:refresh-profile', refreshProfileListener);
    window.addEventListener('app:resume-refresh', resumeListener);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    renderHook(() => useAppLifecycle(), { wrapper });

    // Mock document visibilityState to 'visible'
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });

    // Fire visibilitychange event
    document.dispatchEvent(new Event('visibilitychange'));

    // Wait a tick for async execution
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(invalidateSpy).toHaveBeenCalled();
    expect(refetchSpy).toHaveBeenCalled();
    expect(refreshProfileListener).toHaveBeenCalled();
    expect(resumeListener).toHaveBeenCalled();

    window.removeEventListener('app:refresh-profile', refreshProfileListener);
    window.removeEventListener('app:resume-refresh', resumeListener);
  });

  it('throttles rapid sequential resume events within 1.5 seconds', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    renderHook(() => useAppLifecycle(), { wrapper });

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });

    // Fire first event
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const firstCallCount = invalidateSpy.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    // Fire second event immediately (focus)
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Should be throttled, so call count remains identical
    expect(invalidateSpy.mock.calls.length).toBe(firstCallCount);
  });
});
