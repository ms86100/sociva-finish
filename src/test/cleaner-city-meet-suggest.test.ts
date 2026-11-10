import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { suggestSmartMeetSpot } from '@/lib/cleaner-city/meetSuggest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('smart meet spot suggestion', () => {
  it('same society prefers a nearby gate for guest walk', () => {
    const spot = suggestSmartMeetSpot({
      sameSociety: true,
      guestPickup: { lat: 13.0724, lng: 77.7515 },
      guestSocietyLabel: 'Shriram Greenfield Phase-2, Tower H',
      hostOrigin: { lat: 13.0724, lng: 77.7515 },
      hostPath: [
        { lat: 13.0724, lng: 77.7515 },
        { lat: 13.05, lng: 77.74 },
        { lat: 12.9879, lng: 77.7278 },
      ],
      societyGates: [
        {
          id: 'gate',
          label: 'Tower H gate',
          lat: 13.0721,
          lng: 77.7512,
          walkMeters: 120,
        },
      ],
    });
    expect(spot?.kind).toBe('society_gate');
    expect(spot?.label).toBe('Tower H gate');
    expect(spot?.sameSociety).toBe(true);
    expect(spot?.reason).toMatch(/Same society/i);
  });

  it('different society snaps guest onto host corridor', () => {
    const spot = suggestSmartMeetSpot({
      sameSociety: false,
      guestPickup: { lat: 13.06, lng: 77.745 },
      guestSocietyLabel: 'Another Society',
      hostOrigin: { lat: 13.0724, lng: 77.7515 },
      hostPath: [
        { lat: 13.0724, lng: 77.7515 },
        { lat: 13.06, lng: 77.745 },
        { lat: 12.9879, lng: 77.7278 },
      ],
      societyGates: [],
    });
    expect(spot?.kind).toBe('corridor_snap');
    expect(spot?.sameSociety).toBe(false);
    expect(spot?.label).toMatch(/your road/i);
    expect(spot?.reason).toMatch(/Different society/i);
  });

  it('meeting picker leads with app suggestion not GPS', () => {
    const picker = read('src/components/cleaner-city/CleanerCityMeetingPointPicker.tsx');
    expect(picker).toContain('Where guest walks to you');
    expect(picker).toContain('Confirm - guest walks here');
    expect(picker).toContain('Suggested on your road');
    expect(picker).toContain('Wrong gate? Pick another on your road');
    expect(picker).toContain('I am already at the gate');
    expect(picker).toContain('sameSociety');
    expect(picker).not.toContain('Like Uber and Hopr');
  });
});
