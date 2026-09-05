import { afterEach, describe, expect, it } from 'vitest';
import {
  acknowledgeNotify,
  clearNotifyQueue,
  closeNotify,
  getNotifyState,
  notify,
} from '@/lib/notify';
import { adminNotify } from '@/lib/admin-notify';

afterEach(() => {
  clearNotifyQueue();
});

describe('important message queue', () => {
  it('shows one message at a time and advances after acknowledgement', async () => {
    notify.info('First message', { id: 'first' });
    notify.warn('Second message', { id: 'second' });

    expect(getNotifyState().message).toBe('First message');
    acknowledgeNotify();
    await Promise.resolve();

    expect(getNotifyState().open).toBe(true);
    expect(getNotifyState().message).toBe('Second message');
  });

  it('deduplicates an open message by id', () => {
    notify.block('Original', { id: 'same-message' });
    notify.block('Duplicate', { id: 'same-message' });
    acknowledgeNotify();

    expect(getNotifyState().open).toBe(false);
  });

  it('resolves confirmations for both actions', async () => {
    const accepted = notify.confirm('Continue?', { id: 'accept-test' });
    acknowledgeNotify();
    await expect(accepted).resolves.toBe(true);

    const cancelled = notify.confirm('Continue?', { id: 'cancel-test' });
    closeNotify();
    await expect(cancelled).resolves.toBe(false);
  });

  it('shares the user decision with duplicate confirmations', async () => {
    const first = notify.confirm('Continue payment?', { id: 'payment-decision' });
    const duplicate = notify.confirm('Continue payment?', { id: 'payment-decision' });

    acknowledgeNotify();

    await expect(first).resolves.toBe(true);
    await expect(duplicate).resolves.toBe(true);
  });

  it('prioritizes critical queued messages', async () => {
    notify.info('Current', { id: 'current' });
    notify.info('Normal', { id: 'normal' });
    notify.block('Critical', { id: 'critical', priority: 'critical' });

    acknowledgeNotify();
    await Promise.resolve();

    expect(getNotifyState().message).toBe('Critical');
  });

  it('routes admin success and errors through acknowledgement popups', () => {
    adminNotify.success('Payment mode updated', { id: 'admin-success' });
    expect(getNotifyState()).toMatchObject({
      open: true,
      title: 'Update complete',
      message: 'Payment mode updated',
    });
    acknowledgeNotify();

    adminNotify.error({ code: '42703', message: 'column secret_value does not exist' }, { id: 'admin-error' });
    expect(getNotifyState().message).not.toContain('secret_value');
  });

  it('clears a leftover block so a later route does not keep showing it', () => {
    notify.block('You already have a store in this type.', { id: 'seller-group-taken' });
    expect(getNotifyState().open).toBe(true);
    clearNotifyQueue();
    expect(getNotifyState().open).toBe(false);
  });
});
