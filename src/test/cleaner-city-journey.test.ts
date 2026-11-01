import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { journeyProgressPercent } from '@/components/cleaner-city/CommuteJourney';

describe('CommuteJourney progress', () => {
  it('fills the bar from completed steps, not XP remainder', () => {
    expect(journeyProgressPercent(5, 7)).toBe(71);
    expect(journeyProgressPercent(0, 7)).toBe(0);
    expect(journeyProgressPercent(7, 7)).toBe(100);
    expect(journeyProgressPercent(200 % 100, 7)).not.toBe(71);
  });

  it('wires percent fill and collapsed checklist', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/cleaner-city/CommuteJourney.tsx'),
      'utf8',
    );
    expect(src).toContain('cleaner-city-journey-progress-fill');
    expect(src).toContain('journeyProgressPercent');
    expect(src).toContain('See all steps');
    expect(src).not.toContain('xp % 100');
  });
});
