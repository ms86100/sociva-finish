import { describe, expect, it } from 'vitest';
import { sanitizeSentryEvent } from '@/lib/observability';

describe('Sentry observability redaction', () => {
  it('removes identity and sensitive request data before sending', () => {
    const event = sanitizeSentryEvent({
      user: { id: 'user-1', email: 'buyer@example.test', ip_address: '127.0.0.1' },
      request: {
        cookies: { session: 'secret' },
        data: { card_number: '4111111111111111' },
        headers: { authorization: 'Bearer token', 'x-request-id': 'req-1' },
      },
      extra: { phone: '9999999999', safe_count: 2 },
    });

    expect(event.user).toEqual({ id: 'user-1', segment: undefined });
    expect(event.request.cookies).toBeUndefined();
    expect(event.request.data).toBeUndefined();
    expect(event.request.headers.authorization).toBe('[Redacted]');
    expect(event.request.headers['x-request-id']).toBe('req-1');
    expect(event.extra.phone).toBe('[Redacted]');
    expect(event.extra.safe_count).toBe(2);
  });
});
