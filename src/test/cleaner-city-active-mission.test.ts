import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('Cleaner City active mission discovery', () => {
  it('hub mounts mission card + floating dock', () => {
    const hub = read('src/pages/cleaner-city/CleanerCityPage.tsx');
    expect(hub).toContain('CleanerCityActiveMissionCard');
    expect(hub).toContain('CleanerCityActiveMissionDock');
    expect(hub).toContain('cleaner-city-upcoming-section');
    expect(hub).toContain('cleaner-city-upcoming-ride');
    expect(hub).toContain('cleaner-city-upcoming-hosting');
  });

  it('mission card deep-links to the ride', () => {
    const card = read('src/components/cleaner-city/CleanerCityActiveMissionCard.tsx');
    expect(card).toContain('cleaner-city-active-ride-link');
    expect(card).toContain('cleaner-city-active-ride-dock');
    expect(card).toContain('Live mission');
    expect(card).toContain('/cleaner-city/ride/');
  });
});
