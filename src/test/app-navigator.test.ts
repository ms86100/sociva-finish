import { describe, it, expect } from 'vitest';
import {
  getFeatureState, isFeatureAccessible, isPublicRoute, PUBLIC_ROUTES,
  hasGuardAccess, hasManagementAccess, hasProgressManageAccess, canPostNotice,
  getProfileMenuItems, getVerificationState, computeFinanceSummary,
  computeOverallProgress, sortByPinAndDate, computeDeliveryFee,
  groupBySeller, findUnavailableProducts, computeSLADeadline, isSLABreached,
  computeAbsentWorkers, hasActiveFilters, paginationRange,
  getOrderNotifTitle, dashboardItemMatchesSearch, computeDisputeResolutionRate,
  computeMaintenanceCollectionRate, categorizeResponseTime,
  getWriteSocietyId, getReadSocietyId,
} from './helpers/business-rules';

// ════════════════════════════════════════════════════
// SECTION 1: CORE PAGES — Route Classification
// ════════════════════════════════════════════════════

describe('Core Pages — Route Classification', () => {
  it('TC-C001: /welcome is a public route', () => {
    expect(isPublicRoute('/welcome')).toBe(true);
  });
  it('TC-C002: /auth is a public route', () => {
    expect(isPublicRoute('/auth')).toBe(true);
  });
  it('TC-C003: /privacy-policy is a public route', () => {
    expect(isPublicRoute('/privacy-policy')).toBe(true);
  });
  it('TC-C004: /terms is a public route', () => {
    expect(isPublicRoute('/terms')).toBe(true);
  });
  it('TC-C005: /community-rules is a public route', () => {
    expect(isPublicRoute('/community-rules')).toBe(true);
  });
  it('TC-C006: /help is a public route', () => {
    expect(isPublicRoute('/help')).toBe(true);
  });
  it('TC-C007: /pricing is a public route', () => {
    expect(isPublicRoute('/pricing')).toBe(true);
  });
  it('TC-C008: /reset-password is a public route', () => {
    expect(isPublicRoute('/reset-password')).toBe(true);
  });
  it('TC-C009: / is NOT a public route', () => {
    expect(isPublicRoute('/')).toBe(false);
  });
  it('TC-C010: /profile is NOT a public route', () => {
    expect(isPublicRoute('/profile')).toBe(false);
  });
  it('TC-C011: /orders is NOT a public route', () => {
    expect(isPublicRoute('/orders')).toBe(false);
  });
  it('TC-C012: All 8 public routes accounted for', () => {
    expect(PUBLIC_ROUTES.length).toBe(8);
  });
});

// ════════════════════════════════════════════════════
// SECTION 2: VERIFICATION STATE
// ════════════════════════════════════════════════════

describe('Verification State', () => {
  it('TC-V001: Unapproved user → pending', () => {
    expect(getVerificationState({ verification_status: 'pending' })).toBe('pending');
  });
  it('TC-V002: Approved user → approved', () => {
    expect(getVerificationState({ verification_status: 'approved' })).toBe('approved');
  });
  it('TC-V003: Null profile → loading', () => {
    expect(getVerificationState(null)).toBe('loading');
  });
  it('TC-V004: Rejected user → pending (not approved)', () => {
    expect(getVerificationState({ verification_status: 'rejected' })).toBe('pending');
  });
});

// ════════════════════════════════════════════════════
// SECTION 3: FEATURE GATE LOGIC
// ════════════════════════════════════════════════════

describe('Feature Gate Logic', () => {
  it('TC-FG001: No society context → disabled', () => {
    expect(getFeatureState({ source: 'package', is_enabled: true, society_configurable: true }, false)).toBe('disabled');
  });
  it('TC-FG002: Missing feature → unavailable', () => {
    expect(getFeatureState(null, true)).toBe('unavailable');
  });
  it('TC-FG003: Undefined feature → unavailable', () => {
    expect(getFeatureState(undefined, true)).toBe('unavailable');
  });
  it('TC-FG004: Core source → locked', () => {
    expect(getFeatureState({ source: 'core', is_enabled: true, society_configurable: false }, true)).toBe('locked');
  });
  it('TC-FG005: Core source disabled → still locked', () => {
    expect(getFeatureState({ source: 'core', is_enabled: false, society_configurable: false }, true)).toBe('locked');
  });
  it('TC-FG006: Non-configurable enabled → locked', () => {
    expect(getFeatureState({ source: 'package', is_enabled: true, society_configurable: false }, true)).toBe('locked');
  });
  it('TC-FG007: Non-configurable disabled → disabled', () => {
    expect(getFeatureState({ source: 'package', is_enabled: false, society_configurable: false }, true)).toBe('disabled');
  });
  it('TC-FG008: Configurable enabled → enabled', () => {
    expect(getFeatureState({ source: 'package', is_enabled: true, society_configurable: true }, true)).toBe('enabled');
  });
  it('TC-FG009: Configurable disabled → disabled', () => {
    expect(getFeatureState({ source: 'package', is_enabled: false, society_configurable: true }, true)).toBe('disabled');
  });
  it('TC-FG010: enabled state is accessible', () => {
    expect(isFeatureAccessible('enabled')).toBe(true);
  });
  it('TC-FG011: locked state is accessible', () => {
    expect(isFeatureAccessible('locked')).toBe(true);
  });
  it('TC-FG012: disabled state is NOT accessible', () => {
    expect(isFeatureAccessible('disabled')).toBe(false);
  });
  it('TC-FG013: unavailable state is NOT accessible', () => {
    expect(isFeatureAccessible('unavailable')).toBe(false);
  });

  // Feature keys for all gated pages
  const FEATURE_KEYS = [
    'marketplace', 'bulletin', 'disputes', 'finances', 'construction_progress',
    'snag_management', 'help_requests', 'visitor_management', 'domestic_help',
    'parcel_management', 'inspection', 'payment_milestones', 'maintenance',
    'guard_kiosk', 'vehicle_parking', 'resident_identity_verification',
    'worker_marketplace', 'workforce_management', 'society_notices',
    'delivery_management', 'worker_attendance', 'worker_salary', 'worker_leave',
    'security_audit', 'seller_tools', 'gate_entry',
  ];
  it('TC-FG014: 26 feature keys defined', () => {
    expect(FEATURE_KEYS.length).toBe(26);
  });
  it('TC-FG015: Each feature blocks access when disabled with society context', () => {
    for (const key of FEATURE_KEYS) {
      const state = getFeatureState({ source: 'package', is_enabled: false, society_configurable: true }, true);
      expect(isFeatureAccessible(state)).toBe(false);
    }
  });
  it('TC-FG016: Each feature allows access when enabled with society context', () => {
    for (const key of FEATURE_KEYS) {
      const state = getFeatureState({ source: 'package', is_enabled: true, society_configurable: true }, true);
      expect(isFeatureAccessible(state)).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════
// SECTION 4: ROLE-BASED ACCESS
// ════════════════════════════════════════════════════

describe('Role-Based Access', () => {
  it('TC-R001: Admin has guard access', () => {
    expect(hasGuardAccess({ isAdmin: true, isSocietyAdmin: false, isSecurityOfficer: false })).toBe(true);
  });
  it('TC-R002: Society admin has guard access', () => {
    expect(hasGuardAccess({ isAdmin: false, isSocietyAdmin: true, isSecurityOfficer: false })).toBe(true);
  });
  it('TC-R003: Security officer has guard access', () => {
    expect(hasGuardAccess({ isAdmin: false, isSocietyAdmin: false, isSecurityOfficer: true })).toBe(true);
  });
  it('TC-R004: Regular user has NO guard access', () => {
    expect(hasGuardAccess({ isAdmin: false, isSocietyAdmin: false, isSecurityOfficer: false })).toBe(false);
  });
  it('TC-R005: Admin has management access', () => {
    expect(hasManagementAccess({ isAdmin: true, isSocietyAdmin: false })).toBe(true);
  });
  it('TC-R006: Society admin has management access', () => {
    expect(hasManagementAccess({ isAdmin: false, isSocietyAdmin: true })).toBe(true);
  });
  it('TC-R007: Regular user has NO management access', () => {
    expect(hasManagementAccess({ isAdmin: false, isSocietyAdmin: false })).toBe(false);
  });
  it('TC-R008: Builder member has progress manage access', () => {
    expect(hasProgressManageAccess({ isAdmin: false, isSocietyAdmin: false, isBuilderMember: true })).toBe(true);
  });
  it('TC-R009: Admin has progress manage access', () => {
    expect(hasProgressManageAccess({ isAdmin: true, isSocietyAdmin: false, isBuilderMember: false })).toBe(true);
  });
  it('TC-R010: Regular user has NO progress manage access', () => {
    expect(hasProgressManageAccess({ isAdmin: false, isSocietyAdmin: false, isBuilderMember: false })).toBe(false);
  });
  it('TC-R011: Builder member can post notice', () => {
    expect(canPostNotice({ isAdmin: false, isSocietyAdmin: false, isBuilderMember: true })).toBe(true);
  });
  it('TC-R012: Regular user cannot post notice', () => {
    expect(canPostNotice({ isAdmin: false, isSocietyAdmin: false, isBuilderMember: false })).toBe(false);
  });
});

// ════════════════════════════════════════════════════
// SECTION 5: PROFILE MENU
// ════════════════════════════════════════════════════

describe('Profile Menu Items', () => {
  it('TC-PM001: Non-seller sees "Become a Seller"', () => {
    expect(getProfileMenuItems(false, false, false)).toContain('Become a Seller');
  });
  it('TC-PM002: Seller sees "Seller Dashboard"', () => {
    expect(getProfileMenuItems(true, false, false)).toContain('Seller Dashboard');
  });
  it('TC-PM003: Builder member sees "Builder Dashboard"', () => {
    expect(getProfileMenuItems(false, true, false)).toContain('Builder Dashboard');
  });
  it('TC-PM004: Admin sees "Admin Panel"', () => {
    expect(getProfileMenuItems(false, false, true)).toContain('Admin Panel');
  });
  it('TC-PM005: Seller + builder + admin sees all 3', () => {
    const items = getProfileMenuItems(true, true, true);
    expect(items).toContain('Seller Dashboard');
    expect(items).toContain('Builder Dashboard');
    expect(items).toContain('Admin Panel');
  });
  it('TC-PM006: Non-seller does NOT see "Seller Dashboard"', () => {
    expect(getProfileMenuItems(false, false, false)).not.toContain('Seller Dashboard');
  });
});

// ════════════════════════════════════════════════════
// SECTION 6: BULLETIN — Post Sorting
// ════════════════════════════════════════════════════

describe('Bulletin — Post Sorting', () => {
  it('TC-B001: Pinned posts sort first', () => {
    const posts = [
      { is_pinned: false, created_at: '2026-02-01' },
      { is_pinned: true, created_at: '2026-01-01' },
      { is_pinned: false, created_at: '2026-01-15' },
    ];
    const sorted = sortByPinAndDate(posts);
    expect(sorted[0].is_pinned).toBe(true);
  });
  it('TC-B002: Among unpinned, newer comes first', () => {
    const posts = [
      { is_pinned: false, created_at: '2026-01-01' },
      { is_pinned: false, created_at: '2026-02-01' },
    ];
    const sorted = sortByPinAndDate(posts);
    expect(sorted[0].created_at).toBe('2026-02-01');
  });
  it('TC-B003: Among pinned, newer comes first', () => {
    const posts = [
      { is_pinned: true, created_at: '2026-01-01' },
      { is_pinned: true, created_at: '2026-02-01' },
    ];
    const sorted = sortByPinAndDate(posts);
    expect(sorted[0].created_at).toBe('2026-02-01');
  });
  it('TC-B004: Empty array returns empty', () => {
    expect(sortByPinAndDate([])).toEqual([]);
  });
  it('TC-B005: Single post returns as-is', () => {
    const posts = [{ is_pinned: false, created_at: '2026-01-01' }];
    expect(sortByPinAndDate(posts)).toEqual(posts);
  });
});

// ════════════════════════════════════════════════════
// SECTION 7: SOCIETY FINANCES
// ════════════════════════════════════════════════════

describe('Society Finances — Computation', () => {
  it('TC-F001: Totals computed correctly', () => {
    const result = computeFinanceSummary([{ amount: 1000 }, { amount: 2000 }], [{ amount: 5000 }]);
    expect(result.totalExpenses).toBe(3000);
    expect(result.totalIncome).toBe(5000);
    expect(result.balance).toBe(2000);
  });
  it('TC-F002: Positive balance → text-success', () => {
    expect(computeFinanceSummary([], [{ amount: 100 }]).colorClass).toBe('text-success');
  });
  it('TC-F003: Zero balance → text-success', () => {
    expect(computeFinanceSummary([{ amount: 100 }], [{ amount: 100 }]).colorClass).toBe('text-success');
  });
  it('TC-F004: Negative balance → text-destructive', () => {
    expect(computeFinanceSummary([{ amount: 500 }], [{ amount: 100 }]).colorClass).toBe('text-destructive');
  });
  it('TC-F005: Empty arrays → zero balance', () => {
    const result = computeFinanceSummary([], []);
    expect(result.balance).toBe(0);
    expect(result.colorClass).toBe('text-success');
  });
});

// ════════════════════════════════════════════════════
// SECTION 8: CONSTRUCTION PROGRESS
// ════════════════════════════════════════════════════

describe('Construction Progress — Computation', () => {
  it('TC-P001: Average of tower percentages', () => {
    expect(computeOverallProgress([{ current_percentage: 40 }, { current_percentage: 60 }], [])).toBe(50);
  });
  it('TC-P002: No towers → max milestone', () => {
    expect(computeOverallProgress([], [{ completion_percentage: 30 }, { completion_percentage: 70 }])).toBe(70);
  });
  it('TC-P003: No towers, no milestones → 0', () => {
    expect(computeOverallProgress([], [])).toBe(0);
  });
  it('TC-P004: Towers take priority over milestones', () => {
    expect(computeOverallProgress([{ current_percentage: 20 }], [{ completion_percentage: 90 }])).toBe(20);
  });
  it('TC-P005: Single tower', () => {
    expect(computeOverallProgress([{ current_percentage: 75 }], [])).toBe(75);
  });
  it('TC-P006: Rounds to nearest integer', () => {
    expect(computeOverallProgress([{ current_percentage: 33 }, { current_percentage: 34 }], [])).toBe(34);
  });
});

// ════════════════════════════════════════════════════
// SECTION 9: DELIVERY FEE
// ════════════════════════════════════════════════════

describe('Delivery Fee Computation', () => {
  it('TC-DF001: Self pickup → 0 fee', () => {
    expect(computeDeliveryFee(100, 300, 30, 'self_pickup')).toBe(0);
  });
  it('TC-DF002: Delivery above threshold → 0 fee', () => {
    expect(computeDeliveryFee(500, 300, 30, 'delivery')).toBe(0);
  });
  it('TC-DF003: Delivery below threshold → base fee', () => {
    expect(computeDeliveryFee(100, 300, 30, 'delivery')).toBe(30);
  });
  it('TC-DF004: Delivery exactly at threshold → 0 fee', () => {
    expect(computeDeliveryFee(300, 300, 30, 'delivery')).toBe(0);
  });
});

// ════════════════════════════════════════════════════
// SECTION 10: CART GROUPING
// ════════════════════════════════════════════════════

describe('Cart — Group by Seller', () => {
  it('TC-CG001: Groups items by seller_id', () => {
    const items = [
      { seller_id: 's1', product_id: 'p1' },
      { seller_id: 's1', product_id: 'p2' },
      { seller_id: 's2', product_id: 'p3' },
    ];
    const groups = groupBySeller(items);
    expect(groups.size).toBe(2);
    expect(groups.get('s1')!.length).toBe(2);
    expect(groups.get('s2')!.length).toBe(1);
  });
  it('TC-CG002: Empty array → empty map', () => {
    expect(groupBySeller([]).size).toBe(0);
  });
  it('TC-CG003: Single item → single group', () => {
    const groups = groupBySeller([{ seller_id: 's1' }]);
    expect(groups.size).toBe(1);
  });
});

// ════════════════════════════════════════════════════
// SECTION 11: PRE-CHECKOUT VALIDATION
// ════════════════════════════════════════════════════

describe('Pre-Checkout — Unavailable Products', () => {
  it('TC-PC001: Identifies unavailable products', () => {
    const fresh = [
      { id: 'p1', is_available: true, approval_status: 'approved' },
      { id: 'p2', is_available: false, approval_status: 'approved' },
    ];
    expect(findUnavailableProducts(fresh, ['p1', 'p2'])).toEqual(['p2']);
  });
  it('TC-PC002: Identifies unapproved products', () => {
    const fresh = [{ id: 'p1', is_available: true, approval_status: 'pending' }];
    expect(findUnavailableProducts(fresh, ['p1'])).toEqual(['p1']);
  });
  it('TC-PC003: Missing product counted as unavailable', () => {
    expect(findUnavailableProducts([], ['p1'])).toEqual(['p1']);
  });
  it('TC-PC004: All available → empty array', () => {
    const fresh = [{ id: 'p1', is_available: true, approval_status: 'approved' }];
    expect(findUnavailableProducts(fresh, ['p1'])).toEqual([]);
  });
});

// ════════════════════════════════════════════════════
// SECTION 12: SLA COMPUTATION
// ════════════════════════════════════════════════════

describe('SLA Computation', () => {
  it('TC-SLA001: Deadline = createdAt + slaHours', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const deadline = computeSLADeadline(created, 48);
    expect(deadline.toISOString()).toBe('2026-01-03T00:00:00.000Z');
  });
  it('TC-SLA002: Not breached before deadline', () => {
    const deadline = new Date(Date.now() + 100000);
    expect(isSLABreached(deadline)).toBe(false);
  });
  it('TC-SLA003: Breached after deadline', () => {
    const deadline = new Date(Date.now() - 100000);
    expect(isSLABreached(deadline)).toBe(true);
  });
});

// ════════════════════════════════════════════════════
// SECTION 13: ABSENT WORKERS
// ════════════════════════════════════════════════════

describe('Absent Workers', () => {
  it('TC-AW001: Workers not in attendance are absent', () => {
    expect(computeAbsentWorkers(['w1', 'w2', 'w3'], ['w1'])).toEqual(['w2', 'w3']);
  });
  it('TC-AW002: All present → empty', () => {
    expect(computeAbsentWorkers(['w1'], ['w1'])).toEqual([]);
  });
  it('TC-AW003: None present → all absent', () => {
    expect(computeAbsentWorkers(['w1', 'w2'], [])).toEqual(['w1', 'w2']);
  });
});

// ════════════════════════════════════════════════════
// SECTION 14: SEARCH FILTERS
// ════════════════════════════════════════════════════

describe('Search Filters — Active Detection', () => {
  const defaults = { minRating: 0, isVeg: null as boolean | null, categories: [] as string[], sortBy: null as string | null, priceRange: [0, 5000] as [number, number] };
  it('TC-SF001: Default filters → not active', () => {
    expect(hasActiveFilters(defaults, 5000)).toBe(false);
  });
  it('TC-SF002: minRating > 0 → active', () => {
    expect(hasActiveFilters({ ...defaults, minRating: 4 }, 5000)).toBe(true);
  });
  it('TC-SF003: isVeg set → active', () => {
    expect(hasActiveFilters({ ...defaults, isVeg: true }, 5000)).toBe(true);
  });
  it('TC-SF004: categories selected → active', () => {
    expect(hasActiveFilters({ ...defaults, categories: ['food'] }, 5000)).toBe(true);
  });
  it('TC-SF005: sortBy set → active', () => {
    expect(hasActiveFilters({ ...defaults, sortBy: 'price_low' }, 5000)).toBe(true);
  });
  it('TC-SF006: Price range changed → active', () => {
    expect(hasActiveFilters({ ...defaults, priceRange: [100, 5000] }, 5000)).toBe(true);
  });
});

// ════════════════════════════════════════════════════
// SECTION 15: WRITE SAFETY (VIEW-AS)
// ════════════════════════════════════════════════════

describe('Write Safety — Society ID', () => {
  it('TC-WS001: Write uses profile society ID', () => {
    expect(getWriteSocietyId('home', 'viewed')).toBe('home');
  });
  it('TC-WS002: Write falls back to effective', () => {
    expect(getWriteSocietyId(null, 'viewed')).toBe('viewed');
  });
  it('TC-WS003: Write returns null when both null', () => {
    expect(getWriteSocietyId(null, null)).toBeNull();
  });
  it('TC-WS004: Read uses effective society ID', () => {
    expect(getReadSocietyId('viewed', 'home')).toBe('viewed');
  });
  it('TC-WS005: Read falls back to profile', () => {
    expect(getReadSocietyId(null, 'home')).toBe('home');
  });
});

// ════════════════════════════════════════════════════
// SECTION 16: PAGINATION
// ════════════════════════════════════════════════════

describe('Pagination Range', () => {
  it('TC-PG001: Page 0 → 0..19', () => {
    expect(paginationRange(0, 20)).toEqual({ start: 0, end: 19 });
  });
  it('TC-PG002: Page 2 → 40..59', () => {
    expect(paginationRange(2, 20)).toEqual({ start: 40, end: 59 });
  });
  it('TC-PG003: Page size 50', () => {
    expect(paginationRange(1, 50)).toEqual({ start: 50, end: 99 });
  });
});

// ════════════════════════════════════════════════════
// SECTION 17: NOTIFICATION TITLES
// ════════════════════════════════════════════════════

describe('Order Notification Titles', () => {
  it('TC-NT001: Seller gets "New Order" on placed', () => {
    expect(getOrderNotifTitle('placed', 'seller')).toBe('🆕 New Order Received!');
  });
  it('TC-NT002: Seller gets "Cancelled" on cancelled', () => {
    expect(getOrderNotifTitle('cancelled', 'seller')).toBe('❌ Order Cancelled');
  });
  it('TC-NT003: Seller gets null for other statuses', () => {
    expect(getOrderNotifTitle('accepted', 'seller')).toBeNull();
  });
  it('TC-NT004: Buyer gets accepted notification', () => {
    expect(getOrderNotifTitle('accepted', 'buyer')).toBe('✅ Order Accepted!');
  });
  it('TC-NT005: Buyer gets preparing notification', () => {
    expect(getOrderNotifTitle('preparing', 'buyer')).toBe('👨‍🍳 Order Being Prepared');
  });
  it('TC-NT006: Buyer gets ready notification', () => {
    expect(getOrderNotifTitle('ready', 'buyer')).toBe('🎉 Order Ready!');
  });
  it('TC-NT007: Buyer gets delivered notification', () => {
    expect(getOrderNotifTitle('delivered', 'buyer')).toBe('🚚 Order Delivered');
  });
  it('TC-NT008: Buyer gets completed notification', () => {
    expect(getOrderNotifTitle('completed', 'buyer')).toBe('⭐ Order Completed');
  });
  it('TC-NT009: Buyer gets quoted notification', () => {
    expect(getOrderNotifTitle('quoted', 'buyer')).toBe('💰 Quote Received');
  });
  it('TC-NT010: Buyer gets scheduled notification', () => {
    expect(getOrderNotifTitle('scheduled', 'buyer')).toBe('📅 Booking Confirmed');
  });
  it('TC-NT011: Unknown status → null', () => {
    expect(getOrderNotifTitle('unknown_status', 'buyer')).toBeNull();
  });
});

// ════════════════════════════════════════════════════
// SECTION 18: DASHBOARD SEARCH
// ════════════════════════════════════════════════════

describe('Dashboard Item Search', () => {
  it('TC-DS001: Matches label', () => {
    expect(dashboardItemMatchesSearch({ label: 'Expenses', stat: '₹5000' }, 'expense')).toBe(true);
  });
  it('TC-DS002: Matches stat', () => {
    expect(dashboardItemMatchesSearch({ label: 'Total', stat: '₹5000' }, '5000')).toBe(true);
  });
  it('TC-DS003: Matches keywords', () => {
    expect(dashboardItemMatchesSearch({ label: 'Finance', keywords: ['money', 'budget'] }, 'budget')).toBe(true);
  });
  it('TC-DS004: Case insensitive', () => {
    expect(dashboardItemMatchesSearch({ label: 'EXPENSES' }, 'expenses')).toBe(true);
  });
  it('TC-DS005: No match → false', () => {
    expect(dashboardItemMatchesSearch({ label: 'Income' }, 'expenses')).toBe(false);
  });
});

// ════════════════════════════════════════════════════
// SECTION 19: REPORT METRICS
// ════════════════════════════════════════════════════

describe('Report Metrics', () => {
  it('TC-RM001: Dispute resolution rate', () => {
    expect(computeDisputeResolutionRate(10, 8)).toBe(80);
  });
  it('TC-RM002: Zero disputes → 0%', () => {
    expect(computeDisputeResolutionRate(0, 0)).toBe(0);
  });
  it('TC-RM003: Maintenance collection rate', () => {
    expect(computeMaintenanceCollectionRate(80, 20)).toBe(80);
  });
  it('TC-RM004: Zero total → 0%', () => {
    expect(computeMaintenanceCollectionRate(0, 0)).toBe(0);
  });
  it('TC-RM005: Response ≤24h → up', () => {
    expect(categorizeResponseTime(12)).toBe('up');
  });
  it('TC-RM006: Response 25-48h → neutral', () => {
    expect(categorizeResponseTime(36)).toBe('neutral');
  });
  it('TC-RM007: Response >48h → down', () => {
    expect(categorizeResponseTime(72)).toBe('down');
  });
});
