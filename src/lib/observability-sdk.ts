/**
 * Sentry SDK. Loaded only after first paint so it stays off the startup download.
 */

import * as Sentry from '@sentry/react';
import { sanitizeSentryEvent } from '@/lib/observability';

export function startSentry(dsn: string): void {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || 'sociva-web@unversioned',
    sendDefaultPii: false,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0.1),
    beforeSend: (event) => sanitizeSentryEvent(event),
  });
}

export function captureSentryException(error: unknown, context?: Record<string, unknown>): void {
  Sentry.captureException(error, context ? { extra: sanitizeSentryEvent(context) } : undefined);
}
