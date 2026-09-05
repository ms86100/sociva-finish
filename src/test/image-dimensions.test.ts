import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  PRODUCT_IMAGE_MIN_PX,
  productImageDimensionError,
  validateProductImageDimensions,
} from '@/lib/image-dimensions';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('product image minimum dimensions (BUG-07)', () => {
  beforeEach(() => {
    class FakeImage {
      width = 0;
      height = 0;
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => {
          this.width = (globalThis as any).__fakeImgW ?? 10;
          this.height = (globalThis as any).__fakeImgH ?? 10;
          this.naturalWidth = this.width;
          this.naturalHeight = this.height;
          this.onload?.();
        });
      }
    }
    vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:fake',
      revokeObjectURL: () => undefined,
    });
  });

  afterEach(() => {
    delete (globalThis as any).__fakeImgW;
    delete (globalThis as any).__fakeImgH;
    vi.unstubAllGlobals();
  });

  it('rejects tiny test PNGs under the product minimum', async () => {
    (globalThis as any).__fakeImgW = 10;
    (globalThis as any).__fakeImgH = 10;
    const result = await validateProductImageDimensions(new Blob(['x'], { type: 'image/png' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_small');
    expect(productImageDimensionError(result)).toMatch(new RegExp(`${PRODUCT_IMAGE_MIN_PX}`));
  });

  it('accepts images at or above the product minimum', async () => {
    (globalThis as any).__fakeImgW = 400;
    (globalThis as any).__fakeImgH = 400;
    const result = await validateProductImageDimensions(new Blob(['x'], { type: 'image/png' }));
    expect(result.ok).toBe(true);
  });

  it('enforces min dimensions in CroppableImageUpload for products', () => {
    const src = read('src/components/ui/croppable-image-upload.tsx');
    expect(src).toMatch(/validateProductImageDimensions/);
    expect(src).toMatch(/folder === 'products'/);
    expect(src).toMatch(/Min \$\{PRODUCT_IMAGE_MIN_PX\}/);
  });
});
