/**
 * Bounded waiting for Supabase reads.
 *
 * A stalled TCP connection on a weak mobile network never resolves or rejects,
 * which left screens (seller order detail, seller dashboard, home marketplace)
 * on a skeleton forever. This wrapper aborts confirmed read-only PostgREST
 * requests after a fixed budget so React Query can surface an error + Retry.
 *
 * Writes are never timed out: an aborted POST/PATCH/DELETE may still commit on
 * the server, and retrying it could duplicate orders, payments or stock moves.
 */

export const READ_TIMEOUT_MS = 15_000;

/**
 * POST /rest/v1/rpc/* calls that are safe to abort. Every entry is declared
 * STABLE in Postgres, which forbids data modification inside the function.
 */
export const READ_ONLY_RPCS: ReadonlySet<string> = new Set([
  'search_sellers_paginated',
  'get_products_for_sellers',
  'get_user_auth_context',
  'get_app_bootstrap',
  'get_seller_dashboard_kpis',
  'get_seller_order_board_counts',
  'get_seller_portfolio_kpis',
  'get_seller_portfolio_board_counts',
]);

const TIMEOUT_MESSAGE_PREFIX = 'Request timed out after';
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isRequestObject(input: unknown): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return isRequestObject(input) ? input.url : String(input);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (isRequestObject(input) ? input.method : 'GET');
  return (method || 'GET').toUpperCase();
}

/** True only for PostgREST reads: GET/HEAD, or POST to an allow-listed STABLE RPC. */
export function shouldApplyReadTimeout(input: RequestInfo | URL, init?: RequestInit): boolean {
  let path: string;
  try {
    path = new URL(requestUrl(input), 'http://localhost').pathname;
  } catch {
    return false;
  }
  if (!path.startsWith('/rest/v1/')) return false;

  const method = requestMethod(input, init);
  if (method === 'GET' || method === 'HEAD') return true;
  if (method !== 'POST') return false;

  const match = path.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
  if (!match) return false;
  try {
    return READ_ONLY_RPCS.has(decodeURIComponent(match[1]));
  } catch {
    return false;
  }
}

/**
 * Named AbortError on purpose: postgrest-js re-sends GETs that fail with other
 * error names (up to 3 extra attempts), which would multiply the wait. React
 * Query owns the retry decision instead.
 */
export function createRequestTimeoutError(timeoutMs: number): Error {
  const error = new Error(`${TIMEOUT_MESSAGE_PREFIX} ${timeoutMs}ms`);
  error.name = 'AbortError';
  (error as Error & { isRequestTimeout?: boolean }).isRequestTimeout = true;
  return error;
}

function errorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

export function isRequestTimeoutError(error: unknown): boolean {
  if (!error) return false;
  if ((error as { isRequestTimeout?: boolean }).isRequestTimeout) return true;
  return errorMessage(error).includes(TIMEOUT_MESSAGE_PREFIX);
}

const NETWORK_ERROR_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_network|err_internet_disconnected|err_connection|the network connection was lost|internet connection appears to be offline/i;

/** Timeouts and transport failures - safe to retry for reads, worth a "check your connection" message. */
export function isTransientNetworkError(error: unknown): boolean {
  if (isRequestTimeoutError(error)) return true;
  return NETWORK_ERROR_PATTERN.test(errorMessage(error));
}

/**
 * Wrap a fetch implementation so allow-listed reads are aborted after
 * `timeoutMs`. The caller's own AbortSignal keeps working: aborting it cancels
 * the request with the caller's reason, exactly as without the wrapper. The
 * response body is buffered inside the budget so a stall mid-body is covered.
 */
export function createReadTimeoutFetch(
  timeoutMs: number = READ_TIMEOUT_MS,
  getBaseFetch: () => FetchFn = () => globalThis.fetch.bind(globalThis),
): FetchFn {
  return async (input, init) => {
    const baseFetch = getBaseFetch();
    if (!shouldApplyReadTimeout(input, init)) return baseFetch(input, init);

    const callerSignal = init?.signal ?? (isRequestObject(input) ? input.signal : undefined);
    if (callerSignal?.aborted) return baseFetch(input, init);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(createRequestTimeoutError(timeoutMs));
    }, timeoutMs);
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    try {
      const response = await baseFetch(input, { ...init, signal: controller.signal });
      const hasBody = response.body !== null && !NULL_BODY_STATUSES.has(response.status);
      const body = hasBody ? await response.arrayBuffer() : null;
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (timedOut && !callerSignal?.aborted) throw createRequestTimeoutError(timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  };
}

/** AbortSignal that fires after `ms` - AbortSignal.timeout is missing on older WebViews. */
export function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(createRequestTimeoutError(ms)), ms);
  return controller.signal;
}

/** Aborts when any input signal aborts, keeping its reason. AbortSignal.any is missing on older WebViews. */
export function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
