import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { BUYER_RECEIVED_CTA, orderWorkflowActionLabel } from '@/lib/order-workflow-action-label';

describe('order workflow action labels', () => {
  it('uses first-person copy when a buyer confirms pickup or delivery', () => {
    expect(orderWorkflowActionLabel({
      status: 'buyer_received',
      otpRequired: false,
      viewRole: 'buyer',
      displayLabel: 'Buyer Received',
      isTerminal: false,
    })).toBe("I've received my order");

    expect(orderWorkflowActionLabel({
      status: 'buyer_received',
      otpRequired: true,
      viewRole: 'buyer',
      displayLabel: 'Buyer Received',
      isTerminal: false,
    })).toBe("Verify & I've received my order");

    expect(orderWorkflowActionLabel({
      status: 'delivered',
      otpRequired: false,
      viewRole: 'buyer',
      displayLabel: 'Delivered',
      isTerminal: true,
    })).toBe(BUYER_RECEIVED_CTA);
  });

  it('does not show Mark Buyer Received to the buyer', () => {
    const label = orderWorkflowActionLabel({
      status: 'buyer_received',
      otpRequired: false,
      viewRole: 'buyer',
      displayLabel: 'Buyer Received',
      isTerminal: false,
    });
    expect(label.toLowerCase()).not.toContain('mark buyer');
    expect(label).toBe("I've received my order");
  });

  it('keeps seller ops copy for the same status', () => {
    expect(orderWorkflowActionLabel({
      status: 'buyer_received',
      otpRequired: false,
      viewRole: 'seller',
      displayLabel: 'Buyer Received',
      isTerminal: false,
    })).toBe('Mark Buyer Received');
  });

  it('wires the helper into the order detail action bar', () => {
    const page = readFileSync(resolve(__dirname, '../pages/OrderDetailPage.tsx'), 'utf8');
    expect(page).toContain('orderWorkflowActionLabel');
    expect(page).toContain('getActionLabel');
  });
});
