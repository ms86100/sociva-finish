import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

const SPEC_SECTIONS = [
  { id: 'snapshot', label: 'Society snapshot KPIs', migration: /admin_get_command_center_snapshot/, hook: /useCommandCenterSnapshot/, page: /CommandCenterKpiStrip/ },
  { id: 'stores', label: 'Stores list', migration: /admin_list_sellers_filtered/, hook: /useCommandCenterSellers/, page: /CommandCenterSellersList/ },
  { id: 'store_360', label: 'Store 360', migration: /admin_get_store_360/, hook: /useCommandCenterStore360/, page: /CommandCenterStore360Sheet/ },
  { id: 'orders', label: 'Orders list enriched', migration: /product_summary/, hook: /useCommandCenterOrders/, page: /CommandCenterOrdersList/ },
  { id: 'products', label: 'Products list', migration: /admin_list_products_filtered/, hook: /useCommandCenterProducts/, page: /CommandCenterProductsList/ },
  { id: 'bookings', label: 'Bookings list', migration: /admin_list_bookings_filtered/, hook: /useCommandCenterBookings/, page: /CommandCenterBookingsList/ },
  { id: 'enquiries', label: 'Enquiries enriched', migration: /seller_responded/, hook: /useCommandCenterEnquiries/, page: /CommandCenterEnquiriesList/ },
  { id: 'disputes', label: 'Disputes list', migration: /admin_list_disputes_filtered/, hook: /useCommandCenterDisputes/, page: /CommandCenterDisputesList/ },
  { id: 'categories', label: 'Category intelligence', migration: /admin_category_intelligence/, hook: /useCommandCenterCategoryIntelligence/, page: /CommandCenterCategoryIntelligence/ },
  { id: 'activity', label: 'Activity timeline', migration: /admin_list_activity_timeline/, hook: /useCommandCenterActivity/, page: /CommandCenterActivityFeed/ },
  { id: 'search', label: 'Global search', migration: /admin_global_search/, hook: /useCommandCenterGlobalSearch/, page: /CommandCenterGlobalSearch/ },
  { id: 'attention', label: 'Attention routing', migration: /unanswered_enquiries/, hook: /useCommandCenterSnapshot/, page: /attention/ },
  { id: 'drilldown', label: 'Drill-down chain', migration: /orders_30d/, hook: /CommandCenterSellerRow/, page: /drillToSeller/ },
  { id: 'society_scope', label: 'Society scoping', migration: /p_society_id/, hook: /p_society_id/, page: /SocietySwitcher/ },
  { id: 'admin_guard', label: 'Admin guard', migration: /NOT public\.is_admin/, hook: /admin_list_/, page: /CommandCenter/ },
  { id: 'complete_label', label: 'Phase complete marker', migration: /admin_category_intelligence/, hook: /Store360Data/, page: /complete/ },
] as const;

describe('admin command center complete spec audit', () => {
  const migrationPhase2 = read('supabase/migrations/20260829161000_admin_command_center_phase2.sql');
  const migrationPhase3 = read('supabase/migrations/20260829170000_admin_command_center_phase3_complete.sql');
  const migration = `${migrationPhase2}\n${migrationPhase3}`;
  const hook = read('src/hooks/useCommandCenter.ts');
  const page = read('src/pages/AdminCommandCenterPage.tsx');

  const results = SPEC_SECTIONS.map((section) => {
    const migrationOk = section.migration.test(migration);
    const hookOk = section.hook.test(hook);
    const pageOk = section.page.test(page);
    return { ...section, done: migrationOk && hookOk && pageOk, migrationOk, hookOk, pageOk };
  });

  it('reports 100% spec coverage (16/16 sections)', () => {
    const doneCount = results.filter((r) => r.done).length;
    const missing = results.filter((r) => !r.done);

    if (missing.length) {
      const report = missing
        .map((m) => `${m.id}: migration=${m.migrationOk} hook=${m.hookOk} page=${m.pageOk}`)
        .join('\n');
      throw new Error(`Command Center incomplete (${doneCount}/16):\n${report}`);
    }

    expect(doneCount).toBe(16);
  });

  it('migration has no duplicate function definitions', () => {
    const fns = migrationPhase3.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) || [];
    const names = fns.map((f) => f.replace('CREATE OR REPLACE FUNCTION public.', ''));
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('fixes orders hook payload bug', () => {
    const ordersFn = hook.slice(hook.indexOf('export function useCommandCenterOrders'));
    const ordersBody = ordersFn.slice(0, ordersFn.indexOf('export function useCommandCenterProducts'));
    expect(ordersBody).toMatch(/return listPayload<CommandCenterOrderRow>\(data\)/);
    expect(ordersBody).not.toMatch(/Number\(payload\.total/);
  });
});
