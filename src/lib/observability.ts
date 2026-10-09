/**
 * Sentry facade. The SDK loads on demand so it is not part of the first-paint download.
 * captureException calls made before init are queued and flushed in order.
 */

const REDACTED = '[Redacted]';
const SENSITIVE_KEY = /authorization|cookie|token|secret|password|otp|card|vpa|upi|phone|email/i;

type CaptureFn = (error: unknown, context?: Record<string, unknown>) => void;

let captureImpl: CaptureFn | null = null;
let ready = false;
let disabled = false;
let starting: Promise<void> | null = null;
const pending: Array<{ error: unknown; context?: Record<string, unknown> }> = [];

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactValue(nested),
    ]),
  );
}

export function sanitizeSentryEvent<T extends Record<string, any>>(event: T): T {
  const sanitized = redactValue(event) as Record<string, any>;
  if (sanitized.user) {
    sanitized.user = {
      id: sanitized.user.id,
      segment: sanitized.user.segment,
    };
  }
  if (sanitized.request) {
    delete sanitized.request.cookies;
    delete sanitized.request.data;
  }
  return sanitized as T;
}

function flushPending(): void {
  if (!captureImpl) return;
  while (pending.length) {
    const item = pending.shift();
    if (item) captureImpl(item.error, item.context);
  }
}

export function initObservability(): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn) {
    console.info('[Observability] Sentry disabled: VITE_SENTRY_DSN is not configured');
    disabled = true;
    pending.length = 0;
    return false;
  }
  if (ready) return true;
  if (!starting) {
    starting = import('@/lib/observability-sdk')
      .then((mod) => {
        mod.startSentry(dsn);
        captureImpl = (error, context) => mod.captureSentryException(error, context);
        flushPending();
        ready = true;
        flushPending();
      })
      .catch((err) => {
        console.warn('[Observability] init failed', err);
        starting = null;
      });
  }
  return true;
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  if (disabled) return;
  if (ready && captureImpl) {
    captureImpl(error, context);
    return;
  }
  pending.push({ error, context });
}
