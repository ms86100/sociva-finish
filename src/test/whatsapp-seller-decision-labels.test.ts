import { describe, it, expect } from 'vitest';
import {
  buildSellerWhatsAppCard,
  parseSellerWhatsAppAction,
  parseSellerTextDecision,
  sellerStepLabel,
} from '../../supabase/functions/_shared/whatsapp-seller-decision.ts';

describe('WhatsApp seller interactive labels', () => {
  it('shows ACCEPT ORDER / REJECT ORDER on waiting cards', () => {
    const card = buildSellerWhatsAppCard({
      order_id: '31455d4c-a19e-4476-8824-024ffb758cd0',
      order_ref: '758CD0',
      status: 'placed',
      buyer_name: 'Priya Reddy',
      items: '1x Kebab',
      amount: 99,
      can_reject: true,
      terminal: false,
    });
    expect(card.buttons.map((b) => b.displayText)).toEqual([
      'ACCEPT ORDER',
      'REJECT ORDER',
    ]);
    expect(card.buttons[0].id).toContain('sociva_seller_accept:31455d4c');
    expect(card.buttons[1].id).toContain('sociva_seller_reject:31455d4c');
  });

  it('shows next-step labels after accept', () => {
    expect(sellerStepLabel('preparing')).toBe('START PREPARING');
    expect(sellerStepLabel('ready')).toBe('MARK READY');
    expect(sellerStepLabel('completed')).toBe('COMPLETE ORDER');
  });

  it('parses order-scoped button ids independently', () => {
    const a = parseSellerWhatsAppAction(
      'sociva_seller_accept:31455d4c-a19e-4476-8824-024ffb758cd0',
    );
    const b = parseSellerWhatsAppAction(
      'sociva_seller_step:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:preparing',
    );
    expect(a).toEqual({
      kind: 'accept',
      orderId: '31455d4c-a19e-4476-8824-024ffb758cd0',
      buttonId: 'sociva_seller_accept:31455d4c-a19e-4476-8824-024ffb758cd0',
    });
    expect(b?.kind).toBe('step');
    if (b?.kind === 'step') {
      expect(b.orderId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      expect(b.status).toBe('preparing');
    }
  });

  it('parses text ACCEPT / REJECT fallback with optional order ref', () => {
    expect(parseSellerTextDecision('ACCEPT')).toEqual({
      decision: 'accept',
      orderRef: null,
    });
    expect(parseSellerTextDecision('REJECT #758CD0')).toEqual({
      decision: 'reject',
      orderRef: '758CD0',
    });
    expect(parseSellerTextDecision('I accept later')).toBeNull();
  });
});
