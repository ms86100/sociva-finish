import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseProximityOverlayMessages } from '@/lib/proximity-overlay-messages';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('Order Details page must not crash on multi-store checkouts', () => {
  const page = read('src/pages/OrderDetailPage.tsx');
  const refundCard = read('src/components/refund/RefundRequestCard.tsx');
  const sellerRefund = read('src/components/refund/SellerRefundActions.tsx');
  const ordersPage = read('src/pages/OrdersPage.tsx');
  const checkoutPage = read('src/pages/CheckoutDetailPage.tsx');
  const siblings = read('src/components/order/CheckoutSiblingsStrip.tsx');
  const mapView = read('src/components/delivery/DeliveryMapView.tsx');

  it('does not call useMemo (or any hook) inside JSX', () => {
    expect(page).not.toMatch(/=\{useMemo\(/);
    expect(page).not.toMatch(/=\{useCallback\(/);
    expect(page).not.toMatch(/=\{useEffect\(/);
    expect(page).not.toMatch(/=\{useState\(/);
    expect(page).toMatch(/parseProximityOverlayMessages\(getSetting\('proximity_thresholds'\)\)/);
  });

  it('isolates refund, siblings, map, and overlay so one section cannot white-screen the page', () => {
    expect(page).toMatch(/SafeSectionWrapper name="BuyerRefund"/);
    expect(page).toMatch(/SafeSectionWrapper name="SellerRefund"/);
    expect(page).toMatch(/SafeSectionWrapper name="CheckoutSiblings"/);
    expect(page).toMatch(/SafeSectionWrapper name="ArrivalOverlay"/);
    expect(page).toMatch(/SafeSectionWrapper name="DeliveryMap"/);
  });

  it('keeps checkout siblings on the detail page and mixed statuses on the list', () => {
    expect(page).toMatch(/useCheckoutSiblings/);
    expect(page).toMatch(/CheckoutSiblingsStrip/);
    expect(siblings).toMatch(/buyerStoreStatusLabel/);
    expect(ordersPage).toMatch(/CheckoutGroupCard/);
    expect(checkoutPage).toMatch(/useCheckoutGroup/);
  });

  it('does not throw when refund eligibility RPC fails', () => {
    expect(refundCard).toMatch(/eligibility lookup failed/);
    expect(refundCard).toMatch(/return null;/);
    expect(sellerRefund).toMatch(/eligibility lookup failed/);
  });

  it('falls back when Google Directions is denied instead of crashing the map', () => {
    expect(mapView).toMatch(/REQUEST_DENIED/);
    expect(mapView).toMatch(/googleDirectionsUnavailable = true/);
    expect(mapView).toMatch(/return null/);
  });
});

describe('parseProximityOverlayMessages', () => {
  it('returns overlay copy from admin JSON and never throws', () => {
    expect(parseProximityOverlayMessages(undefined)).toBeUndefined();
    expect(parseProximityOverlayMessages('not-json')).toBeUndefined();
    expect(
      parseProximityOverlayMessages(
        JSON.stringify({
          at_doorstep: { buyer_message: 'At your door' },
          arriving: { buyer_message: 'Arriving soon' },
        }),
      ),
    ).toEqual({
      at_doorstep_title: 'At your door',
      arriving_title: 'Arriving soon',
      subtitle: undefined,
    });
  });
});

describe('orders.payment_type refund RPC patch', () => {
  const patch = read('supabase/migrations/20260903130000_fix_order_payment_type_refund_rpc.sql');

  it('redefines eligibility RPCs against payment_type only', () => {
    const bodies = [...patch.matchAll(/\$function\$([\s\S]*?)\$function\$/g)].map((m) => m[1]).join('\n');
    expect(patch).toMatch(/CREATE OR REPLACE FUNCTION public.get_sociva_balance_refund_eligibility/);
    expect(patch).toMatch(/CREATE OR REPLACE FUNCTION public.is_order_online_payment_source/);
    expect(bodies).toMatch(/SELECT lower\(trim\(COALESCE\(o\.payment_type, ''\)\)\)/);
    expect(bodies).not.toMatch(/o\.payment_method/);
  });

  it('patches remaining functions that still SELECT o.payment_method', () => {
    expect(patch).toMatch(/position\('o\.payment_method' in pg_get_functiondef/);
    expect(patch).toMatch(/RAISE EXCEPTION 'o\.payment_method still referenced/);
  });
});
