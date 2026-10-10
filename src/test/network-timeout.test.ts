import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  combineSignals,
  createReadTimeoutFetch,
  createRequestTimeoutError,
  isRequestTimeoutError,
  isTransientNetworkError,
  shouldApplyReadTimeout,
  READ_ONLY_RPCS,
} from '@/lib/network-timeout';

const BASE = 'https://project.supabase.co';

/** Base fetch that never settles on its own but rejects when its signal aborts (like real fetch). */
function stalledFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'content-range': '0-0/1' },
  });
}

async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<'pending' | 'settled'> {
  return Promise.race([
    promise.then(() => 'settled' as const, () => 'settled' as const),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), ms)),
  ]);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('shouldApplyReadTimeout', () => {
  it('bounds PostgREST reads', () => {
    expect(shouldApplyReadTimeout(`${BASE}/rest/v1/orders?select=*`, { method: 'GET' })).toBe(true);
    expect(shouldApplyReadTimeout(`${BASE}/rest/v1/orders?select=*`, { method: 'HEAD' })).toBe(true);
    expect(shouldApplyReadTimeout(`${BASE}/rest/v1/orders?select=*`)).toBe(true);
  });

  it('bounds only allow-listed STABLE RPCs', () => {
    for (const rpc of READ_ONLY_RPCS) {
      expect(shouldApplyReadTimeout(`${BASE}/rest/v1/rpc/${rpc}`, { method: 'POST' })).toBe(true);
    }
    expect(shouldApplyReadTimeout(`${BASE}/rest/v1/rpc/create_multi_vendor_orders`, { method: 'POST' })).toBe(false);
    expect(shouldApplyReadTimeout(`${BASE}/rest/v1/rpc/verify_delivery_otp_and_complete`, { method: 'POST' })).toBe(false);
  });

  it('never bounds writes, auth, storage or edge functions', () => {
    expect(shouldApplyReadTimeout(`${BASE}/rest/v1/orders`, { method: 'POST' })).toBe(false);
    expect(shouldApplyReadTimeout(`${BASE}/rest/v1/orders?id=eq.1`, { method: 'PATCH' })).toBe(false);
    expect(shouldApplyReadTimeout(`${BASE}/rest/v1/orders?id=eq.1`, { method: 'DELETE' })).toBe(false);
    expect(shouldApplyReadTimeout(`${BASE}/rest/v1/orders`, { method: 'PUT' })).toBe(false);
    expect(shouldApplyReadTimeout(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' })).toBe(false);
    expect(shouldApplyReadTimeout(`${BASE}/auth/v1/user`, { method: 'GET' })).toBe(false);
    expect(shouldApplyReadTimeout(`${BASE}/storage/v1/object/products/a.jpg`, { method: 'POST' })).toBe(false);
    expect(shouldApplyReadTimeout(`${BASE}/storage/v1/object/public/products/a.jpg`, { method: 'GET' })).toBe(false);
    expect(shouldApplyReadTimeout(`${BASE}/functions/v1/create-razorpay-order`, { method: 'POST' })).toBe(false);
  });

  it('reads the method from a Request object', () => {
    expect(shouldApplyReadTimeout(new Request(`${BASE}/rest/v1/orders`, { method: 'PATCH' }))).toBe(false);
    expect(shouldApplyReadTimeout(new Request(`${BASE}/rest/v1/orders`))).toBe(true);
  });
});

describe('createReadTimeoutFetch', () => {
  it('passes writes through untouched with the caller signal and no timeout', async () => {
    const base = stalledFetch();
    const wrapped = createReadTimeoutFetch(20, () => base);
    const caller = new AbortController();
    const init: RequestInit = { method: 'PATCH', body: '{}', signal: caller.signal };

    const pending = wrapped(`${BASE}/rest/v1/orders?id=eq.1`, init);
    expect(base).toHaveBeenCalledTimes(1);
    expect(base.mock.calls[0][1]).toBe(init);
    expect(await settleWithin(pending, 80)).toBe('pending');

    caller.abort();
    await expect(pending).rejects.toBeDefined();
  });

  it('aborts a stalled read with a timeout error', async () => {
    const base = stalledFetch();
    const wrapped = createReadTimeoutFetch(20, () => base);
    const error = await wrapped(`${BASE}/rest/v1/orders?select=*`, { method: 'GET' }).catch((e) => e);
    expect(isRequestTimeoutError(error)).toBe(true);
    expect(error.name).toBe('AbortError');
  });

  it('keeps caller cancellation: aborting rejects with the caller reason, not a timeout', async () => {
    const base = stalledFetch();
    const wrapped = createReadTimeoutFetch(1_000, () => base);
    const caller = new AbortController();
    const reason = new DOMException('cancelled by caller', 'AbortError');
    const pending = wrapped(`${BASE}/rest/v1/orders?select=*`, { method: 'GET', signal: caller.signal });
    caller.abort(reason);
    const error = await pending.catch((e) => e);
    expect(error).toBe(reason);
    expect(isRequestTimeoutError(error)).toBe(false);
  });

  it('passes an already-aborted caller signal straight through', async () => {
    const base = stalledFetch();
    const wrapped = createReadTimeoutFetch(1_000, () => base);
    const caller = new AbortController();
    caller.abort();
    const init: RequestInit = { method: 'GET', signal: caller.signal };
    await expect(wrapped(`${BASE}/rest/v1/orders`, init)).rejects.toBeDefined();
    expect(base.mock.calls[0][1]).toBe(init);
  });

  it('buffers the body and preserves status and headers', async () => {
    const base = vi.fn(async () => jsonResponse([{ id: 'o1' }], 206));
    const wrapped = createReadTimeoutFetch(1_000, () => base);
    const res = await wrapped(`${BASE}/rest/v1/orders?select=*`, { method: 'GET' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('0-0/1');
    expect(await res.json()).toEqual([{ id: 'o1' }]);
  });

  it('handles null-body responses', async () => {
    const base = vi.fn(async () => new Response(null, { status: 204 }));
    const wrapped = createReadTimeoutFetch(1_000, () => base);
    const res = await wrapped(`${BASE}/rest/v1/orders?select=*`, { method: 'HEAD' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('covers a stall while the body is downloading', async () => {
    const base = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: {},
      arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      }),
    }) as unknown as Response);
    const wrapped = createReadTimeoutFetch(20, () => base);
    const error = await wrapped(`${BASE}/rest/v1/orders?select=*`, { method: 'GET' }).catch((e) => e);
    expect(isRequestTimeoutError(error)).toBe(true);
  });

  it('clears its timer and caller listener after success', async () => {
    const base = vi.fn(async () => jsonResponse([]));
    const wrapped = createReadTimeoutFetch(1_000, () => base);
    const caller = new AbortController();
    const removeSpy = vi.spyOn(caller.signal, 'removeEventListener');
    await wrapped(`${BASE}/rest/v1/orders`, { method: 'GET', signal: caller.signal });
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('supabase-js with the timeout fetch', () => {
  function makeClient(base: ReturnType<typeof vi.fn>, timeoutMs = 30) {
    return createClient(BASE, 'anon-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: createReadTimeoutFetch(timeoutMs, () => base as unknown as typeof fetch) },
    });
  }

  it('returns a timeout error for a stalled select without postgrest re-sending it', async () => {
    const base = stalledFetch();
    const client = makeClient(base);
    const { data, error } = await client.from('orders').select('id');
    expect(data).toBeNull();
    expect(isRequestTimeoutError(error)).toBe(true);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('keeps .abortSignal() cancellation working', async () => {
    const base = stalledFetch();
    const client = makeClient(base, 5_000);
    const caller = new AbortController();
    const pending = client.from('orders').select('id').abortSignal(caller.signal);
    setTimeout(() => caller.abort(), 10);
    const { error } = await pending;
    expect(error?.message).toMatch(/AbortError/);
    expect(isRequestTimeoutError(error)).toBe(false);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('does not time out inserts, updates or write RPCs', async () => {
    const base = stalledFetch();
    const client = makeClient(base, 20);
    const insert = client.from('orders').insert({ id: 'x' });
    const update = client.from('orders').update({ status: 'accepted' }).eq('id', 'x');
    const rpc = client.rpc('create_multi_vendor_orders', {});
    expect(await settleWithin(Promise.resolve(insert), 80)).toBe('pending');
    expect(await settleWithin(Promise.resolve(update), 10)).toBe('pending');
    expect(await settleWithin(Promise.resolve(rpc), 10)).toBe('pending');
  });

  it('sends the auth headers on bounded reads', async () => {
    const base = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse([]));
    const client = makeClient(base, 1_000);
    await client.from('orders').select('id');
    const init = base.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('apikey')).toBe('anon-key');
    expect(headers.get('authorization')).toBe('Bearer anon-key');
  });
});

describe('error classification and retry policy', () => {
  it('recognises timeouts from the wrapper and from postgrest error objects', () => {
    expect(isRequestTimeoutError(createRequestTimeoutError(15_000))).toBe(true);
    expect(isRequestTimeoutError({ message: 'AbortError: Request timed out after 15000ms' })).toBe(true);
    expect(isRequestTimeoutError({ message: 'AbortError: The user aborted a request.' })).toBe(false);
  });

  it('recognises transport failures', () => {
    expect(isTransientNetworkError({ message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isTransientNetworkError(new TypeError('Load failed'))).toBe(true);
    expect(isTransientNetworkError({ message: 'permission denied for table orders' })).toBe(false);
  });

});

describe('combineSignals', () => {
  it('aborts when any input aborts and keeps the reason', () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineSignals(a.signal, undefined, b.signal);
    expect(combined.aborted).toBe(false);
    b.abort('stop');
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('stop');
  });

  it('starts aborted when an input is already aborted', () => {
    const a = new AbortController();
    a.abort('done');
    expect(combineSignals(a.signal).aborted).toBe(true);
  });
});
