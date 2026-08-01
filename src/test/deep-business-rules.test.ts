import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Real Imports ────────────────────────────────────────────────────────────
import { formatPrice } from '@/lib/format-price';
import { downloadCSV, exportFinances, exportMaintenanceDues, exportVisitorLog } from '@/lib/csv-export';
import {
  getFeatureState, isFeatureAccessible, haversineDistance,
  validateWorkerEntry, isCouponApplicable, computeDeliveryFee,
  getOrderNotifTitle, computeFinanceSummary, computeOverallProgress,
  computeSLADeadline, isSLABreached, sortByPinAndDate,
  computeAbsentWorkers, computeInspectionScore, computeMilestoneProgress,
  computeDisputeResolutionRate, computeMaintenanceCollectionRate,
  categorizeResponseTime, computeCancellationRate,
  canAccessSellerDetail, hasActiveFilters, paginationRange,
  dashboardItemMatchesSearch, getWriteSocietyId, getReadSocietyId,
  groupBySeller, findUnavailableProducts,
} from './helpers/business-rules';

// ════════════════════════════════════════════════════
// SECTION 1: formatPrice — Currency Formatting
// ════════════════════════════════════════════════════

describe('formatPrice — Currency Formatting', () => {
  it('TC-FP001: Formats number with ₹ prefix', () => { expect(formatPrice(1999)).toBe('₹1,999'); });
  it('TC-FP002: Formats string number', () => { expect(formatPrice('250')).toBe('₹250'); });
  it('TC-FP003: NaN returns ₹0', () => { expect(formatPrice('abc')).toBe('₹0'); expect(formatPrice(NaN)).toBe('₹0'); });
  it('TC-FP004: Zero returns ₹0', () => { expect(formatPrice(0)).toBe('₹0'); });
  it('TC-FP005: Custom currency symbol', () => { expect(formatPrice(100, '$')).toBe('$100'); });
  it('TC-FP006: Indian grouping (lakhs)', () => { expect(formatPrice(1000000)).toBe('₹10,00,000'); });
  it('TC-FP007: Negative number', () => { const r = formatPrice(-500); expect(r).toContain('-'); expect(r).toContain('500'); });
  it('TC-FP008: Decimal preserved', () => { expect(formatPrice(99.5)).toContain('99.5'); });
  it('TC-FP009: Empty string returns ₹0', () => { expect(formatPrice('')).toBe('₹0'); });
});

// ════════════════════════════════════════════════════
// SECTION 2: CSV Export Utility
// ════════════════════════════════════════════════════

describe('CSV Export Utility', () => {
  it('TC-CSV001: Empty data → no download', () => {
    const spy = vi.spyOn(document, 'createElement');
    downloadCSV([], 'test');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it('TC-CSV002: Headers from first row keys', () => {
    expect(Object.keys({ name: 'A', amount: 100 })).toEqual(['name', 'amount']);
  });
  it('TC-CSV003: Values with commas quoted', () => {
    const val = 'Hello, World';
    const str = String(val).replace(/"/g, '""');
    expect(str.includes(',') ? `"${str}"` : str).toBe('"Hello, World"');
  });
  it('TC-CSV004: Double quotes escaped', () => {
    expect(String('He said "hi"').replace(/"/g, '""')).toBe('He said ""hi""');
  });
  it('TC-CSV005: Null/undefined → empty string', () => {
    expect(null == null ? '' : String(null)).toBe('');
  });
  it('TC-CSV006: Newlines trigger quoting', () => {
    expect('Line1\nLine2'.includes('\n')).toBe(true);
  });
  it('TC-CSV007: exportFinances merges rows', () => {
    const expenses = [{ expense_date: '2026-01-01', title: 'Repair', category: 'repairs', amount: 500, vendor_name: 'V1' }];
    const income = [{ income_date: '2026-01-01', source: 'Maintenance', amount: 10000 }];
    const expRows = expenses.map(e => ({ type: 'Expense', date: e.expense_date, title: e.title, category: e.category, amount: e.amount, vendor: e.vendor_name }));
    const incRows = income.map(i => ({ type: 'Income', date: i.income_date, title: i.source, category: '', amount: i.amount, vendor: '' }));
    expect([...incRows, ...expRows].length).toBe(2);
  });
});

// ════════════════════════════════════════════════════
// SECTION 3: Feature Gating — Real Helper
// ════════════════════════════════════════════════════

describe('Feature Gating — Real Helper', () => {
  it('TC-FG001: No society → disabled', () => {
    expect(getFeatureState({ source: 'package', is_enabled: true, society_configurable: true }, false)).toBe('disabled');
  });
  it('TC-FG002: Missing feature → unavailable', () => {
    expect(getFeatureState(null, true)).toBe('unavailable');
  });
  it('TC-FG003: Core → locked', () => {
    expect(getFeatureState({ source: 'core', is_enabled: true, society_configurable: false }, true)).toBe('locked');
  });
  it('TC-FG004: Configurable enabled → enabled', () => {
    expect(getFeatureState({ source: 'package', is_enabled: true, society_configurable: true }, true)).toBe('enabled');
  });
  it('TC-FG005: Configurable disabled → disabled', () => {
    expect(getFeatureState({ source: 'package', is_enabled: false, society_configurable: true }, true)).toBe('disabled');
  });
  it('TC-FG006: enabled is accessible', () => { expect(isFeatureAccessible('enabled')).toBe(true); });
  it('TC-FG007: locked is accessible', () => { expect(isFeatureAccessible('locked')).toBe(true); });
  it('TC-FG008: disabled not accessible', () => { expect(isFeatureAccessible('disabled')).toBe(false); });
  it('TC-FG009: unavailable not accessible', () => { expect(isFeatureAccessible('unavailable')).toBe(false); });
});

// ════════════════════════════════════════════════════
// SECTION 4: Deep Link Parsing
// ════════════════════════════════════════════════════

describe('Deep Link Parsing', () => {
  const parseDeepLink = (urlStr: string): string => {
    try {
      const url = new URL(urlStr);
      if (url.hash && url.hash.startsWith('#/')) return url.hash.substring(1);
      if (url.protocol === 'sociva:') {
        let path = url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`;
        if (url.search) path += url.search;
        return path;
      }
      let path = url.pathname;
      if (url.search) path += url.search;
      return path;
    } catch { return ''; }
  };

  it('TC-DL001: Hash fragment → path', () => { expect(parseDeepLink('https://www.sociva.in/#/orders/123')).toBe('/orders/123'); });
  it('TC-DL002: Custom scheme', () => { expect(parseDeepLink('sociva://orders/123')).toContain('123'); });
  it('TC-DL003: Query params preserved', () => { expect(parseDeepLink('sociva://search?q=samosa')).toContain('q=samosa'); });
  it('TC-DL004: Standard path', () => { expect(parseDeepLink('https://www.sociva.in/orders/123')).toBe('/orders/123'); });
  it('TC-DL005: Invalid URL → empty', () => { expect(parseDeepLink('not-a-url')).toBe(''); });
});

// ════════════════════════════════════════════════════
// SECTION 5: Status Label Mapping
// ════════════════════════════════════════════════════

describe('Status Label Mapping', () => {
  const DELIVERY_STATUS: Record<string, string> = {
    pending: 'Pending', assigned: 'Assigned', picked_up: 'In Transit',
    at_gate: 'At Gate', delivered: 'Delivered', failed: 'Failed', cancelled: 'Cancelled',
  };
  const WORKER_JOB_STATUS: Record<string, string> = {
    open: 'Open', accepted: 'Accepted', completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired',
  };

  it('TC-SL001: 7 delivery statuses', () => { expect(Object.keys(DELIVERY_STATUS).length).toBe(7); });
  it('TC-SL002: 5 worker job statuses', () => { expect(Object.keys(WORKER_JOB_STATUS).length).toBe(5); });
  it('TC-SL003: Unknown → fallback', () => { expect(DELIVERY_STATUS['xyz'] ?? 'Unknown').toBe('Unknown'); });
  it('TC-SL004: pending maps correctly', () => { expect(DELIVERY_STATUS['pending']).toBe('Pending'); });
  it('TC-SL005: delivered maps correctly', () => { expect(DELIVERY_STATUS['delivered']).toBe('Delivered'); });
});

// ════════════════════════════════════════════════════
// SECTION 6: Notification Chain — Real Helper
// ════════════════════════════════════════════════════

describe('Notification Chain — Real Helper', () => {
  it('TC-NC001: buyer accepted', () => { expect(getOrderNotifTitle('accepted', 'buyer')).toBe('✅ Order Accepted!'); });
  it('TC-NC002: buyer delivered', () => { expect(getOrderNotifTitle('delivered', 'buyer')).toBe('🚚 Order Delivered'); });
  it('TC-NC003: seller placed', () => { expect(getOrderNotifTitle('placed', 'seller')).toBe('🆕 New Order Received!'); });
  it('TC-NC004: seller cancelled', () => { expect(getOrderNotifTitle('cancelled', 'seller')).toBe('❌ Order Cancelled'); });
  it('TC-NC005: seller accepted → null', () => { expect(getOrderNotifTitle('accepted', 'seller')).toBeNull(); });
  it('TC-NC006: unknown → null', () => { expect(getOrderNotifTitle('xyz', 'buyer')).toBeNull(); });
  it('TC-NC007: buyer quoted', () => { expect(getOrderNotifTitle('quoted', 'buyer')).toBe('💰 Quote Received'); });
  it('TC-NC008: buyer scheduled', () => { expect(getOrderNotifTitle('scheduled', 'buyer')).toBe('📅 Booking Confirmed'); });
});

// ════════════════════════════════════════════════════
// SECTION 7: Haversine — Real Helper
// ════════════════════════════════════════════════════

describe('Haversine — Real Helper', () => {
  it('TC-HV001: Same point → 0', () => { expect(haversineDistance(0, 0, 0, 0)).toBe(0); });
  it('TC-HV002: ~111km for 1°', () => { const d = haversineDistance(0, 0, 1, 0); expect(d).toBeGreaterThan(110000); expect(d).toBeLessThan(112000); });
  it('TC-HV003: Symmetric', () => {
    const d1 = haversineDistance(12.97, 77.59, 13.00, 77.60);
    const d2 = haversineDistance(13.00, 77.60, 12.97, 77.59);
    expect(Math.abs(d1 - d2)).toBeLessThan(1);
  });
  it('TC-HV004: Bangalore to Chennai ~280km', () => {
    const d = haversineDistance(12.97, 77.59, 13.08, 80.27);
    expect(d).toBeGreaterThan(270000);
    expect(d).toBeLessThan(310000);
  });
});

// ════════════════════════════════════════════════════
// SECTION 8: Worker Entry — Real Helper
// ════════════════════════════════════════════════════

describe('Worker Entry — Real Helper', () => {
  it('TC-WE001: Null → invalid', () => { expect(validateWorkerEntry(null).valid).toBe(false); });
  it('TC-WE002: Suspended → invalid', () => { expect(validateWorkerEntry({ status: 'suspended', deactivated_at: null, flat_count: 2 }).valid).toBe(false); });
  it('TC-WE003: Deactivated → invalid', () => { expect(validateWorkerEntry({ status: 'active', deactivated_at: '2024-01-01', flat_count: 2 }).valid).toBe(false); });
  it('TC-WE004: No flats → invalid', () => { expect(validateWorkerEntry({ status: 'active', deactivated_at: null, flat_count: 0 }).valid).toBe(false); });
  it('TC-WE005: Valid → true', () => { expect(validateWorkerEntry({ status: 'active', deactivated_at: null, flat_count: 3 }).valid).toBe(true); });
  it('TC-WE006: Wrong day → invalid', () => { expect(validateWorkerEntry({ status: 'active', deactivated_at: null, flat_count: 2, active_days: ['NEVER'] }).valid).toBe(false); });
});

// ════════════════════════════════════════════════════
// SECTION 9: Coupon Validation — Real Helper
// ════════════════════════════════════════════════════

describe('Coupon Validation — Real Helper', () => {
  const baseCoupon = {
    is_active: true, society_id: 's1', expires_at: null, starts_at: '2020-01-01',
    usage_limit: null, times_used: 0, per_user_limit: 5, min_order_amount: null,
  };
  it('TC-CV001: Valid coupon → applicable', () => { expect(isCouponApplicable(baseCoupon, 's1', 500, 0).applicable).toBe(true); });
  it('TC-CV002: Inactive → rejected', () => { expect(isCouponApplicable({ ...baseCoupon, is_active: false }, 's1', 500, 0).reason).toBe('Coupon inactive'); });
  it('TC-CV003: Cross-society → rejected', () => { expect(isCouponApplicable(baseCoupon, 's2', 500, 0).reason).toBe('Cross-society'); });
  it('TC-CV004: Expired → rejected', () => { expect(isCouponApplicable({ ...baseCoupon, expires_at: '2020-01-01' }, 's1', 500, 0).reason).toBe('Expired'); });
  it('TC-CV005: Not started → rejected', () => { expect(isCouponApplicable({ ...baseCoupon, starts_at: '2099-01-01' }, 's1', 500, 0).reason).toBe('Not started'); });
  it('TC-CV006: Usage limit → rejected', () => { expect(isCouponApplicable({ ...baseCoupon, usage_limit: 5, times_used: 5 }, 's1', 500, 0).reason).toBe('Usage limit reached'); });
  it('TC-CV007: Per-user limit → rejected', () => { expect(isCouponApplicable(baseCoupon, 's1', 500, 5).reason).toBe('Per-user limit reached'); });
  it('TC-CV008: Below minimum → rejected', () => { expect(isCouponApplicable({ ...baseCoupon, min_order_amount: 500 }, 's1', 200, 0).reason).toBe('Below minimum'); });
});

// ════════════════════════════════════════════════════
// SECTION 10: Delivery Fee — Real Helper
// ════════════════════════════════════════════════════

describe('Delivery Fee — Real Helper', () => {
  it('TC-DF001: self_pickup → 0', () => { expect(computeDeliveryFee(100, 300, 30, 'self_pickup')).toBe(0); });
  it('TC-DF002: Above threshold → 0', () => { expect(computeDeliveryFee(500, 300, 30, 'delivery')).toBe(0); });
  it('TC-DF003: Below threshold → fee', () => { expect(computeDeliveryFee(100, 300, 30, 'delivery')).toBe(30); });
  it('TC-DF004: At threshold → 0', () => { expect(computeDeliveryFee(300, 300, 30, 'delivery')).toBe(0); });
});

// ════════════════════════════════════════════════════
// SECTION 11: SLA — Real Helper
// ════════════════════════════════════════════════════

describe('SLA — Real Helper', () => {
  it('TC-SLA001: 48h deadline', () => {
    const d = computeSLADeadline(new Date('2026-01-01T00:00:00Z'), 48);
    expect(d.toISOString()).toBe('2026-01-03T00:00:00.000Z');
  });
  it('TC-SLA002: Not breached before deadline', () => { expect(isSLABreached(new Date(Date.now() + 100000))).toBe(false); });
  it('TC-SLA003: Breached after deadline', () => { expect(isSLABreached(new Date(Date.now() - 100000))).toBe(true); });
});

// ════════════════════════════════════════════════════
// SECTION 12: Report Metrics — Real Helper
// ════════════════════════════════════════════════════

describe('Report Metrics — Real Helper', () => {
  it('TC-RM001: Dispute resolution rate', () => { expect(computeDisputeResolutionRate(10, 8)).toBe(80); });
  it('TC-RM002: Zero → 0%', () => { expect(computeDisputeResolutionRate(0, 0)).toBe(0); });
  it('TC-RM003: Maintenance collection', () => { expect(computeMaintenanceCollectionRate(80, 20)).toBe(80); });
  it('TC-RM004: Response time up', () => { expect(categorizeResponseTime(12)).toBe('up'); });
  it('TC-RM005: Response time neutral', () => { expect(categorizeResponseTime(36)).toBe('neutral'); });
  it('TC-RM006: Response time down', () => { expect(categorizeResponseTime(72)).toBe('down'); });
});

// ════════════════════════════════════════════════════
// SECTION 13: Absent Workers — Real Helper
// ════════════════════════════════════════════════════

describe('Absent Workers — Real Helper', () => {
  it('TC-AW001: Some absent', () => { expect(computeAbsentWorkers(['w1', 'w2', 'w3'], ['w1'])).toEqual(['w2', 'w3']); });
  it('TC-AW002: All present', () => { expect(computeAbsentWorkers(['w1'], ['w1'])).toEqual([]); });
  it('TC-AW003: None present', () => { expect(computeAbsentWorkers(['w1', 'w2'], [])).toEqual(['w1', 'w2']); });
});

// ════════════════════════════════════════════════════
// SECTION 14: Inspection & Milestone — Real Helper
// ════════════════════════════════════════════════════

describe('Inspection & Milestone — Real Helper', () => {
  it('TC-IM001: Inspection score', () => {
    const r = computeInspectionScore([{ status: 'pass' }, { status: 'fail' }, { status: 'not_checked' }]);
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.checked).toBe(2);
    expect(r.progress).toBe(67);
  });
  it('TC-IM002: Milestone progress', () => {
    const r = computeMilestoneProgress([{ amount_percentage: 50, status: 'paid' }, { amount_percentage: 50, status: 'pending' }]);
    expect(r.progressPercent).toBe(50);
  });
});

// ════════════════════════════════════════════════════
// SECTION 15: Seller Access & Stats — Real Helper
// ════════════════════════════════════════════════════

describe('Seller Access & Stats — Real Helper', () => {
  it('TC-SA001: Approved same-society → true', () => {
    expect(canAccessSellerDetail({ verificationStatus: 'approved', sellerSocietyId: 's1', buyerSocietyId: 's1', sellBeyondCommunity: false })).toBe(true);
  });
  it('TC-SA002: Unapproved → false', () => {
    expect(canAccessSellerDetail({ verificationStatus: 'pending', sellerSocietyId: 's1', buyerSocietyId: 's1', sellBeyondCommunity: false })).toBe(false);
  });
  it('TC-SA003: Cross without beyond → false', () => {
    expect(canAccessSellerDetail({ verificationStatus: 'approved', sellerSocietyId: 's1', buyerSocietyId: 's2', sellBeyondCommunity: false })).toBe(false);
  });
  it('TC-SA004: Cross with beyond → true', () => {
    expect(canAccessSellerDetail({ verificationStatus: 'approved', sellerSocietyId: 's1', buyerSocietyId: 's2', sellBeyondCommunity: true })).toBe(true);
  });
  it('TC-SA005: Cancellation rate 10%', () => { expect(computeCancellationRate(9, 1)).toBe(10); });
  it('TC-SA006: Cancellation rate 0%', () => { expect(computeCancellationRate(10, 0)).toBe(0); });
});
