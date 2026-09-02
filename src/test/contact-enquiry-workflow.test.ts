import { describe, it, expect } from 'vitest';
import {
  getNextStatusForActor,
  canActorCancel,
  type StatusFlowStep,
  type StatusTransition,
} from '@/hooks/useCategoryStatusFlow';
import { isContactEnquiryTransaction } from '@/lib/orderProgressStages';

const FLOW: StatusFlowStep[] = [
  { status_key: 'enquired', sort_order: 1, actor: 'buyer', is_terminal: false, is_success: true, requires_otp: false, is_transit: false, otp_type: null, display_label: 'Enquiry', color: null, icon: null, buyer_hint: null, buyer_display_label: 'Enquiry sent', seller_display_label: 'New enquiry' },
  { status_key: 'quoted', sort_order: 2, actor: 'seller', is_terminal: false, is_success: true, requires_otp: false, is_transit: false, otp_type: null, display_label: 'Accepted', color: null, icon: null, buyer_hint: null, buyer_display_label: 'Seller accepted', seller_display_label: 'Accepted' },
  { status_key: 'completed', sort_order: 3, actor: 'seller,buyer', is_terminal: true, is_success: true, requires_otp: false, is_transit: false, otp_type: null, display_label: 'Delivered', color: null, icon: null, buyer_hint: null, buyer_display_label: 'Delivered', seller_display_label: 'Delivered' },
  { status_key: 'cancelled', sort_order: 4, actor: 'buyer', is_terminal: true, is_success: false, requires_otp: false, is_transit: false, otp_type: null, display_label: 'Cancelled', color: null, icon: null, buyer_hint: null, buyer_display_label: null, seller_display_label: null },
];

const TRANSITIONS: StatusTransition[] = [
  { from_status: 'enquired', to_status: 'quoted', allowed_actor: 'seller', is_side_action: false },
  { from_status: 'quoted', to_status: 'completed', allowed_actor: 'seller', is_side_action: false },
  { from_status: 'enquired', to_status: 'cancelled', allowed_actor: 'seller', is_side_action: true },
  { from_status: 'quoted', to_status: 'cancelled', allowed_actor: 'seller', is_side_action: true },
];

describe('contact enquiry two-step seller close', () => {
  it('identifies contact_enquiry without treating request_service as contact', () => {
    expect(isContactEnquiryTransaction('contact_enquiry')).toBe(true);
    expect(isContactEnquiryTransaction('request_service')).toBe(false);
    expect(isContactEnquiryTransaction('cart_purchase')).toBe(false);
    expect(isContactEnquiryTransaction(null)).toBe(false);
  });

  it('seller step 1 is accept (enquired → quoted), not cart confirmed/prep', () => {
    expect(getNextStatusForActor(FLOW, 'enquired', 'seller', TRANSITIONS)).toBe('quoted');
  });

  it('seller step 2 is delivered (quoted → completed)', () => {
    expect(getNextStatusForActor(FLOW, 'quoted', 'seller', TRANSITIONS)).toBe('completed');
  });

  it('seller cannot advance after delivered', () => {
    expect(getNextStatusForActor(FLOW, 'completed', 'seller', TRANSITIONS)).toBeNull();
  });

  it('seller can decline from the incoming enquiry', () => {
    expect(canActorCancel(TRANSITIONS, 'enquired', 'seller')).toBe(true);
  });

  it('does not expose cart statuses as the primary next step', () => {
    const next = getNextStatusForActor(FLOW, 'enquired', 'seller', TRANSITIONS);
    expect(['accepted', 'preparing', 'ready', 'picked_up', 'confirmed']).not.toContain(next);
  });
});
