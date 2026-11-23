import { describe, expect, it } from 'vitest';
import { assessPeacekeeperTone } from '@/lib/peacekeeper';

describe('peacekeeper', () => {
  it('allows calm neighbour posts without nudge', () => {
    const r = assessPeacekeeperTone('Lift in Tower B is stuck again. Can maintenance look today?');
    expect(r.needsNudge).toBe(false);
  });

  it('nudges aggressive tone and offers calmer rewrite', () => {
    const r = assessPeacekeeperTone('This stupid management is useless!!! Fix this garbage.');
    expect(r.needsNudge).toBe(true);
    expect(r.calmerVersion.toLowerCase()).not.toContain('stupid');
    expect(r.calmerVersion.toLowerCase()).not.toContain('garbage');
  });

  it('nudges threat-style comments like beat you to the death', () => {
    const r = assessPeacekeeperTone('what the hell you think about yourself. i will beat you to the death');
    expect(r.needsNudge).toBe(true);
    expect(r.calmerVersion.toLowerCase()).not.toContain('beat');
    expect(r.calmerVersion.toLowerCase()).not.toContain('hell');
  });

  it('never empties short inputs', () => {
    const r = assessPeacekeeperTone('hi');
    expect(r.needsNudge).toBe(false);
    expect(r.calmerVersion).toBe('hi');
  });
});
