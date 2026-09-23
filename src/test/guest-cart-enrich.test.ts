import { describe, expect, it } from 'vitest';
import {
  applySellerHydration,
  guestCartNeedsSellerHydration,
  normalizeGuestProductSeller,
} from '@/lib/guest-cart-enrich';
import type { GuestCartLine } from '@/lib/guest-cart';

describe('guest cart seller enrich', () => {
  it('nests seller from flat discovery snapshot fields', () => {
    const product = normalizeGuestProductSeller({
      id: 'p1',
      seller_id: 's1',
      name: 'Biryani',
      price: 99,
      seller_name: 'Biryani and Kebab',
      fulfillment_mode: null,
    } as any) as any;

    expect(product.seller.id).toBe('s1');
    expect(product.seller.business_name).toBe('Biryani and Kebab');
  });

  it('needs hydration until server seller row is applied', () => {
    const lines: GuestCartLine[] = [
      {
        product_id: 'p1',
        quantity: 1,
        product: {
          id: 'p1',
          seller_id: 's1',
          name: 'Biryani',
          price: 99,
          seller: { id: 's1', business_name: 'X' },
        } as any,
      },
    ];
    expect(guestCartNeedsSellerHydration(lines)).toBe(true);

    const hydrated = applySellerHydration(
      lines,
      new Map([
        [
          's1',
          {
            id: 's1',
            business_name: 'Biryani and Kebab',
            fulfillment_mode: 'pickup_and_seller_delivery',
            accepts_cod: true,
            pickup_payment_config: { accepts_cod: true },
            delivery_payment_config: { accepts_cod: true },
          },
        ],
      ]),
    );
    expect(guestCartNeedsSellerHydration(hydrated)).toBe(false);
    expect((hydrated[0].product as any).seller.fulfillment_mode).toBe('pickup_and_seller_delivery');
    expect((hydrated[0].product as any).seller.business_name).toBe('Biryani and Kebab');
  });
});
