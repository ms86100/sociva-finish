import { describe, expect, it } from 'vitest';
import { hasRazorpayCheckout, isLikelyRazorpayNode } from '@/lib/razorpay-checkout-dom';

describe('razorpay checkout dom detection', () => {
  it('detects injected Razorpay container nodes', () => {
    const node = document.createElement('div');
    node.className = 'razorpay-container';

    expect(isLikelyRazorpayNode(node)).toBe(true);
  });

  it('detects high z-index overlay with Razorpay iframe', () => {
    const root = document.createElement('div');
    const wrapper = document.createElement('div');
    wrapper.style.zIndex = '2147483647';

    const iframe = document.createElement('iframe');
    iframe.src = 'https://checkout.razorpay.com/v1/checkout-frame';
    wrapper.appendChild(iframe);
    root.appendChild(wrapper);

    expect(hasRazorpayCheckout(root)).toBe(true);
  });

  it('does not flag unrelated overlays as Razorpay', () => {
    const root = document.createElement('div');
    const wrapper = document.createElement('div');
    wrapper.style.zIndex = '2147483647';
    root.appendChild(wrapper);

    expect(hasRazorpayCheckout(root)).toBe(false);
  });
});