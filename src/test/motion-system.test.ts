import { describe, expect, it } from 'vitest';
import * as barrel from '@/lib/motion-variants';
import * as motionMod from '@/lib/motion';

describe('motion design system', () => {
  it('re-exports core tokens and presets from motion-variants barrel', () => {
    expect(barrel.durations.fast).toBe(0.15);
    expect(barrel.durations.normal).toBe(0.25);
    expect(barrel.easings.spring).toMatchObject({ type: 'spring' });
    expect(barrel.cardEntrance).toBeTruthy();
    expect(barrel.staggerContainer).toBeTruthy();
    expect(barrel.pageTransition).toBeTruthy();
    expect(barrel.badgePop).toBeTruthy();
    expect(barrel.imageReveal).toBeTruthy();
    expect(barrel.qtyPop).toBeTruthy();
    expect(barrel.modalTransition).toBeTruthy();
    expect(barrel.bottomSheetTransition).toBeTruthy();
    expect(barrel.skeletonToContent).toBeTruthy();
    expect(typeof barrel.prefersReducedMotion).toBe('function');
    expect(typeof barrel.getCardEntrance).toBe('function');
    expect(typeof barrel.getStaggerGrid).toBe('function');
    expect(barrel.STAGGER_CHILD_CAP).toBeGreaterThan(0);
  });

  it('keeps motion module and barrel API aligned for shared keys', () => {
    const shared = [
      'durations',
      'easings',
      'cardEntrance',
      'staggerGrid',
      'pageTransition',
      'imageReveal',
      'qtyPop',
    ] as const;
    for (const key of shared) {
      expect(motionMod[key]).toBeTruthy();
      expect(barrel[key]).toBeTruthy();
    }
  });
});
