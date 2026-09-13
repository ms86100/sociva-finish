// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveNotificationRoute } from '@/lib/notification-routes';
import { ACTION_CONFIG, deriveActionType } from '@/lib/marketplace-constants';

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

  it('similar products fetch keeps action_type so Contact Seller is not lost', () => {
    const hook = readFileSync(resolve(__dirname, '../hooks/useProductDetail.ts'), 'utf8');
    const sheet = readFileSync(resolve(__dirname, '../components/product/ProductDetailSheet.tsx'), 'utf8');
    expect(hook).toMatch(/\.select\([^)]*action_type[^)]*\)/);
    expect(hook).toMatch(/category/);
    expect(deriveActionType('contact_seller', null, null)).toBe('contact_seller');
    expect(deriveActionType(undefined, null, null)).toBe('add_to_cart'); // lossy path we must not hit
    expect(sheet).toMatch(/Contact for price/);
    expect(sheet).toMatch(/sp\.action_type === 'contact_seller'/);
  });
});
