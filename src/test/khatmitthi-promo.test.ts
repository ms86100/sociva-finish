import { describe, expect, it } from 'vitest';
import {
  buildCaptionFallback,
  extractHeadline,
  hashString,
  mergeKhatmitthiPromoConfig,
  normalizeCaption,
  normalizeWhatsAppPhone,
  pickAngle,
  shouldUseRealProductPhoto,
  stripFancyDashes,
} from '../../supabase/functions/_shared/khatmitthi-promo.ts';

describe('khatmitthi promo engine', () => {
  it('strips em and en dashes', () => {
    expect(stripFancyDashes('home\u2014cooked')).toBe('home-cooked');
    expect(stripFancyDashes('lunch\u2013dinner')).toBe('lunch-dinner');
  });

  it('keeps coupon and links in normalized caption', () => {
    const cfg = mergeKhatmitthiPromoConfig({});
    const caption = normalizeCaption('Hello neighbour, try Litti Chokha today!', cfg);
    expect(caption).toContain('KHATMITTHI50');
    expect(caption).toContain(cfg.android_url);
    expect(caption).toContain(cfg.ios_url);
    expect(caption).toContain(cfg.web_url);
  });

  it('builds fallback with locked offer', () => {
    const cfg = mergeKhatmitthiPromoConfig({});
    const text = buildCaptionFallback({
      angle: 'discount_50',
      productName: 'Litti Chokha ( 2 Pcs)',
      coupon: cfg.coupon_code,
      offerLabel: cfg.offer_label,
      androidUrl: cfg.android_url,
      iosUrl: cfg.ios_url,
      webUrl: cfg.web_url,
    });
    expect(text).toContain('KHATMITTHI50');
    expect(text).toContain('FLAT 50% OFF');
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it('rotates angles away from recent ones', () => {
    const angle = pickAngle(['discount_50', 'taste_focused', 'evening_cravings'], new Date('2026-11-15T12:00:00+05:30'));
    expect(angle).toBeTruthy();
    expect(typeof angle).toBe('string');
  });

  it('prefers real photos except poster-heavy angles', () => {
    const cfg = mergeKhatmitthiPromoConfig({ prefer_real_product_photos: true });
    const product = { id: '1', name: 'Poha', price: 130, imageUrl: 'https://example.com/a.jpg', category: 'home_food' };
    expect(shouldUseRealProductPhoto(cfg, 'taste_focused', product)).toBe(true);
    expect(shouldUseRealProductPhoto(cfg, 'discount_50', product)).toBe(false);
    expect(shouldUseRealProductPhoto(cfg, 'neighbourhood', product)).toBe(false);
  });

  it('locks Shriram Greenfield into normalized captions', () => {
    const cfg = mergeKhatmitthiPromoConfig({ society_name: 'Shriram Greenfield' });
    const caption = normalizeCaption('Hello neighbours, try Litti Chokha today!', cfg);
    expect(caption).toMatch(/Shriram Greenfield/i);
    expect(caption).toContain('KHATMITTHI50');
  });

  it('hashes captions stably', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abcd'));
  });

  it('normalizes Indian WhatsApp phones to country code 91', () => {
    expect(normalizeWhatsAppPhone('9187351014')).toBe('919187351014');
    expect(normalizeWhatsAppPhone('+91 9535115316')).toBe('919535115316');
    expect(normalizeWhatsAppPhone('919187351014')).toBe('919187351014');
  });

  it('extracts a short opening headline from long captions', () => {
    const caption = [
      'Hello neighbours! Hope your day is going well. I just finished preparing a fresh batch of Bhindi Masala.',
      '',
      'You can place your order right here on Sociva:',
      'Android: https://example.com',
    ].join('\n');
    const headline = extractHeadline(caption);
    expect(headline.toLowerCase()).toContain('hello neighbours');
    expect(headline.length).toBeLessThanOrEqual(72);
  });
});
