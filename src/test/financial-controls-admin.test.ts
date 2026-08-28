import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('admin financial controls', () => {
  const migration = read('supabase/migrations/20260828190000_admin_financial_controls_ui.sql');
  const completeMigration = read('supabase/migrations/20260828200000_financial_controls_complete.sql');
  const walletMigration = read('supabase/migrations/20260808062611_wallet_financial_operations.sql');
  const page = read('src/pages/AdminFinancialControlsPage.tsx');
  const hook = read('src/hooks/useFinancialControls.ts');
  const lib = read('src/lib/financial-controls.ts');
  const adjustments = read('src/components/admin/FinancialAdjustmentsPanel.tsx');
  const checklist = read('src/components/admin/PayoutEnablementChecklist.tsx');
  const app = read('src/App.tsx');
  const nav = read('src/components/admin/AdminSidebarNav.tsx');

  it('exposes admin snapshot RPC with maker-checker reject and cancel', () => {
    expect(migration).toMatch(/FUNCTION public\.admin_get_financial_controls_snapshot/);
    expect(migration).toMatch(/FUNCTION public\.reject_financial_control_change/);
    expect(migration).toMatch(/FUNCTION public\.cancel_financial_control_change/);
    expect(migration).toMatch(/maker cannot reject own financial control change/);
    expect(migration).toMatch(/only the requesting admin can cancel/);
  });

  it('completes adjustments workflow and admin notifications', () => {
    expect(completeMigration).toMatch(/notify_platform_admins_financial_review/);
    expect(completeMigration).toMatch(/reject_financial_adjustment/);
    expect(completeMigration).toMatch(/cancel_financial_adjustment/);
    expect(completeMigration).toMatch(/admin_list_ledger_account_codes/);
    expect(completeMigration).toMatch(/platform_admin_count/);
    expect(completeMigration).toMatch(/pending_adjustments/);
    expect(completeMigration).toMatch(/Financial control awaiting approval/);
  });

  it('keeps original request and approve RPCs for maker-checker', () => {
    expect(walletMigration).toMatch(/FUNCTION public\.request_financial_control_change/);
    expect(walletMigration).toMatch(/FUNCTION public\.approve_financial_control_change/);
    expect(walletMigration).toMatch(/maker cannot approve own financial control change/);
  });

  it('wires admin financial controls page and navigation badges', () => {
    expect(app).toMatch(/path="\/admin\/financial-controls"/);
    expect(nav).toMatch(/useAdminFinancialPendingCount/);
    expect(nav).toMatch(/financial-controls/);
  });

  it('uses snapshot, realtime, and control RPCs from the client hook', () => {
    expect(hook).toMatch(/admin_get_financial_controls_snapshot/);
    expect(hook).toMatch(/useFinancialControlsRealtime/);
    expect(hook).toMatch(/useAdminFinancialPendingCount/);
    expect(hook).toMatch(/request_financial_adjustment/);
    expect(hook).toMatch(/reject_financial_adjustment/);
  });

  it('documents payout enablement and ledger adjustments in the UI', () => {
    expect(page).toMatch(/PayoutEnablementChecklist/);
    expect(page).toMatch(/FinancialAdjustmentsPanel/);
    expect(page).toMatch(/platform_admin_count/);
    expect(checklist).toMatch(/buildPayoutEnablementSteps/);
    expect(adjustments).toMatch(/admin_list_ledger_account_codes/);
    expect(lib).toMatch(/buildPayoutEnablementSteps/);
  });
});
