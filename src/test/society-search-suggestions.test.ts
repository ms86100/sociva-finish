import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const migration = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20260903080000_search_relevance_and_society_popularity.sql'),
  'utf8',
);

describe('popular in your society', () => {
  it('excludes the viewer and requires two other people', () => {
    expect(migration).toMatch(/sdl\.user_id IS DISTINCT FROM auth\.uid\(\)/);
    expect(migration).toMatch(/COUNT\(DISTINCT sdl\.user_id\)/);
    expect(migration).toMatch(/HAVING COUNT\(DISTINCT sdl\.user_id\) >= 2/);
    expect(migration).toMatch(/sdl\.user_id IS NOT NULL/);
  });

  it('still only suggests successful recent society searches', () => {
    expect(migration).toMatch(/results_count, 0\) > 0/);
    expect(migration).toMatch(/interval '14 days'/);
  });
});
