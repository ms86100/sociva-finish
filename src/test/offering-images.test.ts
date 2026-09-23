import { describe, expect, it } from 'vitest';
import {
  MAX_OFFERING_IMAGES,
  canAddOfferingImage,
  canRemoveOfferingImage,
  offeringImagesLabel,
  primaryOfferingImage,
  resolveOfferingImages,
  splitOfferingImages,
} from '@/lib/offering-images';

describe('offering-images', () => {
  it('treats existing single image_url as gallery of one', () => {
    expect(resolveOfferingImages({ image_url: 'https://a/1.jpg', secondary_images: null })).toEqual([
      'https://a/1.jpg',
    ]);
    expect(primaryOfferingImage({ image_url: 'https://a/1.jpg' })).toBe('https://a/1.jpg');
  });

  it('merges primary + secondary up to 5 unique urls', () => {
    const images = resolveOfferingImages({
      image_url: 'https://a/1.jpg',
      secondary_images: [
        'https://a/2.jpg',
        'https://a/3.jpg',
        'https://a/1.jpg',
        'https://a/4.jpg',
        'https://a/5.jpg',
        'https://a/6.jpg',
      ],
    });
    expect(images).toHaveLength(MAX_OFFERING_IMAGES);
    expect(images).toEqual([
      'https://a/1.jpg',
      'https://a/2.jpg',
      'https://a/3.jpg',
      'https://a/4.jpg',
      'https://a/5.jpg',
    ]);
  });

  it('splits gallery with first as primary', () => {
    expect(splitOfferingImages([
      'https://a/1.jpg',
      'https://a/2.jpg',
      'https://a/3.jpg',
    ])).toEqual({
      image_url: 'https://a/1.jpg',
      secondary_images: ['https://a/2.jpg', 'https://a/3.jpg'],
    });
    expect(splitOfferingImages([])).toEqual({ image_url: null, secondary_images: [] });
  });

  it('enforces min 1 / max 5 guards', () => {
    expect(canAddOfferingImage(4)).toBe(true);
    expect(canAddOfferingImage(5)).toBe(false);
    expect(canRemoveOfferingImage(1)).toBe(false);
    expect(canRemoveOfferingImage(2)).toBe(true);
  });

  it('uses opportunity copy not forced upload copy', () => {
    expect(offeringImagesLabel(0)).toBe('Add up to 5 photos');
    expect(offeringImagesLabel(2)).toContain('Add up to 5 photos');
  });
});
