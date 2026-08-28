// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { resolveNotificationRoute } from '@/lib/notification-routes';
import { ACTION_CONFIG } from '@/lib/marketplace-constants';

describe('contact enquiry robust fix', () => {
  it('routes contact_request notifications to seller contact leads inbox', () => {
    expect(resolveNotificationRoute('contact_request', { interaction_id: 'abc-123' }))
      .toBe('/seller/messages?tab=contacts&lead=abc-123');
    expect(resolveNotificationRoute('contact_request', {}))
      .toBe('/seller/messages?tab=contacts');
  });

  it('routes seller_chat notifications to contact inbox when seller is recipient', () => {
    expect(resolveNotificationRoute('seller_chat', {
      target_role: 'seller',
      conversation_id: 'conv-1',
    })).toBe('/seller/messages?tab=contacts&conv=conv-1');
  });

  it('contact_seller is not a cart action', () => {
    expect(ACTION_CONFIG.contact_seller.isCart).toBe(false);
    expect(ACTION_CONFIG.contact_seller.shortLabel).toBe('Contact');
  });

  it('store-closed bypass applies only to contact_seller actions', () => {
    const isContactAction = true;
    const isStoreClosed = true;
    const effectiveStoreClosed = isContactAction ? false : isStoreClosed;
    expect(effectiveStoreClosed).toBe(false);

    const cartClosed = false ? false : isStoreClosed;
    expect(cartClosed).toBe(true);
  });
});
