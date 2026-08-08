import * as Sentry from '@sentry/react';

const REDACTED = '[Redacted]';
const SENSITIVE_KEY = /authorization|cookie|token|secret|password|otp|card|vpa|upi|phone|email/i;

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
  const sanitized = redactValue(event) as T;
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
  return sanitized;
}

export function initObservability(): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn) {
    console.info('[Observability] Sentry disabled: VITE_SENTRY_DSN is not configured');
    return false;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || 'sociva-web@unversioned',
    sendDefaultPii: false,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0.1),
    beforeSend: (event) => sanitizeSentryEvent(event),
  });
  return true;
}

export function captureException(error: unknown, context?: Record<string, unknown>) {
  Sentry.captureException(error, context ? { extra: sanitizeSentryEvent(context) } : undefined);
}
