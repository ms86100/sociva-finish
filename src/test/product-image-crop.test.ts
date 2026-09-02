import { describe, expect, it, beforeEach } from 'vitest';
import { canRecordMarketplaceEvent, isMarketplaceUuid } from '@/lib/marketplace-event-ids';
import {
  clearPendingImageCrop,
  readPendingImageCrop,
  writePendingImageCrop,
} from '@/lib/pending-image-crop';
import { sellerProductDraftHasWork } from '@/hooks/useProductFormDraft';

describe('marketplace event ids', () => {
  it('accepts real product/seller UUIDs', () => {
    expect(isMarketplaceUuid('60d7d509-f266-488a-9b96-64bb7813c2df')).toBe(true);
    expect(canRecordMarketplaceEvent(
      'd5693572-d871-4fa0-9c07-5221ba53fa7e',
      '60d7d509-f266-488a-9b96-64bb7813c2df',
    )).toBe(true);
  });

  it('rejects form-preview placeholders that caused HTTP 400', () => {
    expect(isMarketplaceUuid('preview')).toBe(false);
    expect(isMarketplaceUuid('preview-seller')).toBe(false);
    expect(isMarketplaceUuid('')).toBe(false);
    expect(canRecordMarketplaceEvent('preview', '60d7d509-f266-488a-9b96-64bb7813c2df')).toBe(false);
    expect(canRecordMarketplaceEvent(
      'd5693572-d871-4fa0-9c07-5221ba53fa7e',
      'preview-seller',
    )).toBe(false);
  });
});

describe('pending image crop', () => {
  beforeEach(() => {
    clearPendingImageCrop();
  });

  it('round-trips a data URL so crop can survive a remount', () => {
    writePendingImageCrop({
      dataUrl: 'data:image/jpeg;base64,abc',
      folder: 'products',
      slot: 'products:square',
    });
    expect(readPendingImageCrop()).toEqual({
      dataUrl: 'data:image/jpeg;base64,abc',
      folder: 'products',
      slot: 'products:square',
    });
  });

  it('ignores non-image payloads', () => {
    sessionStorage.setItem('sociva-pending-image-crop', JSON.stringify({ dataUrl: 'https://example.com/x.jpg' }));
    expect(readPendingImageCrop()).toBeNull();
  });
});

describe('sellerProductDraftHasWork', () => {
  it('treats an uploaded image as in-progress work even without a name', () => {
    expect(sellerProductDraftHasWork({ name: '', image_url: 'https://cdn.example/p.jpg', price: '', description: '' })).toBe(true);
    expect(sellerProductDraftHasWork({ name: '', image_url: null, price: '', description: '' })).toBe(false);
  });
});
