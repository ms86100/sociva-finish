import { describe, it, expect } from 'vitest';
import { resolveCommunityIntent } from '@/lib/community-intent';

describe('resolveCommunityIntent', () => {
  it('maps need a cook to find_help + cook', () => {
    const r = resolveCommunityIntent('I need a good cook who can prepare breakfast and lunch.');
    expect(r.primaryCategory).toBe('find_help');
    expect(r.serviceCategory).toBe('cook');
    expect(r.matchBand).not.toBe('none');
    expect(r.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it('maps looking for electrician to find_help', () => {
    const r = resolveCommunityIntent('Anyone knows a reliable electrician?');
    expect(r.primaryCategory).toBe('find_help');
    expect(r.serviceCategory).toBe('electrician');
  });

  it('maps maid / domestic help ask to find_help', () => {
    const r = resolveCommunityIntent('Looking for a maid for daily help.');
    expect(r.primaryCategory).toBe('find_help');
    expect(r.serviceCategory).toBe('maid');
  });

  it('maps recommendation of plumber to recommendation', () => {
    const r = resolveCommunityIntent('I highly recommend Ramesh, a great plumber in A block.');
    expect(r.primaryCategory).toBe('recommendation');
    expect(r.serviceCategory).toBe('plumber');
  });

  it('maps 2BHK rental to rent_sell', () => {
    const r = resolveCommunityIntent(
      'I have a 2BHK available for rent from December. Please contact me.',
    );
    expect(r.primaryCategory).toBe('rent_sell');
    expect(['strong', 'reasonable']).toContain(r.matchBand);
  });

  it('maps prasad / festival to event', () => {
    const r = resolveCommunityIntent('Prasad distribution at 6 PM near the clubhouse.');
    expect(r.primaryCategory).toBe('event');
  });

  it('maps lost car key to lost_found', () => {
    const r = resolveCommunityIntent('Lost my car key near the clubhouse.');
    expect(r.primaryCategory).toBe('lost_found');
  });

  it('maps selling sofa to buy_sell', () => {
    const r = resolveCommunityIntent('Selling my used sofa, second hand, good condition.');
    expect(r.primaryCategory).toBe('buy_sell');
  });

  it('maps water cut to alert', () => {
    const r = resolveCommunityIntent('Urgent: water cut tomorrow from 10am.');
    expect(r.primaryCategory).toBe('alert');
  });

  it('empty text is weak announcement', () => {
    const r = resolveCommunityIntent('   ');
    expect(r.matchBand).toBe('none');
    expect(r.primaryCategory).toBe('announcement');
  });

  it('suggests a title from the first line', () => {
    const r = resolveCommunityIntent('Looking for a cook\nDetails: breakfast only');
    expect(r.suggestedTitle).toBe('Looking for a cook');
  });

  it('never returns empty categories', () => {
    const r = resolveCommunityIntent('Hello neighbours, sharing a thought.');
    expect(r.categories.length).toBeGreaterThan(0);
    expect(r.primaryCategory).toBeTruthy();
  });
});
