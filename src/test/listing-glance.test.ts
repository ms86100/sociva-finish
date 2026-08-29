import { describe, expect, it } from 'vitest';
import {
  listingDiscountPercent,
  listingGlanceFacts,
  listingGlanceKind,
  shouldShowStockLeft,
} from '@/lib/listing-glance';

describe('listingDiscountPercent', () => {
  it('returns one percent from MRP vs price', () => {
    expect(listingDiscountPercent(22, 222)).toBe(90);
  });

  it('returns 0 when there is no real discount', () => {
    expect(listingDiscountPercent(100, 100)).toBe(0);
    expect(listingDiscountPercent(100, null)).toBe(0);
  });
});

describe('listingGlanceKind', () => {
  it('maps commerce actions to glance kinds', () => {
    expect(listingGlanceKind('add_to_cart')).toBe('product');
    expect(listingGlanceKind('book')).toBe('booking');
    expect(listingGlanceKind('request_quote')).toBe('enquiry');
    expect(listingGlanceKind('contact_seller')).toBe('contact');
  });
});

describe('listingGlanceFacts', () => {
  it('shows serving size and scarce stock for products, not every stock count', () => {
    expect(shouldShowStockLeft(40)).toBe(false);
    expect(listingGlanceFacts({
      serving_size: '2',
      stock_quantity: 3,
      delivery_time_text: '30 min',
    }, 'product')).toEqual(['Serves 2', '3 left']);
  });

  it('surfaces booking duration and availability without inventing slots', () => {
    expect(listingGlanceFacts({
      service_duration_minutes: 45,
      fulfillment_mode: 'at_store',
      seller_is_available: true,
    }, 'booking')).toEqual(['Available today', '45 min']);
  });

  it('shows reply time for enquiry listings instead of a product description dump', () => {
    expect(listingGlanceFacts({
      avg_response_minutes: 10,
      fulfillment_mode: 'home_visit',
      description: 'A long seller bio that should not crowd the card',
    }, 'enquiry')).toEqual(['Replies in ~10m', 'Home visit']);
  });
});
