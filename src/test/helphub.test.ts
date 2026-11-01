import { describe, expect, it } from 'vitest';
import {
  filterHelpHubListings,
  HELPHUB_MOCK_LISTINGS,
  isActiveHelpHubListing,
} from '@/lib/helphub/mock-data';
import {
  formatHelpHubHours,
  HELPHUB_AVAILABILITY_DEFAULT_HOURS,
  HELPHUB_CONSENT_TEXT,
  HELPHUB_SOURCE_LABELS,
  normalizeHelpHubPhone,
  normalizeHelpHubTime,
} from '@/lib/helphub/constants';
import {
  createDemoCallFeedback,
  createDemoEnquiry,
  createDemoListing,
  getDemoListings,
  updateDemoListingStatus,
} from '@/lib/helphub/demo-store';
import { resolveNotificationRoute } from '@/lib/notification-routes';

describe('HelpHub directory filters', () => {
  it('hides expired and hired listings from active discovery', () => {
    const active = HELPHUB_MOCK_LISTINGS.filter(isActiveHelpHubListing);
    expect(active.every((l) => l.status === 'active')).toBe(true);
    expect(active.find((l) => l.id === 'hh-expired')).toBeUndefined();
    expect(active.find((l) => l.id === 'hh-hired')).toBeUndefined();
  });

  it('filters by category and keyword', () => {
    const cooks = filterHelpHubListings(HELPHUB_MOCK_LISTINGS, { category: 'cook' });
    expect(cooks.length).toBeGreaterThan(0);
    expect(cooks.every((l) => l.category === 'cook')).toBe(true);

    const priya = filterHelpHubListings(HELPHUB_MOCK_LISTINGS, { query: 'priya' });
    expect(priya.some((l) => l.display_name === 'Priya')).toBe(true);
  });

  it('uses resident recommendation labels without verified claims', () => {
    expect(HELPHUB_SOURCE_LABELS.resident_recommendation).toBe('Recommended by a resident');
    expect(HELPHUB_SOURCE_LABELS.self_registered).toBe('Self registered');
    expect(Object.values(HELPHUB_SOURCE_LABELS).join(' ')).not.toMatch(/verified|vetted/i);
  });
});

describe('HelpHub consent and lifecycle (demo store)', () => {
  it('rejects publish without consent', () => {
    expect(() =>
      createDemoListing(
        {
          display_name: 'Test',
          category: 'cook',
          work_type: 'part_time',
          availability: 'morning',
          source: 'resident_recommendation',
          consent_confirmed: false,
        },
        'user-1',
      ),
    ).toThrow(/consent/i);
  });

  it('creates listing with consent and allows mark hired', () => {
    const listing = createDemoListing(
      {
        display_name: 'Demo Cook',
        category: 'cook',
        work_type: 'part_time',
        availability: 'evening',
        source: 'resident_recommendation',
        consent_confirmed: true,
      },
      'user-owner',
      'Resident A',
    );
    expect(listing.status).toBe('active');
    expect(listing.recommender_name).toBe('Resident A');
    expect(HELPHUB_CONSENT_TEXT.toLowerCase()).toContain('agreed to be listed');

    const hired = updateDemoListingStatus(listing.id, 'hired', 'user-owner');
    expect(hired?.status).toBe('hired');
    const stillActive = filterHelpHubListings(getDemoListings(), {});
    expect(stillActive.find((l) => l.id === listing.id)).toBeUndefined();
  });

  it('dedupes pending enquiries from the same user', () => {
    const listing = createDemoListing(
      {
        display_name: 'Enquiry Target',
        category: 'maid',
        work_type: 'full_time',
        availability: 'flexible',
        source: 'self_registered',
        consent_confirmed: true,
      },
      'owner-2',
    );
    const first = createDemoEnquiry(listing.id, 'seeker-1');
    const second = createDemoEnquiry(listing.id, 'seeker-1');
    expect(second.id).toBe(first.id);
    expect(first.status).toBe('pending');
  });

  it('blocks unauthorized listing updates', () => {
    const listing = createDemoListing(
      {
        display_name: 'Protected',
        category: 'driver',
        work_type: 'hourly',
        availability: 'morning',
        source: 'self_registered',
        consent_confirmed: true,
      },
      'owner-3',
    );
    expect(() => updateDemoListingStatus(listing.id, 'removed', 'other-user')).toThrow(
      /not authorized/i,
    );
  });
});

describe('HelpHub hours helpers', () => {
  it('normalizes and formats from/to windows', () => {
    expect(normalizeHelpHubTime('7:00')).toBe('07:00');
    expect(normalizeHelpHubTime('12:30:00')).toBe('12:30');
    expect(normalizeHelpHubTime('bad')).toBeNull();
    expect(formatHelpHubHours('07:00', '11:00')).toBe('7:00 AM - 11:00 AM');
    expect(formatHelpHubHours('17:00', '21:00')).toBe('5:00 PM - 9:00 PM');
    expect(HELPHUB_AVAILABILITY_DEFAULT_HOURS.afternoon).toEqual({
      from: '12:00',
      to: '16:00',
    });
  });

  it('validates Indian mobile numbers for contact', () => {
    expect(normalizeHelpHubPhone('9876543210')).toBe('9876543210');
    expect(normalizeHelpHubPhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizeHelpHubPhone('12345')).toBeNull();
  });
});

describe('HelpHub call feedback (demo)', () => {
  it('requires a note for Other and stores outcomes', () => {
    expect(() =>
      createDemoCallFeedback('hh-1', 'user-fb', 'other'),
    ).toThrow(/short note/i);
    const row = createDemoCallFeedback('hh-1', 'user-fb', 'could_not_reach');
    expect(row.outcome).toBe('could_not_reach');
    expect(row.listing_id).toBe('hh-1');
  });

  it('persists available hours on create', () => {
    const listing = createDemoListing(
      {
        display_name: 'Hours Cook',
        category: 'cook',
        work_type: 'part_time',
        availability: 'morning',
        available_from: '07:00',
        available_to: '11:00',
        source: 'resident_recommendation',
        consent_confirmed: true,
        private_phone: '9876500099',
      },
      'user-hours',
      'Resident Hours',
    );
    expect(listing.available_from).toBe('07:00');
    expect(listing.available_to).toBe('11:00');
  });
});

describe('HelpHub notification routes', () => {
  it('routes enquiry notifications to listing detail', () => {
    expect(
      resolveNotificationRoute('helphub_enquiry', { listing_id: 'abc' }),
    ).toBe('/help-hub/listing/abc');
    expect(resolveNotificationRoute('helphub_expiry', {})).toBe('/help-hub');
  });
});

describe('HelpHub regression anchors', () => {
  it('keeps workforce hire route separate from HelpHub hub', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const appPath = path.resolve(process.cwd(), 'src/App.tsx');
    const src = fs.readFileSync(appPath, 'utf8');
    expect(src).toContain('path="/help-hub"');
    expect(src).toContain('path="/worker-hire"');
    expect(src).toContain('path="/workforce"');
    expect(src).toMatch(/domestic-help.*Navigate to="\/help-hub"/s);
  });
});
