import { describe, expect, it } from 'vitest';
import { locationAlignsWithBrowse } from '../buyerOrderLocation';

describe('locationAlignsWithBrowse', () => {
  it('treats a missing browse pin as aligned', () => {
    expect(locationAlignsWithBrowse(37.42, -122.08, null, null)).toBe(true);
  });

  it('rejects a saved pin in another city', () => {
    expect(locationAlignsWithBrowse(37.422, -122.084, 13.07159, 77.75303)).toBe(false);
  });

  it('accepts a saved pin within 2 km of the browse location', () => {
    expect(locationAlignsWithBrowse(13.07082, 77.75253, 13.07159, 77.75303)).toBe(true);
  });
});
