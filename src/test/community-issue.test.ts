import { describe, expect, it } from 'vitest';
import {
  CONVERTIBLE_CATEGORIES,
  ISSUE_ASK_COMMITTEE_MIN,
  ISSUE_TRAIL,
  ISSUE_VOTE_THRESHOLD,
  METER_CATEGORIES,
  getConvertedSnagId,
  getSnagStatus,
  isMeterCategory,
  snagDeepLink,
  trailIndexForStatus,
} from '@/lib/community-issue';

describe('community issue lifecycle helpers', () => {
  it('uses fixed 100-vote threshold and 25 ask-committee floor', () => {
    expect(ISSUE_VOTE_THRESHOLD).toBe(100);
    expect(ISSUE_ASK_COMMITTEE_MIN).toBe(25);
  });

  it('auto-meter only for maintenance and alert; find_help is manual convert', () => {
    expect(isMeterCategory('maintenance')).toBe(true);
    expect(isMeterCategory('alert')).toBe(true);
    expect(isMeterCategory('find_help')).toBe(false);
    expect(METER_CATEGORIES.has('find_help')).toBe(false);
    expect(CONVERTIBLE_CATEGORIES.has('find_help')).toBe(true);
  });

  it('reads converted snag id and status from structured', () => {
    expect(getConvertedSnagId(null)).toBeNull();
    expect(getConvertedSnagId({ converted_snag_id: 'abc' })).toBe('abc');
    expect(getSnagStatus({ snag_status: 'in_progress' })).toBe('in_progress');
  });

  it('maps live snag statuses onto trail chips', () => {
    expect(ISSUE_TRAIL.map((s) => s.key)).toEqual([
      'reported',
      'acknowledged',
      'in_progress',
      'resolved',
      'closed',
    ]);
    expect(trailIndexForStatus('resolved')).toBe(3);
    expect(trailIndexForStatus('closed')).toBe(4);
    expect(trailIndexForStatus('unknown')).toBe(0);
  });

  it('builds deep link for snag detail', () => {
    expect(snagDeepLink('uuid-1')).toBe('/society/snags?id=uuid-1');
  });
});
