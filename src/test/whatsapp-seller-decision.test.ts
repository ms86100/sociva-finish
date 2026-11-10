import { describe, expect, it } from 'vitest';
import {
  buildSellerWhatsAppCard,
  isDeliveryCodeMessage,
  parseSellerOrderDecision,
  parseSellerWhatsAppAction,
  sellerDecisionButtonIds,
  sellerReminderDue,
  sellerStepLabel,
} from '../../supabase/functions/_shared/whatsapp-seller-decision';

const ORDER = '3f5b2e89-ccfd-439e-903a-394a54ef6084';

describe('seller WhatsApp order actions', () => {
  it('accepts only exact button ids', () => {
    const ids = sellerDecisionButtonIds(ORDER);
    expect(parseSellerOrderDecision(ids.accept)).toEqual({
      orderId: ORDER,
      decision: 'accept',
    });
    expect(parseSellerWhatsAppAction(`sociva_seller_step:${ORDER}:preparing`)).toEqual({
      kind: 'step',
      orderId: ORDER,
      status: 'preparing',
      buttonId: `sociva_seller_step:${ORDER}:preparing`,
    });
  });

  it('ignores free text, groups style leads, and a too-long code', () => {
    expect(parseSellerWhatsAppAction('Perfect. I want to sell nearby')).toBeNull();
    expect(parseSellerWhatsAppAction('accept')).toBeNull();
    expect(parseSellerWhatsAppAction('sociva_lead_sell_nearby')).toBeNull();
    expect(isDeliveryCodeMessage('1234')).toBe(true);
    expect(isDeliveryCodeMessage('12345')).toBe(false);
    expect(isDeliveryCodeMessage('code 1234')).toBe(false);
    expect(isDeliveryCodeMessage('12 34')).toBe(false);
  });

  it('keeps button labels short and the card specific', () => {
    expect(sellerStepLabel('preparing').length).toBeLessThanOrEqual(20);
    const card = buildSellerWhatsAppCard({
      order_id: ORDER,
      order_ref: 'EF6084',
      status: 'placed',
      buyer_name: 'Priya Sharma',
      society: 'Greenfield',
      block: 'H',
      flat: '1204',
      items: '2x Dum biryani',
      amount: 240,
      next_status: 'accepted',
      can_reject: true,
      needs_otp: false,
    });
    expect(card.text).toContain('Priya Sharma');
    expect(card.text).toContain('Greenfield');
    expect(card.text).toContain('Flat 1204');
    expect(card.text).toContain('Block H');
    expect(card.buttons.map((b) => b.displayText)).toEqual(['Accept', 'Reject']);
    expect(card.buttons.map((b) => b.id)).toEqual([
      `sociva_seller_accept:${ORDER}`,
      `sociva_seller_reject:${ORDER}`,
    ]);
    expect(card.text).toContain('Tap Accept or Reject');
    expect(card.text).not.toMatch(/\u2013|\u2014/);
  });

  it('keeps later steps on the step button', () => {
    const card = buildSellerWhatsAppCard({
      order_id: ORDER,
      status: 'accepted',
      buyer_name: 'Priya Sharma',
      next_status: 'preparing',
      can_reject: false,
      needs_otp: false,
    });
    expect(card.buttons.map((b) => b.displayText)).toEqual(['Start preparing']);
    expect(card.buttons[0].id).toBe(`sociva_seller_step:${ORDER}:preparing`);
  });

  it('asks for a code instead of a delivered button', () => {
    const card = buildSellerWhatsAppCard({
      order_id: ORDER,
      status: 'on_the_way',
      buyer_name: 'Priya Sharma',
      flat: '12',
      next_status: 'delivered',
      needs_otp: true,
      can_reject: false,
    });
    expect(card.buttons).toEqual([]);
    expect(card.text).toContain('4-digit code');
    expect(card.text).not.toContain('Mark delivered');
  });

  it('reminds on a widening gap and stops after 18 hours', () => {
    const now = Date.parse('2026-11-09T12:00:00Z');
    expect(sellerReminderDue({
      statusAgeMs: 30_000,
      lastCardAtMs: null,
      priorCards: 0,
      nowMs: now,
    })).toBe(false);
    expect(sellerReminderDue({
      statusAgeMs: 90_000,
      lastCardAtMs: null,
      priorCards: 0,
      nowMs: now,
    })).toBe(true);
    expect(sellerReminderDue({
      statusAgeMs: 20 * 60_000,
      lastCardAtMs: now - 10 * 60_000,
      priorCards: 1,
      nowMs: now,
    })).toBe(false);
    expect(sellerReminderDue({
      statusAgeMs: 20 * 60_000,
      lastCardAtMs: now - 16 * 60_000,
      priorCards: 1,
      nowMs: now,
    })).toBe(true);
    expect(sellerReminderDue({
      statusAgeMs: 19 * 60 * 60 * 1000,
      lastCardAtMs: null,
      priorCards: 0,
      nowMs: now,
    })).toBe(false);
  });
});
