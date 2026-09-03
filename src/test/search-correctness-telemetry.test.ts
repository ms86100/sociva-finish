import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  committedSearchKey,
  getSessionQueryId,
  type SearchTelemetryFilters,
} from '@/lib/searchTelemetry';

const migration = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20260808072018_search_products_v2_telemetry.sql',
  ),
  'utf8',
);
const searchHook = readFileSync(
  resolve(__dirname, '../hooks/useSearchPage.ts'),
  'utf8',
);

const filters: SearchTelemetryFilters = {
  categories: ['snacks', 'home_food'],
  minRating: 4,
  isVeg: true,
  priceRange: [50, 500],
  sortBy: 'nearest',
  browseBeyond: true,
  radiusKm: 8,
};

describe('search correctness and committed telemetry', () => {
  it('normalizes query/category order into one deduplication key', () => {
    expect(committedSearchKey('  PANEER ', filters)).toBe(
      committedSearchKey('paneer', {
        ...filters,
        categories: ['home_food', 'snacks'],
      }),
    );
  });

  it('reuses one session query id for duplicate completed searches', () => {
    const createId = vi
      .fn()
      .mockReturnValueOnce('first-id')
      .mockReturnValueOnce('second-id');
    const cache = new Map<string, string>();

    expect(getSessionQueryId(cache, 'same-search', createId)).toBe('first-id');
    expect(getSessionQueryId(cache, 'same-search', createId)).toBe('first-id');
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it('keeps the legacy RPC and adds an empty-query-safe versioned RPC', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.search_products_v2/);
    expect(migration).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.search_products_fts/,
    );
    expect(migration).toMatch(/i\.term IS NULL\s+OR lower\(p\.name\)/);
  });

  it('enforces canonical seller, stock, radius, and community eligibility', () => {
    expect(migration).toMatch(/sp\.verification_status = 'approved'/);
    expect(migration).toMatch(/sp\.is_available = true/);
    expect(migration).toMatch(
      /p\.stock_quantity IS NULL OR p\.stock_quantity > 0/,
    );
    expect(migration).toMatch(
      /LEAST\(i\.radius_km, COALESCE\(sp\.delivery_radius_km, i\.radius_km\)\)/,
    );
    expect(migration).toMatch(/sp\.sell_beyond_community = true/);
  });

  it('logs only after retrieval and falls back immediately to legacy search', () => {
    const v2Call = searchHook.indexOf("rpc('search_products_v2'");
    const fallbackCall = searchHook.indexOf("rpc('search_products_fts'");
    const telemetryCall = searchHook.indexOf("rpc('log_committed_search'");

    expect(v2Call).toBeGreaterThan(-1);
    expect(fallbackCall).toBeGreaterThan(v2Call);
    expect(telemetryCall).toBeGreaterThan(fallbackCall);
    expect(searchHook).not.toMatch(
      /from\('search_demand_log'\)\.insert/,
    );
  });

  it('preserves typed spaces instead of hydrating a trimmed URL query', () => {
    expect(searchHook).toMatch(/resolveSearchQueryFromUrl/);
    expect(searchHook).not.toMatch(/searchParams\.get\('q'\)\?\.trim\(\)/);
  });

  it('deduplicates telemetry at the database boundary', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_search_demand_session_query/,
    );
    expect(migration).toMatch(
      /ON CONFLICT \(session_query_id\).*DO NOTHING/s,
    );
  });
});
