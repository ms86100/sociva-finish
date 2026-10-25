import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(
  resolve(__dirname, '../components/seller/StoreInsightsPanel.tsx'),
  'utf8',
);
const dashboard = readFileSync(
  resolve(__dirname, '../pages/SellerDashboardPage.tsx'),
  'utf8',
);
const reliability = readFileSync(
  resolve(__dirname, '../components/seller/SellerReliabilityScore.tsx'),
  'utf8',
);
const migration = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261025234500_seller_stats_live_search_clusters.sql'),
  'utf8',
);

describe('seller stats tab honesty', () => {
  it('labels live windows, money, and clustered nearby searches', () => {
    expect(panel).toMatch(/clusterSearchDemand/);
    expect(panel).toMatch(/Who searched nearby/);
    expect(panel).toMatch(/Recent orders/);
    expect(panel).toMatch(/formatPrice/);
    expect(panel).toMatch(/Orders right now/);
    expect(panel).toMatch(/Orders - last 30 days/);
    expect(panel).not.toMatch(/Searches with no results/);
    expect(dashboard).not.toMatch(/DemandInsights/);
    expect(panel).toMatch(/border-r-2/);
    expect(reliability).toMatch(/index % 3 !== 2 \? 'border-r-2 border-border'/);
    expect(dashboard).toMatch(/space-y-5/);
  });

  it('clusters catalog-related searches in SQL and drops keystroke prefixes on log', () => {
    expect(migration).toMatch(/similarity\(n\.term, t\.tok\) >= 0\.4/);
    expect(migration).toMatch(/length\(v_term\) < 3/);
    expect(migration).toMatch(/v_term LIKE btrim\(search_term\) \|\| '%'/);
    expect(migration).toMatch(/completed_30d/);
    expect(migration).toMatch(/settled_revenue_30d/);
    expect(migration).toMatch(/'searches'/);
  });
});
