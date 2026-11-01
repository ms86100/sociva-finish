import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261102180000_cleaner_city_unit10_11_ratings_cost.sql'),
  'utf8',
);

describe('A Cleaner City Units 10-11 contracts', () => {
  it('allows participant ratings only after completion', () => {
    expect(migration).toContain('cleaner_city_submit_rating');
    expect(migration).toContain('Rate only after completion');
    expect(migration).toContain('ride_ratings_unique_pair');
  });

  it('keeps cost share on the ledger without settlement payout', () => {
    expect(migration).toContain('cleaner_city_propose_cost_share');
    expect(migration).toContain('cleaner_city_confirm_cost_share');
    expect(migration).toContain('no Razorpay/wallet settlement');
    expect(migration).toContain("status = 'accepted'");
    expect(migration).not.toContain('razorpay');
  });
});
