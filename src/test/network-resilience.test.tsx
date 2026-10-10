import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query';
import { createClient } from '@supabase/supabase-js';
import { createReadTimeoutFetch, isRequestTimeoutError } from '@/lib/network-timeout';
import { resolveMarketplaceStatus } from '@/lib/marketplace-status';
import { LoadFailureState } from '@/components/network/LoadFailureState';

type Mode = 'ok' | 'stall' | 'slow' | 'down';

/** Fake network under the real supabase-js client + timeout wrapper. */
function makeNetwork(initial: Mode, timeoutMs = 40) {
  let mode: Mode = initial;
  const calls: string[] = [];
  const base = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    const signal = init?.signal;
    const ok = () => new Response(JSON.stringify([{ id: 'o1', status: 'placed' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    return new Promise<Response>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      if (mode === 'ok') resolve(ok());
      else if (mode === 'slow') setTimeout(() => resolve(ok()), 60);
      else if (mode === 'down') reject(new TypeError('Failed to fetch'));
      // 'stall' never settles unless aborted
    });
  });
  const client = createClient('https://project.supabase.co', 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `net-${Math.random()}` },
    global: { fetch: createReadTimeoutFetch(timeoutMs, () => base as unknown as typeof fetch) },
  });
  return { client, base, calls, setMode: (m: Mode) => { mode = m; } };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // Same read policy as App.tsx: one retry, mutations never.
      queries: { retry: (failureCount) => failureCount < 1, retryDelay: 0, networkMode: 'online' },
      mutations: { retry: 0, networkMode: 'online' },
    },
  });
}

function useOrders(client: ReturnType<typeof makeNetwork>['client']) {
  return useQuery({
    queryKey: ['orders-resilience'],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.from('orders').select('id,status').abortSignal(signal);
      if (error) throw error;
      return data;
    },
  });
}

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  act(() => onlineManager.setOnline(true));
});

describe('weak-network behaviour (simulated network, real supabase-js + React Query)', () => {
  it('stalled request ends in an error after a bounded wait instead of loading forever', async () => {
    const net = makeNetwork('stall');
    const qc = makeQueryClient();
    const { result } = renderHook(() => useOrders(net.client), { wrapper: wrapperFor(qc) });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 2_000 });
    expect(isRequestTimeoutError(result.current.error)).toBe(true);
    // first attempt + exactly one React Query retry; postgrest did not multiply it
    expect(net.base).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBeUndefined();
  });

  it('Retry after a stall recovers once the network answers', async () => {
    const net = makeNetwork('stall');
    const qc = makeQueryClient();
    const { result } = renderHook(() => useOrders(net.client), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 2_000 });

    net.setMode('ok');
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 2_000 });
    expect(result.current.data).toEqual([{ id: 'o1', status: 'placed' }]);
  });

  it('slow but working connection is not cut off inside the budget', async () => {
    const net = makeNetwork('slow', 1_000);
    const qc = makeQueryClient();
    const { result } = renderHook(() => useOrders(net.client), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 2_000 });
    expect(result.current.data).toHaveLength(1);
    expect(net.base).toHaveBeenCalledTimes(1);
  });

  it('disconnected: query pauses (offline state, not empty) and resumes on reconnection', async () => {
    const net = makeNetwork('ok');
    const qc = makeQueryClient();
    act(() => onlineManager.setOnline(false));
    const { result } = renderHook(() => useOrders(net.client), { wrapper: wrapperFor(qc) });

    await waitFor(() => expect(result.current.fetchStatus).toBe('paused'));
    expect(result.current.isLoading).toBe(false);
    expect(net.base).not.toHaveBeenCalled();
    expect(resolveMarketplaceStatus({
      hasContent: false,
      isLoading: result.current.isLoading,
      hasLocation: true,
      locationPending: false,
      isPaused: result.current.fetchStatus === 'paused',
      isError: result.current.isError,
    })).toBe('offline');

    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('background refresh failure keeps the last loaded data on screen', async () => {
    const net = makeNetwork('ok');
    const qc = makeQueryClient();
    const { result } = renderHook(() => useOrders(net.client), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    net.setMode('stall');
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 2_000 });
    expect(result.current.data).toEqual([{ id: 'o1', status: 'placed' }]);
    expect(resolveMarketplaceStatus({
      hasContent: (result.current.data?.length ?? 0) > 0,
      isLoading: false,
      hasLocation: true,
      locationPending: false,
      isPaused: false,
      isError: true,
    })).toBe('content');
  });

  it('writes are never timed out or retried on a stalled network', async () => {
    const net = makeNetwork('stall');
    const update = net.client.from('orders').update({ status: 'accepted' }).eq('id', 'o1');
    const outcome = await Promise.race([
      Promise.resolve(update).then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 150)),
    ]);
    expect(outcome).toBe('pending');
    expect(net.base).toHaveBeenCalledTimes(1);
  });
});

describe('LoadFailureState', () => {
  it('renders an error with a working Retry', () => {
    const onRetry = vi.fn();
    render(<LoadFailureState variant="error" title="Couldn't load orders" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load orders");
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables Retry while a retry is running', () => {
    render(<LoadFailureState variant="offline" onRetry={() => undefined} retrying />);
    expect(screen.getByRole('button', { name: /retrying/i })).toBeDisabled();
    expect(screen.getByTestId('load-failure-offline')).toBeInTheDocument();
  });

  it('slow variant is a status, not an alert', () => {
    render(<LoadFailureState variant="slow" onRetry={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent('Taking longer than usual');
  });
});
