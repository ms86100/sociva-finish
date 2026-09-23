import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('admin command center ops console (phases 0-4)', () => {
  const page = read('src/pages/AdminCommandCenterPage.tsx');
  const hook = read('src/hooks/useCommandCenter.ts');
  const kpi = read('src/components/admin/command-center/CommandCenterKpiStrip.tsx');
  const orders = read('src/components/admin/command-center/CommandCenterOrdersList.tsx');
  const enquiries = read('src/components/admin/command-center/CommandCenterEnquiriesList.tsx');
  const disputes = read('src/components/admin/command-center/CommandCenterDisputesList.tsx');
  const products = read('src/components/admin/command-center/CommandCenterProductsList.tsx');
  const store360 = read('src/components/admin/command-center/CommandCenterStore360Sheet.tsx');
  const attentionInbox = read('src/components/admin/command-center/CommandCenterAttentionInbox.tsx');
  const growth = read('src/components/admin/command-center/CommandCenterGrowthPanel.tsx');
  const trust = read('src/components/admin/command-center/CommandCenterTrustPanel.tsx');

  it('wires KPI trust helpers and drills', () => {
    expect(page).toMatch(/daysAgoIso/);
    expect(page).toMatch(/setDisputeStatus\('open'\)/);
    expect(page).toMatch(/setEnquiryStatus\('open'\)/);
    expect(page).toMatch(/setEnquiryStatus\('unanswered'\)/);
    expect(page).toMatch(/setOrderPaymentStatus\('pending_any'\)/);
    expect(page).toMatch(/ListVsKpi/);
    expect(page).toMatch(/useSearchParams/);
    expect(page).toMatch(/\/admin\/refunds/);
    expect(page).toMatch(/last 30 days/);
  });

  it('exposes pending_any and enquiry open/unanswered filters', () => {
    expect(orders).toMatch(/pending_any/);
    expect(orders).toMatch(/Payment pending \(any\)/);
    expect(enquiries).toMatch(/value="open"/);
    expect(enquiries).toMatch(/value="unanswered"/);
    expect(disputes).toMatch(/Open \(active\)/);
  });

  it('includes open_disputes and unanswered in Needs attention KPI', () => {
    expect(kpi).toMatch(/open_disputes/);
    expect(kpi).toMatch(/unanswered_enquiries/);
  });

  it('wires attention queue hook and inbox UI', () => {
    expect(hook).toMatch(/useCommandCenterAttentionQueue/);
    expect(hook).toMatch(/admin_list_attention_queue/);
    expect(attentionInbox).toMatch(/Attention queue/);
    expect(page).toMatch(/CommandCenterAttentionInbox/);
    expect(page).toMatch(/onDrillKind/);
  });

  it('wires growth and trust tabs', () => {
    expect(hook).toMatch(/useCommandCenterGrowth/);
    expect(hook).toMatch(/useCommandCenterReports/);
    expect(hook).toMatch(/admin_get_growth_snapshot/);
    expect(hook).toMatch(/admin_list_reports_filtered/);
    expect(page).toMatch(/value="growth"/);
    expect(page).toMatch(/value="trust"/);
    expect(growth).toMatch(/Growth snapshot/);
    expect(trust).toMatch(/Trust & reports/);
  });

  it('adds Store360 act-from-CC links and pending product admin open', () => {
    expect(store360).toMatch(/\/admin\?tab=sellers/);
    expect(store360).toMatch(/\/admin\/refunds/);
    expect(store360).toMatch(/\/admin\/stores\/\$\{sellerId\}/);
    expect(products).toMatch(/\/admin\/stores\/\$\{product\.seller_id\}/);
  });

  it('removes unused CommandCenterDrillContext', () => {
    expect(
      existsSync(
        resolve(__dirname, '../../src/components/admin/command-center/CommandCenterDrillContext.tsx'),
      ),
    ).toBe(false);
  });
});
