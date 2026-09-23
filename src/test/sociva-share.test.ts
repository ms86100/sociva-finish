import { describe, expect, it } from 'vitest';
import {
  buildProductShareText,
  buildStoreShareText,
  productShareUrl,
  storeShareUrl,
} from '@/lib/sociva-share';

describe('sociva-share', () => {
  it('builds product WhatsApp-friendly text with link', () => {
    const text = buildProductShareText({
      name: 'Chicken Biryani',
      priceLabel: '₹199',
      sellerName: 'Mountain Studio Cafe',
      url: 'https://www.sociva.in/api/share/product/abc',
    });
    expect(text).toContain('Found this on Sociva');
    expect(text).toContain('Chicken Biryani - ₹199');
    expect(text).toContain('Mountain Studio Cafe');
    expect(text).toContain('https://www.sociva.in/api/share/product/abc');
  });

  it('builds store share text', () => {
    const text = buildStoreShareText({
      storeName: 'Biryani and Kebab',
      url: 'https://www.sociva.in/api/share/store/xyz',
    });
    expect(text).toContain('Biryani and Kebab');
    expect(text).toContain('/api/share/store/xyz');
  });

  it('uses path-based OG share URLs (not hash-only)', () => {
    expect(productShareUrl('p1')).toMatch(/\/api\/share\/product\/p1(\?|$)/);
    expect(storeShareUrl('s1')).toMatch(/\/api\/share\/store\/s1(\?|$)/);
    expect(productShareUrl('p1')).not.toContain('#/');
  });

  it('product detail share no longer calls hooks inside click handlers', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../components/product/ProductDetailSheet.tsx'),
      'utf8',
    );
    expect(src).toMatch(/shareSocivaContent/);
    expect(src).not.toMatch(/useFeedbackPopup\(\)/);
    expect(src).toMatch(/d\.setReportOpen\(true\)/);
    expect(src).toMatch(/navigate\('\/auth'/);
    expect(src).not.toMatch(/onOpenChange\(false\);\s*d\.setReportOpen/);
  });

  it('share helper prefers Capacitor Share/Clipboard on native', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../lib/sociva-share.ts'),
      'utf8',
    );
    expect(src).toMatch(/@capacitor\/share/);
    expect(src).toMatch(/@capacitor\/clipboard/);
    expect(src).toMatch(/if \(opened\) return 'whatsapp'/);
    expect(src).toMatch(/return 'failed'/);
  });
});
