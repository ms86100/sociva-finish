import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

function readSrc(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('Offer + Extra trip + Circles', () => {
  const mig = readSrc(
    'supabase/migrations/20261110210000_cleaner_city_offer_extra_circles.sql',
  );

  it('migration adds trip_kind and cancels live commute seats on pause/WFH', () => {
    expect(mig).toContain("trip_kind text NOT NULL DEFAULT 'commute'");
    expect(mig).toContain('cleaner_city_publish_extra_trip');
    expect(mig).toContain('prefer_circle_matching');
    expect(mig).toContain("status IN ('draft', 'published', 'full')");
    expect(mig).toContain("COALESCE(trip_kind, 'commute') = 'commute'");
    expect(mig).toContain('host_prefers_circle');
    expect(mig).toContain("'extra_trip'");
  });

  it('Offer is commute control with Extra CTA', () => {
    const offer = readSrc('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
    expect(offer).toContain('Weekday seats stay findable with Auto-offer');
    expect(offer).toContain('/cleaner-city/extra');
    expect(offer).toContain('Going somewhere else?');
    expect(offer).toContain('cleaner-city-offer-extra-cta');
  });

  it('Extra trip page publishes via dedicated RPC', () => {
    const page = readSrc('src/pages/cleaner-city/CleanerCityExtraTripPage.tsx');
    expect(page).toContain('usePublishExtraTrip');
    expect(page).toContain('cleaner-city-extra-publish');
    expect(page).toContain('overlapping commute seat');
    const app = readSrc('src/App.tsx');
    expect(app).toContain('/cleaner-city/extra');
  });

  it('Find splits Extra trips and shows badge', () => {
    const find = readSrc('src/pages/cleaner-city/CleanerCityFindPage.tsx');
    expect(find).toContain('extraMatches');
    expect(find).toContain('cleaner-city-extra-matches');
    const card = readSrc('src/components/cleaner-city/CleanerCityMatchCard.tsx');
    expect(card).toContain('cleaner-city-extra-trip-badge');
  });

  it('Circles keep society default and Prefer my circles', () => {
    const circles = readSrc('src/pages/cleaner-city/CleanerCityCirclesPage.tsx');
    expect(circles).toContain('Default Find is your society');
    expect(circles).toContain('prefer_circle');
    expect(circles).toContain('cleaner-city-prefer-circle');
    const hooks = readSrc('src/hooks/queries/useCleanerCity.ts');
    expect(hooks).toContain('p_prefer_circle');
    expect(hooks).toContain('usePublishExtraTrip');
  });
});
