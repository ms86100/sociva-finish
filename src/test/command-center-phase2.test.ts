import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('admin command center phase 2', () => {
  const migration = read('supabase/migrations/20260829161000_admin_command_center_phase2.sql');
  const hook = read('src/hooks/useCommandCenter.ts');
  const page = read('src/pages/AdminCommandCenterPage.tsx');
  const kpi = read('src/components/admin/command-center/CommandCenterKpiStrip.tsx');
  const sellers = read('src/components/admin/command-center/CommandCenterSellersList.tsx');

  it('exposes products, bookings, and enquiries list RPCs with admin guard', () => {
    expect(migration).toMatch(/FUNCTION public\.admin_list_products_filtered/);
    expect(migration).toMatch(/FUNCTION public\.admin_list_bookings_filtered/);
    expect(migration).toMatch(/FUNCTION public\.admin_list_enquiries_filtered/);
    expect(migration).toMatch(/NOT public\.is_admin\(auth\.uid\(\)\)/);
    expect(migration).toMatch(/order_type = 'enquiry'/);
  });

  it('wires phase 2 list RPCs from the client hook', () => {
    expect(hook).toMatch(/admin_list_products_filtered/);
    expect(hook).toMatch(/admin_list_bookings_filtered/);
    expect(hook).toMatch(/admin_list_enquiries_filtered/);
    expect(hook).toMatch(/useCommandCenterProducts/);
    expect(hook).toMatch(/useCommandCenterBookings/);
    expect(hook).toMatch(/useCommandCenterEnquiries/);
  });

  it('renders phase 2 tabs and drill-down lists', () => {
    expect(page).toMatch(/CommandCenterProductsList/);
    expect(page).toMatch(/CommandCenterBookingsList/);
    expect(page).toMatch(/CommandCenterEnquiriesList/);
    expect(page).toMatch(/pending_products/);
    expect(page).toMatch(/complete/);
  });

  it('adds pending products KPI and society missing badge on stores', () => {
    expect(kpi).toMatch(/pending_products/);
    expect(sellers).toMatch(/No society/);
  });
});
