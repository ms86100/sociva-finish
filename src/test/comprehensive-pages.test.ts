import { describe, it, expect } from 'vitest';
import {
  // Existing helpers
  isPublicRoute, PUBLIC_ROUTES, hasGuardAccess, hasManagementAccess,
  hasProgressManageAccess, canPostNotice, getProfileMenuItems, getVerificationState,
  computeFinanceSummary, computeOverallProgress, sortByPinAndDate,
  computeDeliveryFee, groupBySeller, findUnavailableProducts, computeSLADeadline,
  isSLABreached, computeAbsentWorkers, hasActiveFilters, canAccessSellerDetail,
  paginationRange, getOrderNotifTitle, haversineDistance, validateWorkerEntry,
  isCouponApplicable, getWriteSocietyId, getReadSocietyId, computeMilestoneProgress,
  computeInspectionScore, computeDisputeResolutionRate, computeMaintenanceCollectionRate,
  categorizeResponseTime, dashboardItemMatchesSearch, computeCancellationRate,
  isTokenExpired, isNonceDuplicate, getSecurityModeStatus, validateManualEntry,
  MANUAL_ENTRY_TRANSITIONS, VISITOR_TRANSITIONS, isOTPValid, isOTPExpired,
  generateOTP, canLogParcel, filterParcelsByStatus, computePercentage,
  computeAverageMs, decrementCountdown, isPollingIntervalValid,
  getFeatureState, isFeatureAccessible,
  // New helpers
  ALLOWED_ORDER_TRANSITIONS, isValidOrderTransition, TERMINAL_ORDER_STATES,
  computeCartTotal, computeItemCount, computeMaxPrepTime, computeFinalAmount,
  isSellerProfileComplete, getSellerOnboardingStep, canSubmitSellerApplication,
  getSellerBadges, isPaymentMethodAvailable, computePlatformFee,
  shouldAutoAssignDelivery, isDeliveryCodeValid,
  isSubscriptionActive, getNextRenewalDate,
  getOrderStatusLabel, getPaymentStatusLabel, getDeliveryStatusLabel,
  parseLandingSlides, computePlatformStats, computeAvgResponseHours,
  filterDashboardSections, computeSellerVisibilityScore,
  canAccessBuilderDashboard, computeBuilderSocietyStats,
  classifyOrderType, canReorder, PRODUCT_APPROVAL_STATES, isProductVisible,
  VALID_FULFILLMENT_MODES, isValidFulfillmentMode,
  JOB_STATUSES, URGENCY_LEVELS, isValidJobStatus, isValidUrgency, isValidRating,
  WORKER_STATUSES, ENTRY_FREQUENCIES, isValidWorkerStatus, isValidEntryFrequency,
  meetsMinimumOrder, hasUrgentItems, computeTrustScore, getTrustBadge,
  isCrossSocietyOrder, isOverBudget, computeQAAnsweredRatio, getGuardTabs,
  DISPUTE_CATEGORIES, isValidDisputeCategory,
  MAINTENANCE_DUE_TRANSITIONS, isValidMaintenanceDueTransition,
  DashboardSection,
} from './helpers/business-rules';
import { loginSchema, signupSchema, profileDataSchema, emailSchema, passwordSchema, disputeSchema, workerRegistrationSchema, jobRequestSchema, validateForm } from '@/lib/validation-schemas';
import { formatPrice } from '@/lib/format-price';
import { ACTION_CONFIG, SORT_OPTIONS } from '@/lib/marketplace-constants';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, ITEM_STATUS_LABELS, DAYS_OF_WEEK } from '@/types/database';

// ═══════════════════════════════════════════════════════════════════════════
// CORE PAGES
// ═══════════════════════════════════════════════════════════════════════════

describe('Core Pages', () => {
  // ── Landing Page (/welcome) ─────────────────────────────────────────────
  describe('Landing Page', () => {
    it('TC-LP-001: parses valid CMS slides JSON', () => {
      const json = JSON.stringify([{ title: 'Welcome', image: '/hero.jpg' }, { title: 'Shop', image: '/shop.jpg' }]);
      expect(parseLandingSlides(json)).toHaveLength(2);
    });
    it('TC-LP-002: returns empty for invalid JSON', () => {
      expect(parseLandingSlides('not-json')).toEqual([]);
    });
    it('TC-LP-003: returns empty for empty string', () => {
      expect(parseLandingSlides('')).toEqual([]);
    });
    it('TC-LP-004: filters malformed slides', () => {
      const json = JSON.stringify([{ title: 'OK', image: '/ok.jpg' }, { title: 123 }, null]);
      expect(parseLandingSlides(json)).toHaveLength(1);
    });
    it('TC-LP-005: returns empty for non-array JSON', () => {
      expect(parseLandingSlides('{}')).toEqual([]);
    });
    it('TC-LP-006: computes platform stats', () => {
      const stats = computePlatformStats(50, 200, 16);
      expect(stats).toHaveLength(3);
      expect(stats[0]).toEqual({ label: 'Societies', value: 50 });
      expect(stats[1]).toEqual({ label: 'Sellers', value: 200 });
      expect(stats[2]).toEqual({ label: 'Categories', value: 16 });
    });
    it('TC-LP-007: platform stats with zeros', () => {
      const stats = computePlatformStats(0, 0, 0);
      expect(stats.every(s => s.value === 0)).toBe(true);
    });
  });

  // ── Auth Page (/auth) ───────────────────────────────────────────────────
  describe('Auth Page', () => {
    it('TC-AUTH-001: valid login passes schema', () => {
      const r = loginSchema.safeParse({ email: 'test@test.com', password: 'secure123' });
      expect(r.success).toBe(true);
    });
    it('TC-AUTH-002: missing email fails', () => {
      const r = loginSchema.safeParse({ email: '', password: 'secure123' });
      expect(r.success).toBe(false);
    });
    it('TC-AUTH-003: short password fails', () => {
      const r = loginSchema.safeParse({ email: 'a@b.com', password: '12345' });
      expect(r.success).toBe(false);
    });
    it('TC-AUTH-004: invalid email format fails', () => {
      const r = loginSchema.safeParse({ email: 'notanemail', password: '123456' });
      expect(r.success).toBe(false);
    });
    it('TC-AUTH-005: email with spaces is trimmed', () => {
      const r = loginSchema.safeParse({ email: '  test@test.com  ', password: '123456' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.email).toBe('test@test.com');
    });
    it('TC-AUTH-006: password at max length passes', () => {
      const r = passwordSchema.safeParse('a'.repeat(128));
      expect(r.success).toBe(true);
    });
    it('TC-AUTH-007: password over max fails', () => {
      const r = passwordSchema.safeParse('a'.repeat(129));
      expect(r.success).toBe(false);
    });
    it('TC-AUTH-008: signup schema with valid profile passes', () => {
      const r = signupSchema.safeParse({
        email: 'x@y.com', password: '123456',
        profile: { name: 'Test', flat_number: 'A1', block: 'B', phone: '9876543210' },
      });
      expect(r.success).toBe(true);
    });
    it('TC-AUTH-009: signup schema with missing profile fields fails', () => {
      const r = signupSchema.safeParse({
        email: 'x@y.com', password: '123456',
        profile: { name: '', flat_number: '', block: '', phone: '' },
      });
      expect(r.success).toBe(false);
    });
    it('TC-AUTH-010: email max length 255', () => {
      const r = emailSchema.safeParse('a'.repeat(250) + '@b.com');
      expect(r.success).toBe(false); // exceeds 255
    });
  });

  // ── Profile Page (/profile) ─────────────────────────────────────────────
  describe('Profile Page', () => {
    it('TC-PROF-001: menu items for regular user', () => {
      expect(getProfileMenuItems(false, false, false)).toEqual(['Become a Seller']);
    });
    it('TC-PROF-002: menu items for seller', () => {
      expect(getProfileMenuItems(true, false, false)).toEqual(['Seller Dashboard']);
    });
    it('TC-PROF-003: menu items for builder member', () => {
      const items = getProfileMenuItems(false, true, false);
      expect(items).toContain('Builder Dashboard');
      expect(items).toContain('Become a Seller');
    });
    it('TC-PROF-004: menu items for admin', () => {
      const items = getProfileMenuItems(false, false, true);
      expect(items).toContain('Admin Panel');
    });
    it('TC-PROF-005: menu items for seller+admin+builder', () => {
      const items = getProfileMenuItems(true, true, true);
      expect(items).toContain('Seller Dashboard');
      expect(items).toContain('Builder Dashboard');
      expect(items).toContain('Admin Panel');
    });
    it('TC-PROF-006: verification state approved', () => {
      expect(getVerificationState({ verification_status: 'approved' })).toBe('approved');
    });
    it('TC-PROF-007: verification state pending', () => {
      expect(getVerificationState({ verification_status: 'pending' })).toBe('pending');
    });
    it('TC-PROF-008: verification state loading', () => {
      expect(getVerificationState(null)).toBe('loading');
    });
    it('TC-PROF-009: profile schema valid data', () => {
      const r = profileDataSchema.safeParse({ name: 'John', flat_number: '101', block: 'A', phone: '9876543210' });
      expect(r.success).toBe(true);
    });
    it('TC-PROF-010: profile schema invalid phone', () => {
      const r = profileDataSchema.safeParse({ name: 'J', flat_number: '1', block: 'A', phone: '123' });
      expect(r.success).toBe(false);
    });
    it('TC-PROF-011: profile schema name too long', () => {
      const r = profileDataSchema.safeParse({ name: 'x'.repeat(101), flat_number: '1', block: 'A', phone: '9876543210' });
      expect(r.success).toBe(false);
    });
    it('TC-PROF-012: profile schema with optional phase', () => {
      const r = profileDataSchema.safeParse({ name: 'J', flat_number: '1', block: 'A', phone: '9876543210', phase: 'Phase 2' });
      expect(r.success).toBe(true);
    });
  });

  // ── Public Routes (/privacy-policy, /terms, /help, /pricing, etc.) ────
  describe('Public Routes', () => {
    const expected = ['/welcome', '/auth', '/privacy-policy', '/terms', '/community-rules', '/help', '/pricing', '/reset-password'];
    expected.forEach(route => {
      it(`TC-PUB-${route}: ${route} is public`, () => {
        expect(isPublicRoute(route)).toBe(true);
      });
    });
    it('TC-PUB-PRIVATE: / is not public', () => {
      expect(isPublicRoute('/')).toBe(false);
    });
    it('TC-PUB-PRIVATE2: /seller is not public', () => {
      expect(isPublicRoute('/seller')).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MARKETPLACE & SHOPPING
// ═══════════════════════════════════════════════════════════════════════════

describe('Marketplace & Shopping', () => {
  // ── Search Page (/search) ─────────────────────────────────────────────
  describe('Search Page', () => {
    it('TC-SRCH-001: no active filters when all defaults', () => {
      expect(hasActiveFilters({ minRating: 0, isVeg: null, categories: [], sortBy: null, priceRange: [0, 10000] }, 10000)).toBe(false);
    });
    it('TC-SRCH-002: active when minRating > 0', () => {
      expect(hasActiveFilters({ minRating: 3, isVeg: null, categories: [], sortBy: null, priceRange: [0, 10000] }, 10000)).toBe(true);
    });
    it('TC-SRCH-003: active when isVeg set', () => {
      expect(hasActiveFilters({ minRating: 0, isVeg: true, categories: [], sortBy: null, priceRange: [0, 10000] }, 10000)).toBe(true);
    });
    it('TC-SRCH-004: active when categories selected', () => {
      expect(hasActiveFilters({ minRating: 0, isVeg: null, categories: ['food'], sortBy: null, priceRange: [0, 10000] }, 10000)).toBe(true);
    });
    it('TC-SRCH-005: active when sortBy set', () => {
      expect(hasActiveFilters({ minRating: 0, isVeg: null, categories: [], sortBy: 'price_low', priceRange: [0, 10000] }, 10000)).toBe(true);
    });
    it('TC-SRCH-006: active when price range changed', () => {
      expect(hasActiveFilters({ minRating: 0, isVeg: null, categories: [], sortBy: null, priceRange: [100, 10000] }, 10000)).toBe(true);
    });
    it('TC-SRCH-007: 7 sort options available', () => {
      expect(SORT_OPTIONS).toHaveLength(7);
    });
    it('TC-SRCH-008: sort keys include all expected', () => {
      const keys = SORT_OPTIONS.map(o => o.key);
      expect(keys).toEqual(['relevance', 'nearest', 'price_low', 'price_high', 'popular', 'rating', 'newest']);
    });
    it('TC-SRCH-009: haversine same point is 0', () => {
      expect(haversineDistance(0, 0, 0, 0)).toBe(0);
    });
    it('TC-SRCH-010: haversine reasonable distance', () => {
      const d = haversineDistance(19.076, 72.877, 19.086, 72.887);
      expect(d).toBeGreaterThan(500);
      expect(d).toBeLessThan(2000);
    });
  });

  // ── Categories Page (/categories) ─────────────────────────────────────
  describe('Categories Page', () => {
    it('TC-CAT-001: ACTION_CONFIG has 8 action types', () => {
      expect(Object.keys(ACTION_CONFIG)).toHaveLength(8);
    });
    it('TC-CAT-002: add_to_cart isCart true', () => {
      expect(ACTION_CONFIG.add_to_cart.isCart).toBe(true);
    });
    it('TC-CAT-003: request_quote isCart false', () => {
      expect(ACTION_CONFIG.request_quote.isCart).toBe(false);
    });
    it('TC-CAT-004: all actions have label and shortLabel', () => {
      Object.values(ACTION_CONFIG).forEach(cfg => {
        expect(cfg.label).toBeTruthy();
        expect(cfg.shortLabel).toBeTruthy();
      });
    });
  });

  // ── Cart Page (/cart) ─────────────────────────────────────────────────
  describe('Cart Page', () => {
    it('TC-CART-001: compute total for multiple items', () => {
      const items = [{ unit_price: 100, quantity: 2 }, { unit_price: 50, quantity: 3 }];
      expect(computeCartTotal(items)).toBe(350);
    });
    it('TC-CART-002: empty cart total is 0', () => {
      expect(computeCartTotal([])).toBe(0);
    });
    it('TC-CART-003: item count sums quantities', () => {
      expect(computeItemCount([{ quantity: 3 }, { quantity: 2 }])).toBe(5);
    });
    it('TC-CART-004: max prep time picks highest', () => {
      const items = [{ prep_time_minutes: 15 }, { prep_time_minutes: 30 }, { prep_time_minutes: 10 }];
      expect(computeMaxPrepTime(items)).toBe(30);
    });
    it('TC-CART-005: max prep time with nulls', () => {
      const items = [{ prep_time_minutes: null }, { prep_time_minutes: 20 }];
      expect(computeMaxPrepTime(items)).toBe(20);
    });
    it('TC-CART-006: final amount with coupon and delivery', () => {
      expect(computeFinalAmount(500, 50, 30)).toBe(480);
    });
    it('TC-CART-007: final amount never negative', () => {
      expect(computeFinalAmount(100, 200, 0)).toBe(0);
    });
    it('TC-CART-008: final amount no coupon no delivery', () => {
      expect(computeFinalAmount(300, 0, 0)).toBe(300);
    });
    it('TC-CART-009: minimum order met', () => {
      expect(meetsMinimumOrder(500, 200)).toBe(true);
    });
    it('TC-CART-010: minimum order not met', () => {
      expect(meetsMinimumOrder(100, 200)).toBe(false);
    });
    it('TC-CART-011: null min amount always passes', () => {
      expect(meetsMinimumOrder(0, null)).toBe(true);
    });
    it('TC-CART-012: multi-vendor grouping', () => {
      const items = [
        { seller_id: 'A', name: 'p1' }, { seller_id: 'B', name: 'p2' }, { seller_id: 'A', name: 'p3' },
      ];
      const groups = groupBySeller(items);
      expect(groups.size).toBe(2);
      expect(groups.get('A')!).toHaveLength(2);
    });
    it('TC-CART-013: cross-society seller detection', () => {
      expect(isCrossSocietyOrder('s1', 's2')).toBe(true);
      expect(isCrossSocietyOrder('s1', 's1')).toBe(false);
    });
    it('TC-CART-014: urgent item detection', () => {
      expect(hasUrgentItems([{ is_urgent: false }, { is_urgent: true }])).toBe(true);
      expect(hasUrgentItems([{ is_urgent: false }])).toBe(false);
    });
    it('TC-CART-015: payment method COD available', () => {
      expect(isPaymentMethodAvailable('cod', { accepts_cod: true, accepts_upi: false })).toBe(true);
    });
    it('TC-CART-016: payment method UPI unavailable', () => {
      expect(isPaymentMethodAvailable('upi', { accepts_cod: true, accepts_upi: false })).toBe(false);
    });
    it('TC-CART-017: delivery fee zero for self_pickup', () => {
      expect(computeDeliveryFee(100, 500, 30, 'self_pickup')).toBe(0);
    });
    it('TC-CART-018: delivery fee applied below threshold', () => {
      expect(computeDeliveryFee(100, 500, 30, 'delivery')).toBe(30);
    });
    it('TC-CART-019: delivery fee waived above threshold', () => {
      expect(computeDeliveryFee(600, 500, 30, 'delivery')).toBe(0);
    });
    it('TC-CART-020: pre-checkout finds unavailable products', () => {
      const fresh = [
        { id: '1', is_available: true, approval_status: 'approved' },
        { id: '2', is_available: false, approval_status: 'approved' },
      ];
      expect(findUnavailableProducts(fresh, ['1', '2', '3'])).toEqual(['2', '3']);
    });
  });

  // ── Orders Page (/orders) ─────────────────────────────────────────────
  describe('Orders Page', () => {
    const allStatuses = ['placed', 'accepted', 'preparing', 'ready', 'picked_up', 'delivered', 'completed', 'cancelled', 'enquired', 'quoted', 'scheduled', 'in_progress', 'returned'];
    allStatuses.forEach(s => {
      it(`TC-ORD-LABEL-${s}: order status "${s}" has label`, () => {
        expect(getOrderStatusLabel(s)).not.toBe('Unknown');
      });
    });
    it('TC-ORD-LABEL-UNKNOWN: unknown status returns Unknown', () => {
      expect(getOrderStatusLabel('xyz')).toBe('Unknown');
    });

    const payStatuses = ['pending', 'paid', 'failed', 'refunded'];
    payStatuses.forEach(s => {
      it(`TC-ORD-PAY-${s}: payment status "${s}" has label`, () => {
        expect(getPaymentStatusLabel(s)).not.toBe('Unknown');
      });
    });

    it('TC-ORD-REORDER-001: can reorder completed', () => {
      expect(canReorder('completed')).toBe(true);
    });
    it('TC-ORD-REORDER-002: can reorder delivered', () => {
      expect(canReorder('delivered')).toBe(true);
    });
    it('TC-ORD-REORDER-003: cannot reorder cancelled', () => {
      expect(canReorder('cancelled')).toBe(false);
    });
    it('TC-ORD-REORDER-004: cannot reorder placed', () => {
      expect(canReorder('placed')).toBe(false);
    });

    it('TC-ORD-PAGE-001: pagination range page 0', () => {
      expect(paginationRange(0, 20)).toEqual({ start: 0, end: 19 });
    });
    it('TC-ORD-PAGE-002: pagination range page 2', () => {
      expect(paginationRange(2, 20)).toEqual({ start: 40, end: 59 });
    });

    it('TC-ORD-LABELS-001: ORDER_STATUS_LABELS proxy returns label for placed', () => {
      expect(ORDER_STATUS_LABELS['placed'].label).toBe('Order Placed');
    });
    it('TC-ORD-LABELS-002: ORDER_STATUS_LABELS proxy returns Unknown for garbage', () => {
      expect((ORDER_STATUS_LABELS as any)['garbage'].label).toBe('Unknown');
    });
    it('TC-ORD-LABELS-003: PAYMENT_STATUS_LABELS has pending', () => {
      expect(PAYMENT_STATUS_LABELS['pending'].label).toBe('Pending');
    });
    it('TC-ORD-LABELS-004: ITEM_STATUS_LABELS has 6 entries', () => {
      expect(Object.keys(ITEM_STATUS_LABELS)).toHaveLength(6);
    });
  });

  // ── Favorites (/favorites) ────────────────────────────────────────────
  describe('Favorites Page', () => {
    it('TC-FAV-001: seller access checks verification', () => {
      expect(canAccessSellerDetail({ verificationStatus: 'approved', sellerSocietyId: 's1', buyerSocietyId: 's1', sellBeyondCommunity: false })).toBe(true);
    });
    it('TC-FAV-002: rejected seller not accessible', () => {
      expect(canAccessSellerDetail({ verificationStatus: 'rejected', sellerSocietyId: 's1', buyerSocietyId: 's1', sellBeyondCommunity: false })).toBe(false);
    });
  });

  // ── Subscriptions (/subscriptions) ────────────────────────────────────
  describe('Subscriptions Page', () => {
    it('TC-SUB-001: active subscription', () => {
      expect(isSubscriptionActive({ status: 'active', expires_at: '2099-01-01' })).toBe(true);
    });
    it('TC-SUB-002: expired subscription', () => {
      expect(isSubscriptionActive({ status: 'active', expires_at: '2020-01-01' })).toBe(false);
    });
    it('TC-SUB-003: cancelled subscription', () => {
      expect(isSubscriptionActive({ status: 'cancelled' })).toBe(false);
    });
    it('TC-SUB-004: active with no expiry', () => {
      expect(isSubscriptionActive({ status: 'active', expires_at: null })).toBe(true);
    });
    it('TC-SUB-005: renewal date computation', () => {
      const d = getNextRenewalDate('2025-01-01', 30);
      expect(d.getFullYear()).toBe(2025);
      expect(d.getMonth()).toBe(0); // January
      expect(d.getDate()).toBe(31);
    });
    it('TC-SUB-006: renewal date wraps month', () => {
      const d = getNextRenewalDate('2025-01-15', 30);
      expect(d.getMonth()).toBe(1); // February
    });
  });

  // ── Trust Directory (/directory) ──────────────────────────────────────
  describe('Trust Directory Page', () => {
    it('TC-TRUST-001: high trust score for approved seller with good stats', () => {
      const score = computeTrustScore({ rating: 4.8, total_reviews: 20, completed_order_count: 100, cancellation_rate: 0, verification_status: 'approved' });
      expect(score).toBeGreaterThanOrEqual(80);
    });
    it('TC-TRUST-002: low trust score for unverified seller', () => {
      const score = computeTrustScore({ rating: 2, total_reviews: 1, completed_order_count: 0, cancellation_rate: 50, verification_status: 'pending' });
      expect(score).toBeLessThan(40);
    });
    it('TC-TRUST-003: gold badge for high score', () => {
      expect(getTrustBadge(85)).toBe('gold');
    });
    it('TC-TRUST-004: silver badge', () => {
      expect(getTrustBadge(65)).toBe('silver');
    });
    it('TC-TRUST-005: bronze badge', () => {
      expect(getTrustBadge(45)).toBe('bronze');
    });
    it('TC-TRUST-006: no badge for low score', () => {
      expect(getTrustBadge(20)).toBe('none');
    });
    it('TC-TRUST-007: score capped at 100', () => {
      const score = computeTrustScore({ rating: 5, total_reviews: 100, completed_order_count: 500, cancellation_rate: 0, verification_status: 'approved' });
      expect(score).toBeLessThanOrEqual(100);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SELLER TOOLS
// ═══════════════════════════════════════════════════════════════════════════

describe('Seller Tools', () => {
  // ── Become Seller (/become-seller) ────────────────────────────────────
  describe('Become Seller Page', () => {
    it('TC-BSELL-001: incomplete profile missing business name', () => {
      expect(isSellerProfileComplete({ business_name: '', categories: ['food'], cover_image_url: '/img.jpg' })).toBe(false);
    });
    it('TC-BSELL-002: incomplete profile missing categories', () => {
      expect(isSellerProfileComplete({ business_name: 'Shop', categories: [], cover_image_url: '/img.jpg' })).toBe(false);
    });
    it('TC-BSELL-003: incomplete profile missing cover image', () => {
      expect(isSellerProfileComplete({ business_name: 'Shop', categories: ['food'], cover_image_url: null })).toBe(false);
    });
    it('TC-BSELL-004: complete profile', () => {
      expect(isSellerProfileComplete({ business_name: 'Shop', categories: ['food'], cover_image_url: '/img.jpg' })).toBe(true);
    });
    it('TC-BSELL-005: onboarding step 1 when no name', () => {
      expect(getSellerOnboardingStep({ business_name: '' })).toBe(1);
    });
    it('TC-BSELL-006: onboarding step 2 when no categories', () => {
      expect(getSellerOnboardingStep({ business_name: 'X', categories: [] })).toBe(2);
    });
    it('TC-BSELL-007: onboarding step 3 when no cover', () => {
      expect(getSellerOnboardingStep({ business_name: 'X', categories: ['a'], cover_image_url: null })).toBe(3);
    });
    it('TC-BSELL-008: onboarding step 4 when complete', () => {
      expect(getSellerOnboardingStep({ business_name: 'X', categories: ['a'], cover_image_url: '/x' })).toBe(4);
    });
    it('TC-BSELL-009: canSubmitSellerApplication mirrors isComplete', () => {
      expect(canSubmitSellerApplication({ business_name: 'X', categories: ['a'], cover_image_url: '/x' })).toBe(true);
      expect(canSubmitSellerApplication({ business_name: '' })).toBe(false);
    });
  });

  // ── Seller Dashboard (/seller) ────────────────────────────────────────
  describe('Seller Dashboard Page', () => {
    it('TC-SDASH-001: new seller badge when 0 orders', () => {
      expect(getSellerBadges({ completed_order_count: 0 })).toContain('New Seller');
    });
    it('TC-SDASH-002: no new seller badge when orders > 0', () => {
      expect(getSellerBadges({ completed_order_count: 5 })).not.toContain('New Seller');
    });
    it('TC-SDASH-003: 0% cancellation badge when rate=0 and orders>2', () => {
      expect(getSellerBadges({ completed_order_count: 10, cancellation_rate: 0 })).toContain('0% Cancellation');
    });
    it('TC-SDASH-004: no cancellation badge when rate > 0', () => {
      expect(getSellerBadges({ completed_order_count: 10, cancellation_rate: 5 })).not.toContain('0% Cancellation');
    });
    it('TC-SDASH-005: no cancellation badge when orders <= 2', () => {
      expect(getSellerBadges({ completed_order_count: 2, cancellation_rate: 0 })).not.toContain('0% Cancellation');
    });
    it('TC-SDASH-006: cancellation rate computation', () => {
      expect(computeCancellationRate(90, 10)).toBe(10);
    });
    it('TC-SDASH-007: cancellation rate zero when no orders', () => {
      expect(computeCancellationRate(0, 0)).toBe(0);
    });
    it('TC-SDASH-008: seller visibility score full', () => {
      const score = computeSellerVisibilityScore({
        business_name: 'X', cover_image_url: '/x', description: 'desc',
        categories: ['a'], operating_days: ['Mon'], accepts_cod: true,
      });
      expect(score).toBe(100);
    });
    it('TC-SDASH-009: seller visibility score partial', () => {
      const score = computeSellerVisibilityScore({ business_name: 'X' });
      expect(score).toBe(20);
    });
  });

  // ── Seller Products (/seller/products) ────────────────────────────────
  describe('Seller Products Page', () => {
    it('TC-SPROD-001: 4 approval states', () => {
      expect(PRODUCT_APPROVAL_STATES).toHaveLength(4);
    });
    it('TC-SPROD-002: approved + available is visible', () => {
      expect(isProductVisible('approved', true)).toBe(true);
    });
    it('TC-SPROD-003: approved but unavailable not visible', () => {
      expect(isProductVisible('approved', false)).toBe(false);
    });
    it('TC-SPROD-004: pending not visible even if available', () => {
      expect(isProductVisible('pending', true)).toBe(false);
    });
    it('TC-SPROD-005: draft not visible', () => {
      expect(isProductVisible('draft', true)).toBe(false);
    });
  });

  // ── Seller Settings (/seller/settings) ────────────────────────────────
  describe('Seller Settings Page', () => {
    it('TC-SSET-001: valid fulfillment modes', () => {
      VALID_FULFILLMENT_MODES.forEach(m => expect(isValidFulfillmentMode(m)).toBe(true));
    });
    it('TC-SSET-002: invalid fulfillment mode', () => {
      expect(isValidFulfillmentMode('drone')).toBe(false);
    });
    it('TC-SSET-003: DAYS_OF_WEEK has 7 days', () => {
      expect(DAYS_OF_WEEK).toHaveLength(7);
    });
  });

  // ── Seller Earnings (/seller/earnings) ────────────────────────────────
  describe('Seller Earnings Page', () => {
    it('TC-SEARN-001: platform fee computation 5%', () => {
      const r = computePlatformFee(1000, 5);
      expect(r.fee).toBe(50);
      expect(r.net).toBe(950);
    });
    it('TC-SEARN-002: platform fee 0%', () => {
      const r = computePlatformFee(1000, 0);
      expect(r.fee).toBe(0);
      expect(r.net).toBe(1000);
    });
    it('TC-SEARN-003: platform fee rounds', () => {
      const r = computePlatformFee(333, 7);
      expect(typeof r.fee).toBe('number');
      expect(r.fee + r.net).toBeCloseTo(333, 0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SOCIETY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

describe('Society Management', () => {
  // ── Society Dashboard (/society) ──────────────────────────────────────
  describe('Society Dashboard Page', () => {
    const sections: DashboardSection[] = [
      { label: 'Bulletin', feature: 'bulletin' },
      { label: 'Finances', feature: 'finances', adminOnly: true },
      { label: 'Security', feature: 'security_gate' },
      { label: 'Admin Panel', adminOnly: true },
    ];

    it('TC-SOCD-001: all features enabled, admin sees all', () => {
      const result = filterDashboardSections(sections, () => true, true, false);
      expect(result).toHaveLength(4);
    });
    it('TC-SOCD-002: regular user sees non-admin sections', () => {
      const result = filterDashboardSections(sections, () => true, false, false);
      expect(result).toHaveLength(2);
      expect(result.map(s => s.label)).toEqual(['Bulletin', 'Security']);
    });
    it('TC-SOCD-003: society admin sees admin sections', () => {
      const result = filterDashboardSections(sections, () => true, false, true);
      expect(result).toHaveLength(4);
    });
    it('TC-SOCD-004: disabled feature hides section', () => {
      const result = filterDashboardSections(sections, f => f !== 'bulletin', true, false);
      expect(result.map(s => s.label)).not.toContain('Bulletin');
    });
    it('TC-SOCD-005: avg response hours computation', () => {
      const items = [
        { created_at: '2025-01-01T00:00:00Z', acknowledged_at: '2025-01-01T12:00:00Z' },
        { created_at: '2025-01-02T00:00:00Z', acknowledged_at: '2025-01-02T24:00:00Z' },
      ];
      expect(computeAvgResponseHours(items)).toBe(18);
    });
    it('TC-SOCD-006: avg response hours with no acks', () => {
      expect(computeAvgResponseHours([{ created_at: '2025-01-01', acknowledged_at: null }])).toBe(0);
    });
    it('TC-SOCD-007: dashboard search matches label', () => {
      expect(dashboardItemMatchesSearch({ label: 'Bulletin Board' }, 'bulletin')).toBe(true);
    });
    it('TC-SOCD-008: dashboard search matches keyword', () => {
      expect(dashboardItemMatchesSearch({ label: 'X', keywords: ['maintenance', 'dues'] }, 'dues')).toBe(true);
    });
    it('TC-SOCD-009: dashboard search no match', () => {
      expect(dashboardItemMatchesSearch({ label: 'X' }, 'zzz')).toBe(false);
    });
  });

  // ── Bulletin Page (/community) ────────────────────────────────────────
  describe('Bulletin Page', () => {
    it('TC-BULL-001: pinned posts come first', () => {
      const posts = [
        { is_pinned: false, created_at: '2025-02-01' },
        { is_pinned: true, created_at: '2025-01-01' },
      ];
      const sorted = sortByPinAndDate(posts);
      expect(sorted[0].is_pinned).toBe(true);
    });
    it('TC-BULL-002: same pin status sorted by date desc', () => {
      const posts = [
        { is_pinned: false, created_at: '2025-01-01' },
        { is_pinned: false, created_at: '2025-02-01' },
      ];
      const sorted = sortByPinAndDate(posts);
      expect(sorted[0].created_at).toBe('2025-02-01');
    });
  });

  // ── Finances (/society/finances) ──────────────────────────────────────
  describe('Finances Page', () => {
    it('TC-FIN-001: positive balance is success', () => {
      const r = computeFinanceSummary([{ amount: 100 }], [{ amount: 500 }]);
      expect(r.balance).toBe(400);
      expect(r.colorClass).toBe('text-success');
    });
    it('TC-FIN-002: negative balance is destructive', () => {
      const r = computeFinanceSummary([{ amount: 500 }], [{ amount: 100 }]);
      expect(r.balance).toBe(-400);
      expect(r.colorClass).toBe('text-destructive');
    });
    it('TC-FIN-003: empty arrays = 0 balance', () => {
      const r = computeFinanceSummary([], []);
      expect(r.balance).toBe(0);
    });
    it('TC-FIN-004: over budget detection', () => {
      expect(isOverBudget(1500, 1000)).toBe(true);
      expect(isOverBudget(500, 1000)).toBe(false);
    });
    it('TC-FIN-005: zero budget never over', () => {
      expect(isOverBudget(1000, 0)).toBe(false);
    });
  });

  // ── Construction Progress (/society/progress) ────────────────────────
  describe('Construction Progress Page', () => {
    it('TC-PROG-001: tower progress averaging', () => {
      expect(computeOverallProgress([{ current_percentage: 40 }, { current_percentage: 60 }], [])).toBe(50);
    });
    it('TC-PROG-002: milestone fallback max', () => {
      expect(computeOverallProgress([], [{ completion_percentage: 30 }, { completion_percentage: 70 }])).toBe(70);
    });
    it('TC-PROG-003: no data returns 0', () => {
      expect(computeOverallProgress([], [])).toBe(0);
    });
    it('TC-PROG-004: milestone progress paid vs total', () => {
      const r = computeMilestoneProgress([
        { amount_percentage: 30, status: 'paid' },
        { amount_percentage: 30, status: 'pending' },
        { amount_percentage: 40, status: 'paid' },
      ]);
      expect(r.paidPercent).toBe(70);
      expect(r.progressPercent).toBe(70);
    });
    it('TC-PROG-005: all milestones paid = 100%', () => {
      const r = computeMilestoneProgress([{ amount_percentage: 50, status: 'paid' }, { amount_percentage: 50, status: 'paid' }]);
      expect(r.progressPercent).toBe(100);
    });
    it('TC-PROG-006: all milestones pending = 0%', () => {
      const r = computeMilestoneProgress([{ amount_percentage: 100, status: 'pending' }]);
      expect(r.progressPercent).toBe(0);
    });
    it('TC-PROG-007: QA answered ratio', () => {
      expect(computeQAAnsweredRatio([{ answer: 'yes' }, { answer: null }, { answer: 'done' }])).toBe(67);
    });
    it('TC-PROG-008: QA ratio empty', () => {
      expect(computeQAAnsweredRatio([])).toBe(0);
    });
  });

  // ── Snag List (/society/snags) ────────────────────────────────────────
  describe('Snag List Page', () => {
    it('TC-SNAG-001: inspection score all pass', () => {
      const r = computeInspectionScore([{ status: 'pass' }, { status: 'pass' }]);
      expect(r.score).toBe(100);
    });
    it('TC-SNAG-002: inspection score all fail', () => {
      const r = computeInspectionScore([{ status: 'fail' }, { status: 'fail' }]);
      expect(r.score).toBe(0);
    });
    it('TC-SNAG-003: inspection score mixed', () => {
      const r = computeInspectionScore([{ status: 'pass' }, { status: 'fail' }, { status: 'not_checked' }]);
      expect(r.checked).toBe(2);
      expect(r.progress).toBe(67);
    });
  });

  // ── Disputes (/disputes) ──────────────────────────────────────────────
  describe('Disputes Page', () => {
    it('TC-DISP-001: dispute schema valid', () => {
      const r = disputeSchema.safeParse({ category: 'noise', description: 'Very loud at night constantly', is_anonymous: false });
      expect(r.success).toBe(true);
    });
    it('TC-DISP-002: dispute schema short description fails', () => {
      const r = disputeSchema.safeParse({ category: 'noise', description: 'short' });
      expect(r.success).toBe(false);
    });
    it('TC-DISP-003: dispute resolution rate', () => {
      expect(computeDisputeResolutionRate(10, 8)).toBe(80);
    });
    it('TC-DISP-004: dispute resolution rate zero opened', () => {
      expect(computeDisputeResolutionRate(0, 0)).toBe(0);
    });
    it('TC-DISP-005: valid dispute categories', () => {
      DISPUTE_CATEGORIES.forEach(c => expect(isValidDisputeCategory(c)).toBe(true));
    });
    it('TC-DISP-006: invalid dispute category', () => {
      expect(isValidDisputeCategory('xyz')).toBe(false);
    });
  });

  // ── Maintenance (/maintenance) ────────────────────────────────────────
  describe('Maintenance Page', () => {
    it('TC-MAINT-001: collection rate', () => {
      expect(computeMaintenanceCollectionRate(80, 20)).toBe(80);
    });
    it('TC-MAINT-002: collection rate all pending', () => {
      expect(computeMaintenanceCollectionRate(0, 50)).toBe(0);
    });
    it('TC-MAINT-003: due transition pending->paid valid', () => {
      expect(isValidMaintenanceDueTransition('pending', 'paid')).toBe(true);
    });
    it('TC-MAINT-004: due transition pending->overdue valid', () => {
      expect(isValidMaintenanceDueTransition('pending', 'overdue')).toBe(true);
    });
    it('TC-MAINT-005: due transition paid->anything invalid', () => {
      expect(isValidMaintenanceDueTransition('paid', 'pending')).toBe(false);
    });
    it('TC-MAINT-006: due transition overdue->paid valid', () => {
      expect(isValidMaintenanceDueTransition('overdue', 'paid')).toBe(true);
    });
  });

  // ── Society Reports (/society/reports) ────────────────────────────────
  describe('Society Reports Page', () => {
    it('TC-REP-001: response time up for <= 24h', () => {
      expect(categorizeResponseTime(12)).toBe('up');
    });
    it('TC-REP-002: response time neutral for 25-48h', () => {
      expect(categorizeResponseTime(36)).toBe('neutral');
    });
    it('TC-REP-003: response time down for > 48h', () => {
      expect(categorizeResponseTime(72)).toBe('down');
    });
  });

  // ── Society Admin (/society/admin) ────────────────────────────────────
  describe('Society Admin Page', () => {
    it('TC-SADM-001: admin has management access', () => {
      expect(hasManagementAccess({ isAdmin: true, isSocietyAdmin: false })).toBe(true);
    });
    it('TC-SADM-002: society admin has management access', () => {
      expect(hasManagementAccess({ isAdmin: false, isSocietyAdmin: true })).toBe(true);
    });
    it('TC-SADM-003: regular user no management access', () => {
      expect(hasManagementAccess({ isAdmin: false, isSocietyAdmin: false })).toBe(false);
    });
  });

  // ── Payment Milestones (/payment-milestones) ──────────────────────────
  describe('Payment Milestones Page', () => {
    it('TC-PMILE-001: unequal percentages', () => {
      const r = computeMilestoneProgress([
        { amount_percentage: 10, status: 'paid' },
        { amount_percentage: 40, status: 'pending' },
        { amount_percentage: 50, status: 'paid' },
      ]);
      expect(r.totalPercent).toBe(100);
      expect(r.paidPercent).toBe(60);
      expect(r.progressPercent).toBe(60);
    });
  });

  // ── Inspection (/inspection) ──────────────────────────────────────────
  describe('Inspection Checklist Page', () => {
    it('TC-INSP-001: empty checklist 0 progress', () => {
      const r = computeInspectionScore([]);
      expect(r.progress).toBe(0);
      expect(r.score).toBe(0);
    });
    it('TC-INSP-002: partial check', () => {
      const r = computeInspectionScore([{ status: 'pass' }, { status: 'not_checked' }, { status: 'not_checked' }]);
      expect(r.checked).toBe(1);
      expect(r.progress).toBe(33);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY & GATE
// ═══════════════════════════════════════════════════════════════════════════

describe('Security & Gate', () => {
  // ── Guard Kiosk (/guard-kiosk) ────────────────────────────────────────
  describe('Guard Kiosk Page', () => {
    it('TC-GK-001: admin has guard access', () => {
      expect(hasGuardAccess({ isAdmin: true, isSocietyAdmin: false, isSecurityOfficer: false })).toBe(true);
    });
    it('TC-GK-002: society admin has guard access', () => {
      expect(hasGuardAccess({ isAdmin: false, isSocietyAdmin: true, isSecurityOfficer: false })).toBe(true);
    });
    it('TC-GK-003: security officer has guard access', () => {
      expect(hasGuardAccess({ isAdmin: false, isSocietyAdmin: false, isSecurityOfficer: true })).toBe(true);
    });
    it('TC-GK-004: regular user no guard access', () => {
      expect(hasGuardAccess({ isAdmin: false, isSocietyAdmin: false, isSecurityOfficer: false })).toBe(false);
    });
    it('TC-GK-005: basic mode = confirmed', () => {
      expect(getSecurityModeStatus('basic')).toBe('confirmed');
    });
    it('TC-GK-006: confirmation mode = awaiting', () => {
      expect(getSecurityModeStatus('confirmation')).toBe('awaiting_confirmation');
    });
    it('TC-GK-007: basic mode has 4 tabs', () => {
      expect(getGuardTabs('basic')).toHaveLength(4);
    });
    it('TC-GK-008: confirmation mode has 6 tabs', () => {
      expect(getGuardTabs('confirmation')).toHaveLength(6);
    });
  });

  // ── Gate Entry (/gate-entry) ──────────────────────────────────────────
  describe('Gate Entry Page', () => {
    it('TC-GE-001: token not expired within TTL', () => {
      const now = Date.now();
      expect(isTokenExpired(now, 60000, now + 30000)).toBe(false);
    });
    it('TC-GE-002: token expired past TTL', () => {
      const now = Date.now();
      expect(isTokenExpired(now, 60000, now + 61000)).toBe(true);
    });
    it('TC-GE-003: nonce duplicate detection', () => {
      const seen = new Set(['abc', 'def']);
      expect(isNonceDuplicate('abc', seen)).toBe(true);
      expect(isNonceDuplicate('xyz', seen)).toBe(false);
    });
  });

  // ── Security Verify (/security/verify) ────────────────────────────────
  describe('Security Verify Page', () => {
    it('TC-SV-001: valid manual entry', () => {
      expect(validateManualEntry('A101', 'John').valid).toBe(true);
    });
    it('TC-SV-002: missing flat number', () => {
      const r = validateManualEntry('', 'John');
      expect(r.valid).toBe(false);
      expect(r.reason).toContain('Flat');
    });
    it('TC-SV-003: missing visitor name', () => {
      const r = validateManualEntry('A101', '');
      expect(r.valid).toBe(false);
      expect(r.reason).toContain('Visitor');
    });
    it('TC-SV-004: pending can transition to approved/denied/expired', () => {
      expect(MANUAL_ENTRY_TRANSITIONS.pending).toEqual(['approved', 'denied', 'expired']);
    });
    it('TC-SV-005: terminal states have no transitions', () => {
      expect(MANUAL_ENTRY_TRANSITIONS.approved).toEqual([]);
      expect(MANUAL_ENTRY_TRANSITIONS.denied).toEqual([]);
      expect(MANUAL_ENTRY_TRANSITIONS.expired).toEqual([]);
    });
  });

  // ── Security Audit (/security/audit) ──────────────────────────────────
  describe('Security Audit Page', () => {
    it('TC-SA-001: percentage computation', () => {
      expect(computePercentage(25, 100)).toBe(25);
    });
    it('TC-SA-002: percentage zero total', () => {
      expect(computePercentage(0, 0)).toBe(0);
    });
    it('TC-SA-003: average ms', () => {
      expect(computeAverageMs([100, 200, 300])).toBe(200);
    });
    it('TC-SA-004: average ms empty', () => {
      expect(computeAverageMs([])).toBe(0);
    });
  });

  // ── Visitor Management (/visitors) ────────────────────────────────────
  describe('Visitor Management Page', () => {
    it('TC-VIS-001: expected can check_in', () => {
      expect(VISITOR_TRANSITIONS.expected).toContain('checked_in');
    });
    it('TC-VIS-002: expected can cancel', () => {
      expect(VISITOR_TRANSITIONS.expected).toContain('cancelled');
    });
    it('TC-VIS-003: checked_in can check_out', () => {
      expect(VISITOR_TRANSITIONS.checked_in).toContain('checked_out');
    });
    it('TC-VIS-004: checked_out is terminal', () => {
      expect(VISITOR_TRANSITIONS.checked_out).toEqual([]);
    });
    it('TC-VIS-005: cancelled is terminal', () => {
      expect(VISITOR_TRANSITIONS.cancelled).toEqual([]);
    });
    it('TC-VIS-006: valid 6-digit OTP', () => {
      expect(isOTPValid('123456')).toBe(true);
    });
    it('TC-VIS-007: invalid 5-digit OTP', () => {
      expect(isOTPValid('12345')).toBe(false);
    });
    it('TC-VIS-008: OTP not expired', () => {
      expect(isOTPExpired(new Date('2099-01-01'))).toBe(false);
    });
    it('TC-VIS-009: OTP expired', () => {
      expect(isOTPExpired(new Date('2020-01-01'))).toBe(true);
    });
    it('TC-VIS-010: generated OTP is 6 digits', () => {
      const otp = generateOTP();
      expect(otp).toMatch(/^\d{6}$/);
    });
    it('TC-VIS-011: two generated OTPs are likely different', () => {
      const otps = new Set(Array.from({ length: 100 }, generateOTP));
      expect(otps.size).toBeGreaterThan(90);
    });
  });

  // ── Parcel Management (/parcels) ──────────────────────────────────────
  describe('Parcel Management Page', () => {
    it('TC-PARC-001: owner can log parcel', () => {
      expect(canLogParcel('u1', 'u1', false)).toBe(true);
    });
    it('TC-PARC-002: admin can log any parcel', () => {
      expect(canLogParcel('u1', 'u2', true)).toBe(true);
    });
    it('TC-PARC-003: non-owner non-admin cannot', () => {
      expect(canLogParcel('u1', 'u2', false)).toBe(false);
    });
    it('TC-PARC-004: filter parcels by status', () => {
      const parcels = [{ status: 'received' }, { status: 'collected' }, { status: 'received' }];
      expect(filterParcelsByStatus(parcels, 'received')).toHaveLength(2);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BUILDER PORTAL
// ═══════════════════════════════════════════════════════════════════════════

describe('Builder Portal', () => {
  describe('Builder Dashboard Page', () => {
    it('TC-BD-001: admin can access builder dashboard', () => {
      expect(canAccessBuilderDashboard(['admin'])).toBe(true);
    });
    it('TC-BD-002: builder_member can access', () => {
      expect(canAccessBuilderDashboard(['builder_member'])).toBe(true);
    });
    it('TC-BD-003: regular user cannot access', () => {
      expect(canAccessBuilderDashboard(['buyer'])).toBe(false);
    });
    it('TC-BD-004: empty roles cannot access', () => {
      expect(canAccessBuilderDashboard([])).toBe(false);
    });
    it('TC-BD-005: builder progress manage access', () => {
      expect(hasProgressManageAccess({ isAdmin: false, isSocietyAdmin: false, isBuilderMember: true })).toBe(true);
    });
    it('TC-BD-006: can post notice as builder', () => {
      expect(canPostNotice({ isAdmin: false, isSocietyAdmin: false, isBuilderMember: true })).toBe(true);
    });
  });

  describe('Builder Analytics Page', () => {
    it('TC-BA-001: cross-society aggregation', () => {
      const stats = computeBuilderSocietyStats([
        { pending_users: 5, active_sellers: 10, open_disputes: 2, open_snags: 3 },
        { pending_users: 3, active_sellers: 7, open_disputes: 1, open_snags: 4 },
      ]);
      expect(stats.totalPending).toBe(8);
      expect(stats.totalSellers).toBe(17);
      expect(stats.totalDisputes).toBe(3);
      expect(stats.totalSnags).toBe(7);
    });
    it('TC-BA-002: empty societies', () => {
      const stats = computeBuilderSocietyStats([]);
      expect(stats.totalPending).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WORKFORCE & DOMESTIC HELP
// ═══════════════════════════════════════════════════════════════════════════

describe('Workforce & Domestic Help', () => {
  // ── Worker Jobs (/worker/jobs) ────────────────────────────────────────
  describe('Worker Jobs Page', () => {
    it('TC-WJ-001: all job statuses valid', () => {
      JOB_STATUSES.forEach(s => expect(isValidJobStatus(s)).toBe(true));
    });
    it('TC-WJ-002: invalid job status', () => {
      expect(isValidJobStatus('pending')).toBe(false);
    });
    it('TC-WJ-003: all urgency levels valid', () => {
      URGENCY_LEVELS.forEach(u => expect(isValidUrgency(u)).toBe(true));
    });
    it('TC-WJ-004: invalid urgency', () => {
      expect(isValidUrgency('critical')).toBe(false);
    });
    it('TC-WJ-005: valid ratings 1-5', () => {
      [1, 2, 3, 4, 5].forEach(r => expect(isValidRating(r)).toBe(true));
    });
    it('TC-WJ-006: invalid rating 0', () => {
      expect(isValidRating(0)).toBe(false);
    });
    it('TC-WJ-007: invalid rating 6', () => {
      expect(isValidRating(6)).toBe(false);
    });
    it('TC-WJ-008: invalid fractional rating', () => {
      expect(isValidRating(3.5)).toBe(false);
    });
  });

  // ── Hire Help (/worker-hire) ──────────────────────────────────────────
  describe('Hire Help Page', () => {
    it('TC-HH-001: valid job request', () => {
      const r = jobRequestSchema.safeParse({
        job_type: 'cleaning', duration_hours: 2, urgency: 'normal',
        visibility_scope: 'society', target_society_ids: [],
      });
      expect(r.success).toBe(true);
    });
    it('TC-HH-002: nearby scope needs target societies', () => {
      const r = jobRequestSchema.safeParse({
        job_type: 'cleaning', duration_hours: 2, urgency: 'normal',
        visibility_scope: 'nearby', target_society_ids: [],
      });
      expect(r.success).toBe(false);
    });
    it('TC-HH-003: duration min 1 hour', () => {
      const r = jobRequestSchema.safeParse({
        job_type: 'x', duration_hours: 0, urgency: 'normal',
        visibility_scope: 'society', target_society_ids: [],
      });
      expect(r.success).toBe(false);
    });
    it('TC-HH-004: duration max 24 hours', () => {
      const r = jobRequestSchema.safeParse({
        job_type: 'x', duration_hours: 25, urgency: 'normal',
        visibility_scope: 'society', target_society_ids: [],
      });
      expect(r.success).toBe(false);
    });
    it('TC-HH-005: invalid urgency enum', () => {
      const r = jobRequestSchema.safeParse({
        job_type: 'x', duration_hours: 2, urgency: 'critical',
        visibility_scope: 'society', target_society_ids: [],
      });
      expect(r.success).toBe(false);
    });
  });

  // ── Domestic Help (/domestic-help) ────────────────────────────────────
  describe('Domestic Help Page', () => {
    it('TC-DH-001: active worker with flats valid', () => {
      expect(validateWorkerEntry({ status: 'active', deactivated_at: null, flat_count: 3 }).valid).toBe(true);
    });
    it('TC-DH-002: suspended worker invalid', () => {
      expect(validateWorkerEntry({ status: 'suspended', deactivated_at: null, flat_count: 1 }).valid).toBe(false);
    });
    it('TC-DH-003: deactivated worker invalid', () => {
      expect(validateWorkerEntry({ status: 'active', deactivated_at: '2025-01-01', flat_count: 1 }).valid).toBe(false);
    });
    it('TC-DH-004: zero flats invalid', () => {
      expect(validateWorkerEntry({ status: 'active', deactivated_at: null, flat_count: 0 }).valid).toBe(false);
    });
    it('TC-DH-005: null worker invalid', () => {
      expect(validateWorkerEntry(null).valid).toBe(false);
    });
    it('TC-DH-006: worker registration schema valid', () => {
      const r = workerRegistrationSchema.safeParse({
        name: 'Ram', workerType: 'cook', shiftStart: '08:00', shiftEnd: '12:00',
        entryFrequency: 'daily', preferredLanguage: 'hi',
      });
      expect(r.success).toBe(true);
    });
    it('TC-DH-007: worker schema shift end before start fails', () => {
      const r = workerRegistrationSchema.safeParse({
        name: 'Ram', workerType: 'cook', shiftStart: '12:00', shiftEnd: '08:00',
        entryFrequency: 'daily', preferredLanguage: 'hi',
      });
      expect(r.success).toBe(false);
    });
  });

  // ── Workforce Management (/workforce) ─────────────────────────────────
  describe('Workforce Management Page', () => {
    it('TC-WF-001: all worker statuses valid', () => {
      WORKER_STATUSES.forEach(s => expect(isValidWorkerStatus(s)).toBe(true));
    });
    it('TC-WF-002: invalid worker status', () => {
      expect(isValidWorkerStatus('fired')).toBe(false);
    });
    it('TC-WF-003: all entry frequencies valid', () => {
      ENTRY_FREQUENCIES.forEach(f => expect(isValidEntryFrequency(f)).toBe(true));
    });
    it('TC-WF-004: invalid entry frequency', () => {
      expect(isValidEntryFrequency('weekly')).toBe(false);
    });
    it('TC-WF-005: absent worker computation', () => {
      expect(computeAbsentWorkers(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AMENITIES
// ═══════════════════════════════════════════════════════════════════════════

describe('Amenities', () => {
  describe('Vehicle Parking Page', () => {
    it('TC-PARK-001: formatPrice works for parking fee', () => {
      expect(formatPrice(500)).toBe('₹500');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

describe('Notifications', () => {
  describe('Notification Inbox Page', () => {
    it('TC-NOTIF-001: SLA deadline computation', () => {
      const created = new Date('2025-01-01T00:00:00Z');
      const deadline = computeSLADeadline(created, 48);
      expect(deadline.toISOString()).toBe('2025-01-03T00:00:00.000Z');
    });
    it('TC-NOTIF-002: SLA not breached before deadline', () => {
      expect(isSLABreached(new Date('2099-01-01'))).toBe(false);
    });
    it('TC-NOTIF-003: SLA breached after deadline', () => {
      expect(isSLABreached(new Date('2020-01-01'))).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════════════

describe('Admin Panel', () => {
  it('TC-ADM-001: feature state enabled', () => {
    expect(getFeatureState({ source: 'custom', is_enabled: true, society_configurable: true }, true)).toBe('enabled');
  });
  it('TC-ADM-002: feature state disabled without society', () => {
    expect(getFeatureState({ source: 'custom', is_enabled: true, society_configurable: true }, false)).toBe('disabled');
  });
  it('TC-ADM-003: core feature is locked', () => {
    expect(getFeatureState({ source: 'core', is_enabled: true, society_configurable: false }, true)).toBe('locked');
  });
  it('TC-ADM-004: null feature is unavailable', () => {
    expect(getFeatureState(null, true)).toBe('unavailable');
  });
  it('TC-ADM-005: enabled/locked are accessible', () => {
    expect(isFeatureAccessible('enabled')).toBe(true);
    expect(isFeatureAccessible('locked')).toBe(true);
  });
  it('TC-ADM-006: disabled/unavailable not accessible', () => {
    expect(isFeatureAccessible('disabled')).toBe(false);
    expect(isFeatureAccessible('unavailable')).toBe(false);
  });
  it('TC-ADM-007: polling interval valid range', () => {
    expect(isPollingIntervalValid(4000)).toBe(true);
    expect(isPollingIntervalValid(5000)).toBe(true);
    expect(isPollingIntervalValid(3999)).toBe(false);
  });
  it('TC-ADM-008: countdown decrement', () => {
    expect(decrementCountdown(10, 3)).toBe(7);
    expect(decrementCountdown(2, 5)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ORDER STATUS MACHINE
// ═══════════════════════════════════════════════════════════════════════════

describe('Order Status Machine', () => {
  // Valid transitions
  const validPairs: [string, string][] = [
    ['placed', 'accepted'], ['placed', 'cancelled'],
    ['accepted', 'preparing'], ['accepted', 'cancelled'],
    ['preparing', 'ready'], ['preparing', 'cancelled'],
    ['ready', 'picked_up'], ['ready', 'delivered'], ['ready', 'completed'], ['ready', 'cancelled'],
    ['picked_up', 'delivered'], ['picked_up', 'completed'],
    ['delivered', 'completed'], ['delivered', 'returned'],
    ['enquired', 'quoted'], ['enquired', 'cancelled'],
    ['quoted', 'accepted'], ['quoted', 'scheduled'], ['quoted', 'cancelled'],
    ['scheduled', 'in_progress'], ['scheduled', 'cancelled'],
    ['in_progress', 'completed'], ['in_progress', 'cancelled'],
  ];

  validPairs.forEach(([from, to]) => {
    it(`TC-OSM-VALID: ${from} -> ${to}`, () => {
      expect(isValidOrderTransition(from, to)).toBe(true);
    });
  });

  // Invalid transitions
  const invalidPairs: [string, string][] = [
    ['completed', 'cancelled'], ['completed', 'placed'],
    ['cancelled', 'placed'], ['cancelled', 'accepted'],
    ['returned', 'completed'], ['returned', 'cancelled'],
    ['placed', 'ready'], ['placed', 'completed'], ['placed', 'delivered'],
    ['accepted', 'delivered'], ['preparing', 'delivered'],
  ];

  invalidPairs.forEach(([from, to]) => {
    it(`TC-OSM-INVALID: ${from} -> ${to}`, () => {
      expect(isValidOrderTransition(from, to)).toBe(false);
    });
  });

  // Terminal states
  TERMINAL_ORDER_STATES.forEach(state => {
    it(`TC-OSM-TERMINAL: ${state} has no transitions`, () => {
      expect(ALLOWED_ORDER_TRANSITIONS[state]).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATION TITLE COMPLETENESS
// ═══════════════════════════════════════════════════════════════════════════

describe('Notification Title Completeness', () => {
  const buyerStatuses = ['accepted', 'preparing', 'ready', 'picked_up', 'delivered', 'completed', 'cancelled', 'quoted', 'scheduled'];
  buyerStatuses.forEach(s => {
    it(`TC-NT-BUYER-${s}: buyer gets title for ${s}`, () => {
      expect(getOrderNotifTitle(s, 'buyer')).not.toBeNull();
    });
  });

  it('TC-NT-BUYER-NULL: buyer placed returns null', () => {
    expect(getOrderNotifTitle('placed', 'buyer')).toBeNull();
  });

  it('TC-NT-SELLER-PLACED: seller gets title for placed', () => {
    expect(getOrderNotifTitle('placed', 'seller')).not.toBeNull();
  });
  it('TC-NT-SELLER-CANCEL: seller gets title for cancelled', () => {
    expect(getOrderNotifTitle('cancelled', 'seller')).not.toBeNull();
  });

  const sellerNulls = ['preparing', 'ready', 'delivered', 'completed', 'quoted', 'scheduled'];
  sellerNulls.forEach(s => {
    it(`TC-NT-SELLER-NULL-${s}: seller ${s} returns null`, () => {
      expect(getOrderNotifTitle(s, 'seller')).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ORDER TYPE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Order Type Classification', () => {
  it('TC-OTC-001: add_to_cart -> purchase', () => {
    expect(classifyOrderType('add_to_cart')).toBe('purchase');
  });
  it('TC-OTC-002: buy_now -> purchase', () => {
    expect(classifyOrderType('buy_now')).toBe('purchase');
  });
  it('TC-OTC-003: book -> booking', () => {
    expect(classifyOrderType('book')).toBe('booking');
  });
  it('TC-OTC-004: request_service -> booking', () => {
    expect(classifyOrderType('request_service')).toBe('booking');
  });
  it('TC-OTC-005: schedule_visit -> booking', () => {
    expect(classifyOrderType('schedule_visit')).toBe('booking');
  });
  it('TC-OTC-006: request_quote -> enquiry', () => {
    expect(classifyOrderType('request_quote')).toBe('enquiry');
  });
  it('TC-OTC-007: contact_seller -> enquiry', () => {
    expect(classifyOrderType('contact_seller')).toBe('enquiry');
  });
  it('TC-OTC-008: make_offer -> enquiry', () => {
    expect(classifyOrderType('make_offer')).toBe('enquiry');
  });
  it('TC-OTC-009: unknown -> purchase default', () => {
    expect(classifyOrderType('unknown')).toBe('purchase');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELIVERY ASSIGNMENT
// ═══════════════════════════════════════════════════════════════════════════

describe('Delivery Assignment', () => {
  it('TC-DA-001: auto-assign for delivery with address', () => {
    expect(shouldAutoAssignDelivery({ fulfillment_type: 'delivery', delivery_address: 'Flat A1' })).toBe(true);
  });
  it('TC-DA-002: no auto-assign for self_pickup', () => {
    expect(shouldAutoAssignDelivery({ fulfillment_type: 'self_pickup', delivery_address: 'Flat A1' })).toBe(false);
  });
  it('TC-DA-003: no auto-assign without address', () => {
    expect(shouldAutoAssignDelivery({ fulfillment_type: 'delivery', delivery_address: null })).toBe(false);
  });
  it('TC-DA-004: valid delivery code 4 digits', () => {
    expect(isDeliveryCodeValid('1234')).toBe(true);
  });
  it('TC-DA-005: valid delivery code 6 digits', () => {
    expect(isDeliveryCodeValid('123456')).toBe(true);
  });
  it('TC-DA-006: invalid delivery code 3 digits', () => {
    expect(isDeliveryCodeValid('123')).toBe(false);
  });
  it('TC-DA-007: invalid delivery code letters', () => {
    expect(isDeliveryCodeValid('abcd')).toBe(false);
  });
  it('TC-DA-008: delivery status labels', () => {
    expect(getDeliveryStatusLabel('pending')).toBe('Pending');
    expect(getDeliveryStatusLabel('delivered')).toBe('Delivered');
    expect(getDeliveryStatusLabel('xyz')).toBe('Unknown');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-MODULE INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Cross-Module Integration', () => {
  it('TC-INT-001: cart -> order -> notification flow', () => {
    // Cart total
    const items = [{ unit_price: 200, quantity: 2 }, { unit_price: 100, quantity: 1 }];
    const subtotal = computeCartTotal(items);
    expect(subtotal).toBe(500);
    // Final amount with delivery
    const finalAmt = computeFinalAmount(subtotal, 0, 30);
    expect(finalAmt).toBe(530);
    // After order placed, seller gets notification
    expect(getOrderNotifTitle('placed', 'seller')).toBe('🆕 New Order Received!');
    // After accepted, buyer gets notification
    expect(getOrderNotifTitle('accepted', 'buyer')).toBe('✅ Order Accepted!');
  });

  it('TC-INT-002: seller verification -> product visibility -> search', () => {
    // Unverified seller's products not visible
    expect(isProductVisible('pending', true)).toBe(false);
    // Approved product is visible
    expect(isProductVisible('approved', true)).toBe(true);
    // Seller access check
    expect(canAccessSellerDetail({ verificationStatus: 'approved', sellerSocietyId: 's1', buyerSocietyId: 's1', sellBeyondCommunity: false })).toBe(true);
  });

  it('TC-INT-003: worker validation -> gate entry', () => {
    // Valid worker
    const entry = validateWorkerEntry({ status: 'active', deactivated_at: null, flat_count: 2 });
    expect(entry.valid).toBe(true);
    // Token not expired
    expect(isTokenExpired(Date.now(), 60000, Date.now() + 30000)).toBe(false);
  });

  it('TC-INT-004: finance + dispute + maintenance combined', () => {
    const finance = computeFinanceSummary([{ amount: 1000 }], [{ amount: 5000 }]);
    expect(finance.balance).toBe(4000);
    const disputeRate = computeDisputeResolutionRate(10, 9);
    expect(disputeRate).toBe(90);
    const maintenanceRate = computeMaintenanceCollectionRate(90, 10);
    expect(maintenanceRate).toBe(90);
  });

  it('TC-INT-005: feature gate -> dashboard visibility -> route', () => {
    const sections: DashboardSection[] = [
      { label: 'Bulletin', feature: 'bulletin' },
      { label: 'Security', feature: 'security_gate' },
    ];
    // Bulletin disabled
    const result = filterDashboardSections(sections, f => f !== 'bulletin', false, false);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Security');
    // Verify route classification
    expect(isPublicRoute('/community')).toBe(false); // requires auth
  });

  it('TC-INT-006: coupon + cart + payment integration', () => {
    const coupon = {
      is_active: true, society_id: 's1', expires_at: '2099-01-01',
      starts_at: '2020-01-01', usage_limit: 100, times_used: 0,
      per_user_limit: 5, min_order_amount: 200,
    };
    const cartTotal = computeCartTotal([{ unit_price: 300, quantity: 1 }]);
    const couponResult = isCouponApplicable(coupon, 's1', cartTotal, 0);
    expect(couponResult.applicable).toBe(true);
    const finalAmt = computeFinalAmount(cartTotal, 50, 0);
    expect(finalAmt).toBe(250);
    const { fee, net } = computePlatformFee(250, 5);
    expect(fee).toBe(12.5);
    expect(net).toBe(237.5);
  });

  it('TC-INT-007: order status machine end-to-end', () => {
    // Full lifecycle: placed -> accepted -> preparing -> ready -> delivered -> completed
    const lifecycle = ['placed', 'accepted', 'preparing', 'ready', 'delivered', 'completed'];
    for (let i = 0; i < lifecycle.length - 1; i++) {
      expect(isValidOrderTransition(lifecycle[i], lifecycle[i + 1])).toBe(true);
    }
    // Can't go back
    expect(isValidOrderTransition('completed', 'placed')).toBe(false);
    // Can reorder from completed
    expect(canReorder('completed')).toBe(true);
  });
});
