import { describe, it, expect } from 'vitest';
import { deriveDisplayStatus } from '@/lib/deriveDisplayStatus';

describe('Enquiry & Quote Flow Honesty', () => {
  it('displays honest quote request copy for buyer in enquired status', () => {
    const status = deriveDisplayStatus({
      orderStatus: 'enquired',
      flow: [],
      isBuyerView: true,
      orderType: 'enquiry',
      isEnquiryOrder: true,
    });

    expect(status.text).toBe('Quote request sent');
    expect(status.icon).toBe('MessageCircle');
  });

  it('displays honest quote request copy for seller in enquired status', () => {
    const status = deriveDisplayStatus({
      orderStatus: 'enquired',
      flow: [],
      isBuyerView: false,
      orderType: 'enquiry',
      isEnquiryOrder: true,
    });

    expect(status.text).toBe('New quote request received');
    expect(status.icon).toBe('MessageCircle');
  });

  it('displays quote received copy for buyer in quoted status', () => {
    const status = deriveDisplayStatus({
      orderStatus: 'quoted',
      flow: [],
      isBuyerView: true,
      orderType: 'enquiry',
      isEnquiryOrder: true,
    });

    expect(status.text).toBe('Quote received — review and accept');
    expect(status.icon).toBe('Receipt');
  });

  it('displays quote sent copy for seller in quoted status', () => {
    const status = deriveDisplayStatus({
      orderStatus: 'quoted',
      flow: [],
      isBuyerView: false,
      orderType: 'enquiry',
      isEnquiryOrder: true,
    });

    expect(status.text).toBe('Quote sent to buyer');
    expect(status.icon).toBe('Receipt');
  });

  it('preserves regular order placed copy for standard e-commerce orders', () => {
    const status = deriveDisplayStatus({
      orderStatus: 'placed',
      flow: [],
      isBuyerView: true,
      orderType: 'purchase',
      isEnquiryOrder: false,
    });

    expect(status.text).toBe('Order placed');
    expect(status.icon).toBe('ClipboardList');
  });
});
