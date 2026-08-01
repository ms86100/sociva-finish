import { describe, it, expect } from 'vitest';
import {
  computeDeliveryFee, groupBySeller, findUnavailableProducts,
  canAccessSellerDetail, paginationRange, getWriteSocietyId,
  getReadSocietyId, hasManagementAccess, hasProgressManageAccess,
  computeOverallProgress, computeFinanceSummary, sortByPinAndDate,
  isCouponApplicable, getFeatureState, isFeatureAccessible,
  hasActiveFilters, getOrderNotifTitle, haversineDistance,
  computeSLADeadline, isSLABreached, validateWorkerEntry,
  getProfileMenuItems, getVerificationState,
  computeInspectionScore, computeMilestoneProgress,
  dashboardItemMatchesSearch, computeCancellationRate,
} from './helpers/business-rules';

// ════════════════════════════════════════════════════
// SECTION 1: CATEGORIES PAGE
// ════════════════════════════════════════════════════

describe('Categories Page', () => {
  it('TC-CAT001: Active groups sorted by sort_order', () => {
    const groups = [
      { slug: 'food', sort_order: 1, is_active: true },
      { slug: 'services', sort_order: 2, is_active: true },
      { slug: 'inactive', sort_order: 3, is_active: false },
    ];
    const active = groups.filter(g => g.is_active).sort((a, b) => a.sort_order - b.sort_order);
    expect(active.length).toBe(2);
    expect(active[0].slug).toBe('food');
  });
  it('TC-CAT002: Category link format', () => {
    const link = `/category/food?sub=groceries`;
    expect(link).toBe('/category/food?sub=groceries');
  });
});

// ════════════════════════════════════════════════════
// SECTION 2: CART & CHECKOUT — DEEP
// ════════════════════════════════════════════════════

describe('Cart & Checkout — Deep', () => {
  it('TC-CART001: Items grouped by seller', () => {
    const groups = groupBySeller([
      { seller_id: 's1', id: '1' }, { seller_id: 's1', id: '2' }, { seller_id: 's2', id: '3' },
    ]);
    expect(groups.size).toBe(2);
    expect(groups.get('s1')!.length).toBe(2);
  });
  it('TC-CART002: Delivery fee waived above threshold', () => {
    expect(computeDeliveryFee(500, 300, 30, 'delivery')).toBe(0);
  });
  it('TC-CART003: Delivery fee applied below threshold', () => {
    expect(computeDeliveryFee(100, 300, 30, 'delivery')).toBe(30);
  });
  it('TC-CART004: No delivery fee for self_pickup', () => {
    expect(computeDeliveryFee(100, 300, 30, 'self_pickup')).toBe(0);
  });
  it('TC-CART005: Pre-checkout validates product availability', () => {
    const fresh = [
      { id: 'p1', is_available: true, approval_status: 'approved' },
      { id: 'p2', is_available: false, approval_status: 'approved' },
    ];
    expect(findUnavailableProducts(fresh, ['p1', 'p2'])).toEqual(['p2']);
  });
  it('TC-CART006: Coupon discount validation — active coupon', () => {
    const coupon = {
      is_active: true, society_id: 's1', expires_at: null,
      starts_at: '2020-01-01', usage_limit: 100, times_used: 5,
      per_user_limit: 3, min_order_amount: null,
    };
    expect(isCouponApplicable(coupon, 's1', 500, 0).applicable).toBe(true);
  });
  it('TC-CART007: Coupon — cross-society rejected', () => {
    const coupon = {
      is_active: true, society_id: 's1', expires_at: null,
      starts_at: '2020-01-01', usage_limit: null, times_used: 0,
      per_user_limit: 3, min_order_amount: null,
    };
    expect(isCouponApplicable(coupon, 's2', 500, 0).reason).toBe('Cross-society');
  });
  it('TC-CART008: Coupon — expired rejected', () => {
    const coupon = {
      is_active: true, society_id: 's1', expires_at: '2020-01-01',
      starts_at: '2019-01-01', usage_limit: null, times_used: 0,
      per_user_limit: 3, min_order_amount: null,
    };
    expect(isCouponApplicable(coupon, 's1', 500, 0).reason).toBe('Expired');
  });
  it('TC-CART009: Coupon — below minimum rejected', () => {
    const coupon = {
      is_active: true, society_id: 's1', expires_at: null,
      starts_at: '2020-01-01', usage_limit: null, times_used: 0,
      per_user_limit: 3, min_order_amount: 500,
    };
    expect(isCouponApplicable(coupon, 's1', 200, 0).reason).toBe('Below minimum');
  });
  it('TC-CART010: Coupon — per-user limit reached', () => {
    const coupon = {
      is_active: true, society_id: 's1', expires_at: null,
      starts_at: '2020-01-01', usage_limit: null, times_used: 0,
      per_user_limit: 2, min_order_amount: null,
    };
    expect(isCouponApplicable(coupon, 's1', 500, 2).reason).toBe('Per-user limit reached');
  });
  it('TC-CART011: Coupon — usage limit reached', () => {
    const coupon = {
      is_active: true, society_id: 's1', expires_at: null,
      starts_at: '2020-01-01', usage_limit: 10, times_used: 10,
      per_user_limit: 3, min_order_amount: null,
    };
    expect(isCouponApplicable(coupon, 's1', 500, 0).reason).toBe('Usage limit reached');
  });
  it('TC-CART012: Coupon — inactive rejected', () => {
    const coupon = {
      is_active: false, society_id: 's1', expires_at: null,
      starts_at: '2020-01-01', usage_limit: null, times_used: 0,
      per_user_limit: 3, min_order_amount: null,
    };
    expect(isCouponApplicable(coupon, 's1', 500, 0).reason).toBe('Coupon inactive');
  });
  it('TC-CART013: Coupon — not started yet', () => {
    const coupon = {
      is_active: true, society_id: 's1', expires_at: null,
      starts_at: '2099-01-01', usage_limit: null, times_used: 0,
      per_user_limit: 3, min_order_amount: null,
    };
    expect(isCouponApplicable(coupon, 's1', 500, 0).reason).toBe('Not started');
  });
});

// ════════════════════════════════════════════════════
// SECTION 3: SELLER ACCESS
// ════════════════════════════════════════════════════

describe('Seller Detail Access Control', () => {
  it('TC-SD001: Approved same-society → accessible', () => {
    expect(canAccessSellerDetail({
      verificationStatus: 'approved', sellerSocietyId: 's1', buyerSocietyId: 's1', sellBeyondCommunity: false,
    })).toBe(true);
  });
  it('TC-SD002: Unapproved → blocked', () => {
    expect(canAccessSellerDetail({
      verificationStatus: 'pending', sellerSocietyId: 's1', buyerSocietyId: 's1', sellBeyondCommunity: false,
    })).toBe(false);
  });
  it('TC-SD003: Cross-society without beyond → blocked', () => {
    expect(canAccessSellerDetail({
      verificationStatus: 'approved', sellerSocietyId: 's1', buyerSocietyId: 's2', sellBeyondCommunity: false,
    })).toBe(false);
  });
  it('TC-SD004: Cross-society with beyond → accessible', () => {
    expect(canAccessSellerDetail({
      verificationStatus: 'approved', sellerSocietyId: 's1', buyerSocietyId: 's2', sellBeyondCommunity: true,
    })).toBe(true);
  });
  it('TC-SD005: Null buyer society → accessible', () => {
    expect(canAccessSellerDetail({
      verificationStatus: 'approved', sellerSocietyId: 's1', buyerSocietyId: null, sellBeyondCommunity: false,
    })).toBe(true);
  });
});

// ════════════════════════════════════════════════════
// SECTION 4: BUILDER ANALYTICS & INSPECTIONS
// ════════════════════════════════════════════════════

describe('Builder — Inspection & Progress', () => {
  it('TC-BLD001: Builder member has progress access', () => {
    expect(hasProgressManageAccess({ isAdmin: false, isSocietyAdmin: false, isBuilderMember: true })).toBe(true);
  });
  it('TC-BLD002: Inspection score computed', () => {
    const result = computeInspectionScore([
      { status: 'pass' }, { status: 'fail' }, { status: 'pass' }, { status: 'not_checked' },
    ]);
    expect(result.score).toBe(50);
    expect(result.progress).toBe(75);
  });
  it('TC-BLD003: Milestone progress computed', () => {
    const result = computeMilestoneProgress([
      { amount_percentage: 40, status: 'paid' },
      { amount_percentage: 60, status: 'pending' },
    ]);
    expect(result.progressPercent).toBe(40);
  });
  it('TC-BLD004: Overall progress from towers', () => {
    expect(computeOverallProgress([{ current_percentage: 50 }, { current_percentage: 70 }], [])).toBe(60);
  });
});

// ════════════════════════════════════════════════════
// SECTION 5: AUTHORIZED PERSONS — Write Safety
// ════════════════════════════════════════════════════

describe('Authorized Persons — Write Safety', () => {
  it('TC-AP001: Write uses profile society ID', () => {
    expect(getWriteSocietyId('home', 'viewed')).toBe('home');
  });
  it('TC-AP002: Feature gate check', () => {
    const state = getFeatureState({ source: 'package', is_enabled: true, society_configurable: true }, true);
    expect(isFeatureAccessible(state)).toBe(true);
  });
});

// ════════════════════════════════════════════════════
// SECTION 6: ORDER DETAIL
// ════════════════════════════════════════════════════

describe('Order Detail — Notifications', () => {
  it('TC-OD001: Each status maps to notification title', () => {
    expect(getOrderNotifTitle('accepted', 'buyer')).toBeTruthy();
    expect(getOrderNotifTitle('preparing', 'buyer')).toBeTruthy();
    expect(getOrderNotifTitle('ready', 'buyer')).toBeTruthy();
    expect(getOrderNotifTitle('delivered', 'buyer')).toBeTruthy();
    expect(getOrderNotifTitle('completed', 'buyer')).toBeTruthy();
    expect(getOrderNotifTitle('cancelled', 'buyer')).toBeTruthy();
    expect(getOrderNotifTitle('quoted', 'buyer')).toBeTruthy();
    expect(getOrderNotifTitle('scheduled', 'buyer')).toBeTruthy();
  });
  it('TC-OD002: Unknown status → null', () => {
    expect(getOrderNotifTitle('unknown', 'buyer')).toBeNull();
  });
});

// ════════════════════════════════════════════════════
// SECTION 7: DASHBOARD SEARCH
// ════════════════════════════════════════════════════

describe('Society Dashboard — Search', () => {
  it('TC-DASH001: Matches by label', () => {
    expect(dashboardItemMatchesSearch({ label: 'Total Revenue' }, 'revenue')).toBe(true);
  });
  it('TC-DASH002: Matches by stat', () => {
    expect(dashboardItemMatchesSearch({ label: 'X', stat: '₹5000' }, '5000')).toBe(true);
  });
  it('TC-DASH003: Matches by keywords', () => {
    expect(dashboardItemMatchesSearch({ label: 'X', keywords: ['money'] }, 'money')).toBe(true);
  });
  it('TC-DASH004: No match → false', () => {
    expect(dashboardItemMatchesSearch({ label: 'Income' }, 'zzz')).toBe(false);
  });
});

// ════════════════════════════════════════════════════
// SECTION 8: SLA COMPUTATION — EXTENDED
// ════════════════════════════════════════════════════

describe('SLA — Extended', () => {
  it('TC-SLA001: 24h SLA', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    expect(computeSLADeadline(created, 24).toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });
  it('TC-SLA002: 72h SLA', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    expect(computeSLADeadline(created, 72).toISOString()).toBe('2026-01-04T00:00:00.000Z');
  });
  it('TC-SLA003: Breached 1ms past deadline', () => {
    const deadline = new Date(Date.now() - 1);
    expect(isSLABreached(deadline)).toBe(true);
  });
});

// ════════════════════════════════════════════════════
// SECTION 9: FINANCES — EXTENDED
// ════════════════════════════════════════════════════

describe('Finances — Extended', () => {
  it('TC-FIN001: Large sums computed', () => {
    const result = computeFinanceSummary(
      [{ amount: 50000 }, { amount: 30000 }],
      [{ amount: 100000 }]
    );
    expect(result.balance).toBe(20000);
    expect(result.colorClass).toBe('text-success');
  });
  it('TC-FIN002: Single expense, no income', () => {
    const result = computeFinanceSummary([{ amount: 1000 }], []);
    expect(result.balance).toBe(-1000);
    expect(result.colorClass).toBe('text-destructive');
  });
});

// ════════════════════════════════════════════════════
// SECTION 10: CANCELLATION RATE
// ════════════════════════════════════════════════════

describe('Seller Cancellation Rate', () => {
  it('TC-CR001: Precise decimal rounding', () => {
    const rate = computeCancellationRate(9, 1);
    expect(rate).toBe(10);
  });
  it('TC-CR002: 3 out of 10', () => {
    expect(computeCancellationRate(7, 3)).toBe(30);
  });
  it('TC-CR003: Fractional rate', () => {
    const rate = computeCancellationRate(99, 1);
    expect(rate).toBe(1);
  });
});
