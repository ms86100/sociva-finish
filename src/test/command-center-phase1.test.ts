import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('admin command center phase 1', () => {
  const migration = read('supabase/migrations/20260829120000_admin_command_center_phase1.sql');
  const hook = read('src/hooks/useCommandCenter.ts');
  const page = read('src/pages/AdminCommandCenterPage.tsx');
  const app = read('src/App.tsx');
  const nav = read('src/components/admin/AdminSidebarNav.tsx');

  it('exposes snapshot and filtered list RPCs with admin guard', () => {
    expect(migration).toMatch(/FUNCTION public\.admin_get_command_center_snapshot/);
    expect(migration).toMatch(/FUNCTION public\.admin_list_sellers_filtered/);
    expect(migration).toMatch(/FUNCTION public\.admin_list_orders_filtered/);
    expect(migration).toMatch(/NOT public\.is_admin\(auth\.uid\(\)\)/);
    expect(migration).toMatch(/ready_surface/);
    expect(migration).toMatch(/pending_product_approvals/);
  });

  it('wires command center route and navigation', () => {
    expect(app).toMatch(/path="\/admin\/command-center"/);
    expect(nav).toMatch(/command-center/);
    expect(nav).toMatch(/\/admin\/command-center/);
  });

  it('uses snapshot and list RPCs from the client hook', () => {
    expect(hook).toMatch(/admin_get_command_center_snapshot/);
    expect(hook).toMatch(/admin_list_sellers_filtered/);
    expect(hook).toMatch(/admin_list_orders_filtered/);
  });

  it('renders KPI strip and drill-down lists', () => {
    expect(page).toMatch(/CommandCenterKpiStrip/);
    expect(page).toMatch(/CommandCenterSellersList/);
    expect(page).toMatch(/CommandCenterOrdersList/);
    expect(page).toMatch(/viewAsSocietyId/);
  });
});
