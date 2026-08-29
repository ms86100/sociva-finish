import { describe, expect, it } from 'vitest';
import { cleanLocationTitle, formatLocationDisplay, shortStorePlaceLabel } from '@/lib/location-label-resolver';

describe('Location label resolver & display formatting', () => {
  describe('cleanLocationTitle', () => {
    it('extracts concise title from long postal addresses', () => {
      const raw = 'Shriram Greenfield Phase-2, Tower 4, Budigere Cross, Bengaluru, Karnataka 560049, India';
      expect(cleanLocationTitle(raw)).toBe('Shriram Greenfield Phase-2');
    });

    it('handles apartment/flat/tower prefixes gracefully', () => {
      const raw = 'Tower 4, Shriram Greenfield Phase-2, Budigere Cross, Bengaluru 560049';
      expect(cleanLocationTitle(raw)).toBe('Tower 4, Shriram Greenfield Phase-2');
    });

    it('cleans single-segment place names', () => {
      expect(cleanLocationTitle('Shriram Greenfield Phase-2')).toBe('Shriram Greenfield Phase-2');
      expect(cleanLocationTitle('Indiranagar, Bengaluru, Karnataka')).toBe('Indiranagar');
    });

    it('strips plus codes', () => {
      expect(cleanLocationTitle('8J2V+4X Bengaluru, Karnataka')).toBe('Bengaluru');
    });

    it('skips a leading house number so a postal dump does not become "2"', () => {
      expect(
        cleanLocationTitle('2, Shriram Greenfield Phase 1 Rd, Bendiganahalli, Bommenahalli, Karnataka 560049, India'),
      ).toBe('Shriram Greenfield Phase 1 Rd');
    });
  });

  describe('shortStorePlaceLabel', () => {
    it('prefers the society name over a full Google address', () => {
      const result = shortStorePlaceLabel({
        societyName: 'Shriram Greenfield Phase 1',
        storeLocationLabel: '2, Shriram Greenfield Phase 1 Rd, Bendiganahalli, Bommenahalli, Karnataka 560049, India',
      });
      expect(result.short).toBe('Shriram Greenfield Phase 1');
      expect(result.full).toMatch(/Bendiganahalli/);
    });
  });

  describe('formatLocationDisplay', () => {
    it('formats long address into primary title and secondary subtitle', () => {
      const raw = 'Shriram Greenfield Phase-2, Tower 4, Budigere Cross, Bengaluru, Karnataka 560049';
      const result = formatLocationDisplay(raw);
      expect(result.primary).toBe('Shriram Greenfield Phase-2');
      expect(result.secondary).toBe('Tower 4, Budigere Cross, Bengaluru');
      expect(result.fullFormatted).toBe(raw);
    });

    it('formats short label with separate full address', () => {
      const result = formatLocationDisplay('Home', {
        fullAddress: 'Tower 4, Flat 402, Shriram Greenfield Phase-2, Budigere Cross, Bengaluru 560049',
      });
      expect(result.primary).toBe('Home');
      expect(result.secondary).toBe('Tower 4, Flat 402, Shriram Greenfield Phase-2, Budigere Cross, Bengaluru');
    });

    it('handles coordinate fallback strings', () => {
      const result = formatLocationDisplay('13.0715, 77.7530');
      expect(result.primary).toBe('Current Location');
      expect(result.secondary).toBe('13.0715, 77.7530');
    });

    it('falls back to default placeholder if empty', () => {
      const result = formatLocationDisplay('');
      expect(result.primary).toBe('Set location');
    });
  });
});
