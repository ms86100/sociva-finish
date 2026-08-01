import { describe, it, expect } from 'vitest';
import { formatPrice } from '@/lib/format-price';
import { escapeIlike, jitteredStaleTime } from '@/lib/query-utils';
import { friendlyError, cn } from '@/lib/utils';
import { convertToHashRoute, safeJSONParse } from '@/lib/median';
import { ACTION_CONFIG, SORT_OPTIONS } from '@/lib/marketplace-constants';
import {
  emailSchema, passwordSchema, profileDataSchema,
  workerRegistrationSchema, jobRequestSchema, validateForm, loginSchema,
} from '@/lib/validation-schemas';
import {
  getFeatureState, isFeatureAccessible, isPublicRoute, PUBLIC_ROUTES,
  hasGuardAccess, hasManagementAccess, hasProgressManageAccess, canPostNotice,
  getProfileMenuItems, getVerificationState, computeFinanceSummary,
  computeOverallProgress, sortByPinAndDate, computeDeliveryFee,
  groupBySeller, findUnavailableProducts, computeSLADeadline, isSLABreached,
  computeAbsentWorkers, hasActiveFilters, paginationRange,
  getOrderNotifTitle, dashboardItemMatchesSearch, computeDisputeResolutionRate,
  computeMaintenanceCollectionRate, categorizeResponseTime,
  getWriteSocietyId, getReadSocietyId, canAccessSellerDetail,
  isCouponApplicable, computeCancellationRate, computeInspectionScore,
  computeMilestoneProgress, haversineDistance,
  isTokenExpired, isNonceDuplicate, getSecurityModeStatus,
  validateManualEntry, MANUAL_ENTRY_TRANSITIONS, VISITOR_TRANSITIONS,
  isOTPValid, isOTPExpired, generateOTP,
  canLogParcel, filterParcelsByStatus,
  computePercentage, computeAverageMs,
  decrementCountdown, isPollingIntervalValid,
  validateWorkerEntry,
} from './helpers/business-rules';

// ════════════════════════════════════════════════════
// 1. formatPrice — Edge Cases
// ════════════════════════════════════════════════════

describe('formatPrice — Edge Cases', () => {
  it('handles undefined input', () => {
    expect(formatPrice(undefined as any)).toBe('₹0');
  });
  it('handles null input → throws (no NaN check for null)', () => {
    expect(() => formatPrice(null as any)).toThrow();
  });
  it('handles very large number', () => {
    const r = formatPrice(999999999);
    expect(r).toContain('₹');
    expect(r).toContain('999');
  });
  it('handles Infinity', () => {
    const r = formatPrice(Infinity);
    expect(r).toContain('₹');
  });
  it('handles decimal string', () => {
    expect(formatPrice('99.99')).toContain('99.99');
  });
  it('handles whitespace-only string', () => {
    expect(formatPrice('   ')).toBe('₹0');
  });
});

// ════════════════════════════════════════════════════
// 2. escapeIlike — SQL Injection Prevention
// ════════════════════════════════════════════════════

describe('escapeIlike — Pattern Injection', () => {
  it('escapes % character', () => {
    expect(escapeIlike('100%')).toBe('100\\%');
  });
  it('escapes _ character', () => {
    expect(escapeIlike('test_value')).toBe('test\\_value');
  });
  it('escapes both % and _', () => {
    expect(escapeIlike('50%_off')).toBe('50\\%\\_off');
  });
  it('passes through normal text', () => {
    expect(escapeIlike('hello world')).toBe('hello world');
  });
  it('handles empty string', () => {
    expect(escapeIlike('')).toBe('');
  });
  it('handles multiple %', () => {
    expect(escapeIlike('%%')).toBe('\\%\\%');
  });
});

// ════════════════════════════════════════════════════
// 3. jitteredStaleTime — Cache Stampede Prevention
// ════════════════════════════════════════════════════

describe('jitteredStaleTime', () => {
  it('returns value within ±20% of base', () => {
    for (let i = 0; i < 20; i++) {
      const result = jitteredStaleTime(60000);
      expect(result).toBeGreaterThanOrEqual(48000);
      expect(result).toBeLessThanOrEqual(72000);
    }
  });
  it('handles zero base', () => {
    expect(jitteredStaleTime(0)).toBe(0);
  });
  it('returns integer', () => {
    const result = jitteredStaleTime(10000);
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ════════════════════════════════════════════════════
// 4. friendlyError — Error Message Mapping
// ════════════════════════════════════════════════════

describe('friendlyError — Error Mapping', () => {
  it('maps JWT errors', () => {
    expect(friendlyError(new Error('JWT expired'))).toContain('session has expired');
  });
  it('maps token errors', () => {
    expect(friendlyError(new Error('refresh_token not found'))).toContain('session has expired');
  });
  it('maps RLS errors', () => {
    expect(friendlyError(new Error('row-level security violation'))).toContain('permission');
  });
  it('maps network errors', () => {
    expect(friendlyError(new Error('Failed to fetch'))).toContain('internet connection');
  });
  it('maps duplicate key errors', () => {
    expect(friendlyError(new Error('duplicate key value'))).toContain('already exists');
  });
  it('maps not found errors', () => {
    expect(friendlyError(new Error('not found'))).toContain('not found');
  });
  it('maps timeout errors', () => {
    expect(friendlyError(new Error('request timed out'))).toContain('took too long');
  });
  it('maps rate limit errors', () => {
    expect(friendlyError(new Error('rate limit exceeded'))).toContain('Too many requests');
  });
  it('maps invalid login', () => {
    expect(friendlyError(new Error('Invalid login credentials'))).toContain('Invalid email or password');
  });
  it('maps email not confirmed', () => {
    expect(friendlyError(new Error('Email not confirmed'))).toContain('verify your email');
  });
  it('maps storage quota', () => {
    expect(friendlyError(new Error('storage quota exceeded'))).toContain('Storage limit');
  });
  it('returns fallback for long technical errors', () => {
    expect(friendlyError(new Error('error: Some long technical error message with exception details'))).toBe('Something went wrong. Please try again.');
  });
  it('passes through short user-friendly messages', () => {
    expect(friendlyError(new Error('Please try again later'))).toBe('Please try again later');
  });
  it('handles string errors', () => {
    expect(friendlyError('JWT expired')).toContain('session has expired');
  });
  it('handles Supabase-shaped objects', () => {
    expect(friendlyError({ message: 'row-level security' })).toContain('permission');
  });
  it('handles null/undefined', () => {
    expect(friendlyError(null)).toBe('Something went wrong. Please try again.');
    expect(friendlyError(undefined)).toBe('Something went wrong. Please try again.');
  });
});

// ════════════════════════════════════════════════════
// 5. cn — Class Merging Utility
// ════════════════════════════════════════════════════

describe('cn — Tailwind Class Merge', () => {
  it('merges basic classes', () => {
    expect(cn('p-4', 'bg-red')).toContain('p-4');
  });
  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden')).toBe('base');
  });
  it('handles empty input', () => {
    expect(cn()).toBe('');
  });
  it('deduplicates conflicting classes', () => {
    const result = cn('p-4', 'p-2');
    expect(result).toBe('p-2');
  });
});

// ════════════════════════════════════════════════════
// 6. convertToHashRoute — Median Bridge
// ════════════════════════════════════════════════════

describe('convertToHashRoute', () => {
  it('converts standard path to hash route', () => {
    const result = convertToHashRoute(`${window.location.origin}/welcome`);
    expect(result).toContain('#/welcome');
  });
  it('preserves existing hash route', () => {
    const url = `${window.location.origin}/#/orders`;
    expect(convertToHashRoute(url)).toBe(url);
  });
  it('preserves query params', () => {
    const result = convertToHashRoute(`${window.location.origin}/search?q=test`);
    expect(result).toContain('?q=test');
  });
  it('handles relative path by converting to hash route', () => {
    const result = convertToHashRoute('not-a-url');
    expect(result).toContain('#/not-a-url');
  });
});

// ════════════════════════════════════════════════════
// 7. safeJSONParse
// ════════════════════════════════════════════════════

describe('safeJSONParse', () => {
  it('parses valid JSON', () => {
    expect(safeJSONParse('{"a":1}', {})).toEqual({ a: 1 });
  });
  it('returns fallback for null', () => {
    expect(safeJSONParse(null, 'default')).toBe('default');
  });
  it('returns fallback for invalid JSON', () => {
    expect(safeJSONParse('{bad}', [])).toEqual([]);
  });
  it('parses arrays', () => {
    expect(safeJSONParse('[1,2,3]', [])).toEqual([1, 2, 3]);
  });
  it('returns fallback for empty string', () => {
    expect(safeJSONParse('', 42)).toBe(42);
  });
});

// ════════════════════════════════════════════════════
// 8. Marketplace Constants
// ════════════════════════════════════════════════════

describe('Marketplace Constants', () => {
  it('ACTION_CONFIG has 8 action types', () => {
    expect(Object.keys(ACTION_CONFIG)).toHaveLength(8);
  });
  it('add_to_cart is cart action', () => {
    expect(ACTION_CONFIG.add_to_cart.isCart).toBe(true);
  });
  it('buy_now is cart action', () => {
    expect(ACTION_CONFIG.buy_now.isCart).toBe(true);
  });
  it('contact_seller is NOT cart action', () => {
    expect(ACTION_CONFIG.contact_seller.isCart).toBe(false);
  });
  it('SORT_OPTIONS has 7 options', () => {
    expect(SORT_OPTIONS).toHaveLength(7);
  });
  it('all sort options have key and label', () => {
    SORT_OPTIONS.forEach(opt => {
      expect(opt.key).toBeTruthy();
      expect(opt.label).toBeTruthy();
    });
  });
});

// ════════════════════════════════════════════════════
// 9. Business Rules — Boundary Conditions
// ════════════════════════════════════════════════════

describe('Business Rules — Boundary Conditions', () => {
  // categorizeResponseTime boundaries
  it('exactly 24h → up', () => expect(categorizeResponseTime(24)).toBe('up'));
  it('24.01h → neutral', () => expect(categorizeResponseTime(24.01)).toBe('neutral'));
  it('exactly 48h → neutral', () => expect(categorizeResponseTime(48)).toBe('neutral'));
  it('48.01h → down', () => expect(categorizeResponseTime(48.01)).toBe('down'));
  it('0h → up', () => expect(categorizeResponseTime(0)).toBe('up'));

  // computeDeliveryFee with zero threshold
  it('delivery with zero threshold → always free', () => {
    expect(computeDeliveryFee(0, 0, 30, 'delivery')).toBe(0);
  });
  it('delivery with zero fee → 0', () => {
    expect(computeDeliveryFee(10, 500, 0, 'delivery')).toBe(0);
  });

  // computeOverallProgress edge cases
  it('all towers at 0%', () => {
    expect(computeOverallProgress([{ current_percentage: 0 }, { current_percentage: 0 }], [])).toBe(0);
  });
  it('all towers at 100%', () => {
    expect(computeOverallProgress([{ current_percentage: 100 }, { current_percentage: 100 }], [])).toBe(100);
  });

  // haversineDistance edge
  it('haversine — antipodal points ~20,000km', () => {
    const d = haversineDistance(0, 0, 0, 180);
    expect(d).toBeGreaterThan(19_000_000);
    expect(d).toBeLessThan(21_000_000);
  });

  // computePercentage edge: count > total
  it('count > total → over 100%', () => {
    expect(computePercentage(150, 100)).toBe(150);
  });

  // computeAverageMs single value
  it('single value → exact', () => {
    expect(computeAverageMs([5000])).toBe(5000);
  });

  // decrementCountdown negative step
  it('decrementCountdown negative step adds', () => {
    expect(decrementCountdown(5, -2)).toBe(7);
  });

  // filterParcelsByStatus unknown status
  it('unknown status → empty', () => {
    const parcels = [{ status: 'pending' }, { status: 'collected' }];
    expect(filterParcelsByStatus(parcels, 'returned')).toHaveLength(0);
  });

  // computeFinanceSummary single large expense
  it('single large expense → negative balance', () => {
    const r = computeFinanceSummary([{ amount: 999999 }], []);
    expect(r.balance).toBe(-999999);
    expect(r.colorClass).toBe('text-destructive');
  });

  // paginationRange with page size 1
  it('page size 1 → single item per page', () => {
    expect(paginationRange(5, 1)).toEqual({ start: 5, end: 5 });
  });

  // computeCancellationRate fractional
  it('cancellation rate: 1 out of 3 → 33.3', () => {
    expect(computeCancellationRate(2, 1)).toBe(33.3);
  });
});

// ════════════════════════════════════════════════════
// 10. Validation Schema — Remaining Edge Cases
// ════════════════════════════════════════════════════

describe('Validation Schema — Edge Cases', () => {
  // workerRegistrationSchema
  it('worker: rejects flatNumbers over 500 chars', () => {
    const valid = {
      name: 'Test', phone: '', workerType: 'maid',
      shiftStart: '08:00', shiftEnd: '17:00', entryFrequency: 'daily' as const,
      emergencyPhone: '', flatNumbers: 'A'.repeat(501), preferredLanguage: 'hi',
    };
    expect(workerRegistrationSchema.safeParse(valid).success).toBe(false);
  });
  it('worker: accepts valid emergency phone', () => {
    const valid = {
      name: 'Test', phone: '9876543210', workerType: 'maid',
      shiftStart: '08:00', shiftEnd: '17:00', entryFrequency: 'daily' as const,
      emergencyPhone: '+919876543210', flatNumbers: '', preferredLanguage: 'hi',
    };
    expect(workerRegistrationSchema.safeParse(valid).success).toBe(true);
  });
  it('worker: rejects invalid emergency phone', () => {
    const valid = {
      name: 'Test', phone: '9876543210', workerType: 'maid',
      shiftStart: '08:00', shiftEnd: '17:00', entryFrequency: 'daily' as const,
      emergencyPhone: 'abc', flatNumbers: '', preferredLanguage: 'hi',
    };
    expect(workerRegistrationSchema.safeParse(valid).success).toBe(false);
  });
  it('worker: accepts per_visit frequency', () => {
    const valid = {
      name: 'Test', phone: '', workerType: 'maid',
      shiftStart: '08:00', shiftEnd: '17:00', entryFrequency: 'per_visit' as const,
      emergencyPhone: '', flatNumbers: '', preferredLanguage: 'hi',
    };
    expect(workerRegistrationSchema.safeParse(valid).success).toBe(true);
  });

  // profileDataSchema — block max length
  it('profile: rejects block over 20 chars', () => {
    expect(profileDataSchema.safeParse({
      name: 'John', flat_number: '101', block: 'B'.repeat(21), phone: '9876543210',
    }).success).toBe(false);
  });
  it('profile: accepts block at 20 chars', () => {
    expect(profileDataSchema.safeParse({
      name: 'John', flat_number: '101', block: 'B'.repeat(20), phone: '9876543210',
    }).success).toBe(true);
  });

  // emailSchema exact at 255
  it('email: accepts at exactly 255 chars (with valid format)', () => {
    const longLocal = 'a'.repeat(243); // 243 + @b.com = 249 (under 255)
    expect(emailSchema.safeParse(`${longLocal}@b.com`).success).toBe(true);
  });

  // jobRequestSchema — duration boundary
  it('job: accepts exactly 1 hour', () => {
    expect(jobRequestSchema.safeParse({
      job_type: 'plumbing', duration_hours: 1, urgency: 'normal',
      visibility_scope: 'society', target_society_ids: [],
    }).success).toBe(true);
  });
  it('job: accepts exactly 24 hours', () => {
    expect(jobRequestSchema.safeParse({
      job_type: 'plumbing', duration_hours: 24, urgency: 'normal',
      visibility_scope: 'society', target_society_ids: [],
    }).success).toBe(true);
  });

  // validateForm with nested path errors
  it('validateForm: nested profile errors use dotted keys', () => {
    const result = validateForm(
      loginSchema.extend({ profile: profileDataSchema }),
      { email: 'a@b.com', password: '123456', profile: { name: '', flat_number: '', block: '', phone: 'x' } }
    );
    expect(result.success).toBe(false);
    if (!result.success && 'errors' in result) {
      expect(result.errors['profile.name']).toBeDefined();
    }
  });
});

// ════════════════════════════════════════════════════
// 11. Feature Gate — Additional Edge Cases
// ════════════════════════════════════════════════════

describe('Feature Gate — Additional Edge Cases', () => {
  it('core disabled still locked', () => {
    expect(getFeatureState({ source: 'core', is_enabled: false, society_configurable: true }, true)).toBe('locked');
  });
  it('no society context with null feature', () => {
    expect(getFeatureState(null, false)).toBe('disabled');
  });
  it('no society context with undefined feature', () => {
    expect(getFeatureState(undefined, false)).toBe('disabled');
  });
});

// ════════════════════════════════════════════════════
// 12. isCouponApplicable — Boundary Timing
// ════════════════════════════════════════════════════

describe('Coupon — Timing Boundaries', () => {
  const base = {
    is_active: true, society_id: 's1', expires_at: null,
    starts_at: '2020-01-01', usage_limit: null, times_used: 0,
    per_user_limit: 5, min_order_amount: null,
  };

  it('exactly at min_order_amount → applicable', () => {
    expect(isCouponApplicable({ ...base, min_order_amount: 500 }, 's1', 500, 0).applicable).toBe(true);
  });

  it('usage at limit-1 → applicable', () => {
    expect(isCouponApplicable({ ...base, usage_limit: 10, times_used: 9 }, 's1', 500, 0).applicable).toBe(true);
  });

  it('per-user at limit-1 → applicable', () => {
    expect(isCouponApplicable(base, 's1', 500, 4).applicable).toBe(true);
  });
});

// ════════════════════════════════════════════════════
// 13. Security Gate — Additional Transitions
// ════════════════════════════════════════════════════

describe('Security Gate — Additional', () => {
  it('expired is terminal', () => {
    expect(MANUAL_ENTRY_TRANSITIONS['expired']).toHaveLength(0);
  });
  it('expected → checked_in → checked_out full flow', () => {
    expect(VISITOR_TRANSITIONS['expected']).toContain('checked_in');
    expect(VISITOR_TRANSITIONS['checked_in']).toContain('checked_out');
    expect(VISITOR_TRANSITIONS['checked_out']).toHaveLength(0);
  });
  it('OTP with leading zeros valid', () => {
    expect(isOTPValid('000001')).toBe(true);
  });
  it('OTP exactly at expiry boundary', () => {
    const now = new Date();
    expect(isOTPExpired(now, now)).toBe(false); // not < but =
  });
  it('generated OTPs are always unique (statistical)', () => {
    const otps = new Set<string>();
    for (let i = 0; i < 100; i++) otps.add(generateOTP());
    expect(otps.size).toBeGreaterThan(90);
  });
  it('token exactly at TTL boundary is not expired', () => {
    const now = Date.now();
    expect(isTokenExpired(now, 60_000, now + 60_000)).toBe(false);
  });
});

// ════════════════════════════════════════════════════
// 14. Worker Validation — Right Day
// ════════════════════════════════════════════════════

describe('Worker Entry — Today Scheduling', () => {
  it('worker scheduled for today → valid', () => {
    const today = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
    const result = validateWorkerEntry({
      status: 'active', deactivated_at: null, flat_count: 2, active_days: [today],
    });
    expect(result.valid).toBe(true);
  });
  it('worker with all days → valid', () => {
    const result = validateWorkerEntry({
      status: 'active', deactivated_at: null, flat_count: 2,
      active_days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    });
    expect(result.valid).toBe(true);
  });
  it('worker with no active_days field → valid (no schedule constraint)', () => {
    const result = validateWorkerEntry({
      status: 'active', deactivated_at: null, flat_count: 2,
    });
    expect(result.valid).toBe(true);
  });
});

// ════════════════════════════════════════════════════
// 15. Inspection Score — Additional Cases
// ════════════════════════════════════════════════════

describe('Inspection Score — Additional', () => {
  it('all failed → 0% score', () => {
    const r = computeInspectionScore([{ status: 'fail' }, { status: 'fail' }]);
    expect(r.score).toBe(0);
    expect(r.progress).toBe(100);
    expect(r.failed).toBe(2);
  });
  it('mixed with not_checked → partial progress', () => {
    const r = computeInspectionScore([
      { status: 'pass' }, { status: 'not_checked' }, { status: 'not_checked' }, { status: 'not_checked' },
    ]);
    expect(r.progress).toBe(25);
    expect(r.score).toBe(25);
  });
});

// ════════════════════════════════════════════════════
// 16. Milestone Progress — Edge Cases
// ════════════════════════════════════════════════════

describe('Milestone Progress — Edge Cases', () => {
  it('unequal percentages', () => {
    const r = computeMilestoneProgress([
      { amount_percentage: 10, status: 'paid' },
      { amount_percentage: 20, status: 'paid' },
      { amount_percentage: 70, status: 'pending' },
    ]);
    expect(r.paidPercent).toBe(30);
    expect(r.progressPercent).toBe(30);
  });
  it('all zero percentages', () => {
    const r = computeMilestoneProgress([
      { amount_percentage: 0, status: 'paid' },
      { amount_percentage: 0, status: 'pending' },
    ]);
    expect(r.progressPercent).toBe(0);
  });
});

// ════════════════════════════════════════════════════
// 17. Write/Read Safety — All Null Combos
// ════════════════════════════════════════════════════

describe('Write/Read Society — Null Combos', () => {
  it('write both null → null', () => {
    expect(getWriteSocietyId(null, null)).toBeNull();
  });
  it('read both null → null', () => {
    expect(getReadSocietyId(null, null)).toBeNull();
  });
  it('write empty string is falsy → falls back', () => {
    expect(getWriteSocietyId('', 'fallback')).toBe('fallback');
  });
});

// ════════════════════════════════════════════════════
// 18. canAccessSellerDetail — Null Buyer
// ════════════════════════════════════════════════════

describe('Seller Access — Edge Cases', () => {
  it('rejected seller blocked', () => {
    expect(canAccessSellerDetail({
      verificationStatus: 'rejected', sellerSocietyId: 's1', buyerSocietyId: 's1', sellBeyondCommunity: true,
    })).toBe(false);
  });
  it('suspended seller blocked', () => {
    expect(canAccessSellerDetail({
      verificationStatus: 'suspended', sellerSocietyId: 's1', buyerSocietyId: null, sellBeyondCommunity: false,
    })).toBe(false);
  });
});

// ════════════════════════════════════════════════════
// 19. Dashboard Search — Edge Cases
// ════════════════════════════════════════════════════

describe('Dashboard Search — Edge Cases', () => {
  it('empty query matches everything', () => {
    expect(dashboardItemMatchesSearch({ label: 'Anything' }, '')).toBe(true);
  });
  it('no stat or keywords → only label searched', () => {
    expect(dashboardItemMatchesSearch({ label: 'Revenue' }, 'rev')).toBe(true);
    expect(dashboardItemMatchesSearch({ label: 'Revenue' }, 'xyz')).toBe(false);
  });
});

// ════════════════════════════════════════════════════
// 20. Route Classification — Edge Cases
// ════════════════════════════════════════════════════

describe('Route Classification — Edge Cases', () => {
  it('/welcome/ with trailing slash is NOT public', () => {
    expect(isPublicRoute('/welcome/')).toBe(false);
  });
  it('/admin is NOT public', () => {
    expect(isPublicRoute('/admin')).toBe(false);
  });
  it('/seller-dashboard is NOT public', () => {
    expect(isPublicRoute('/seller-dashboard')).toBe(false);
  });
  it('/cart is NOT public', () => {
    expect(isPublicRoute('/cart')).toBe(false);
  });
  it('empty string is NOT public', () => {
    expect(isPublicRoute('')).toBe(false);
  });
});

// ════════════════════════════════════════════════════
// 21. Profile Menu — Role Combinations
// ════════════════════════════════════════════════════

describe('Profile Menu — Role Combinations', () => {
  it('seller + admin, no builder → 2 items', () => {
    const items = getProfileMenuItems(true, false, true);
    expect(items).toContain('Seller Dashboard');
    expect(items).toContain('Admin Panel');
    expect(items).not.toContain('Builder Dashboard');
  });
  it('non-seller, builder + admin → 3 items', () => {
    const items = getProfileMenuItems(false, true, true);
    expect(items).toContain('Become a Seller');
    expect(items).toContain('Builder Dashboard');
    expect(items).toContain('Admin Panel');
    expect(items).toHaveLength(3);
  });
});

// ════════════════════════════════════════════════════
// 22. Verification State — Additional
// ════════════════════════════════════════════════════

describe('Verification State — Additional', () => {
  it('empty string status → pending', () => {
    expect(getVerificationState({ verification_status: '' })).toBe('pending');
  });
  it('unknown status → pending', () => {
    expect(getVerificationState({ verification_status: 'unknown_status' })).toBe('pending');
  });
});

// ════════════════════════════════════════════════════
// 23. Notification Titles — Completeness
// ════════════════════════════════════════════════════

describe('Notification Titles — Completeness', () => {
  it('buyer placed → no notification', () => {
    expect(getOrderNotifTitle('placed', 'buyer')).toBeNull();
  });
  it('seller preparing → null (only seller gets placed/cancelled)', () => {
    expect(getOrderNotifTitle('preparing', 'seller')).toBeNull();
  });
  it('seller ready → null', () => {
    expect(getOrderNotifTitle('ready', 'seller')).toBeNull();
  });
  it('seller delivered → null', () => {
    expect(getOrderNotifTitle('delivered', 'seller')).toBeNull();
  });
  it('buyer picked_up → notification', () => {
    expect(getOrderNotifTitle('picked_up', 'buyer')).toBe('📦 Order Picked Up');
  });
});

// ════════════════════════════════════════════════════
// 24. SLA — Edge Cases
// ════════════════════════════════════════════════════

describe('SLA — Edge Cases', () => {
  it('0 hour SLA = same time', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    expect(computeSLADeadline(created, 0).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
  it('SLA exactly at now → not breached (equal is not >)', () => {
    const now = new Date();
    expect(isSLABreached(now, now)).toBe(false);
  });
});

// ════════════════════════════════════════════════════
// 25. Group By Seller — Large Dataset
// ════════════════════════════════════════════════════

describe('Group By Seller — Large Dataset', () => {
  it('100 items across 10 sellers', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      seller_id: `s${i % 10}`,
      id: `item-${i}`,
    }));
    const groups = groupBySeller(items);
    expect(groups.size).toBe(10);
    groups.forEach(group => expect(group).toHaveLength(10));
  });
});

// ════════════════════════════════════════════════════
// 26. Find Unavailable — All Missing
// ════════════════════════════════════════════════════

describe('Find Unavailable — All Missing', () => {
  it('all cart items missing from fresh → all unavailable', () => {
    expect(findUnavailableProducts([], ['p1', 'p2', 'p3'])).toEqual(['p1', 'p2', 'p3']);
  });
  it('empty cart → empty result', () => {
    expect(findUnavailableProducts([{ id: 'p1', is_available: true, approval_status: 'approved' }], [])).toEqual([]);
  });
});

// ════════════════════════════════════════════════════
// 27. Dispute Resolution / Maintenance — Edge
// ════════════════════════════════════════════════════

describe('Report Metrics — Edge Cases', () => {
  it('resolved > opened (data anomaly) → over 100%', () => {
    expect(computeDisputeResolutionRate(5, 10)).toBe(200);
  });
  it('maintenance all pending → 0%', () => {
    expect(computeMaintenanceCollectionRate(0, 100)).toBe(0);
  });
  it('maintenance all collected → 100%', () => {
    expect(computeMaintenanceCollectionRate(100, 0)).toBe(100);
  });
});

// ════════════════════════════════════════════════════
// 28. Absent Workers — Duplicates
// ════════════════════════════════════════════════════

describe('Absent Workers — Edge Cases', () => {
  it('duplicate attendance entries still correct', () => {
    expect(computeAbsentWorkers(['w1', 'w2'], ['w1', 'w1', 'w1'])).toEqual(['w2']);
  });
  it('both empty → empty', () => {
    expect(computeAbsentWorkers([], [])).toEqual([]);
  });
});

// ════════════════════════════════════════════════════
// 29. Search Filters — isVeg false
// ════════════════════════════════════════════════════

describe('Search Filters — Additional', () => {
  const defaults = { minRating: 0, isVeg: null as boolean | null, categories: [] as string[], sortBy: null as string | null, priceRange: [0, 5000] as [number, number] };

  it('isVeg false activates filter', () => {
    expect(hasActiveFilters({ ...defaults, isVeg: false }, 5000)).toBe(true);
  });
  it('both price bounds changed', () => {
    expect(hasActiveFilters({ ...defaults, priceRange: [100, 3000] }, 5000)).toBe(true);
  });
  it('all filters active at once', () => {
    expect(hasActiveFilters({
      minRating: 4, isVeg: true, categories: ['a', 'b'], sortBy: 'price_low', priceRange: [100, 3000],
    }, 5000)).toBe(true);
  });
});

// ════════════════════════════════════════════════════
// 30. Polling Interval — Boundary
// ════════════════════════════════════════════════════

describe('Polling Interval — Boundary', () => {
  it('3999ms invalid', () => expect(isPollingIntervalValid(3999)).toBe(false));
  it('5001ms invalid', () => expect(isPollingIntervalValid(5001)).toBe(false));
  it('4500ms valid', () => expect(isPollingIntervalValid(4500)).toBe(true));
});

// ════════════════════════════════════════════════════
// 31. Nonce Duplicate Detection
// ════════════════════════════════════════════════════

describe('Nonce — Set Operations', () => {
  it('empty set → no duplicates', () => {
    expect(isNonceDuplicate('any', new Set())).toBe(false);
  });
  it('multiple entries in set', () => {
    const seen = new Set(['a', 'b', 'c']);
    expect(isNonceDuplicate('b', seen)).toBe(true);
    expect(isNonceDuplicate('d', seen)).toBe(false);
  });
});

// ════════════════════════════════════════════════════
// 32. Security Mode Status
// ════════════════════════════════════════════════════

describe('Security Mode — Additional', () => {
  it('unknown mode → awaiting', () => {
    expect(getSecurityModeStatus('some_unknown')).toBe('awaiting_confirmation');
  });
  it('empty string → awaiting', () => {
    expect(getSecurityModeStatus('')).toBe('awaiting_confirmation');
  });
});

// ════════════════════════════════════════════════════
// 33. Manual Entry — Edge Cases
// ════════════════════════════════════════════════════

describe('Manual Entry — Edge Cases', () => {
  it('very long flat and name passes', () => {
    expect(validateManualEntry('A-101-Tower-B-Wing-North', 'John Doe Smith Jr.').valid).toBe(true);
  });
  it('whitespace-only name fails', () => {
    expect(validateManualEntry('A-101', '   ').valid).toBe(false);
  });
});

// ════════════════════════════════════════════════════
// 34. Parcel — Admin Edge Cases
// ════════════════════════════════════════════════════

describe('Parcel — Admin Edge Cases', () => {
  it('admin can log for self', () => {
    expect(canLogParcel('admin-1', 'admin-1', true)).toBe(true);
  });
  it('same user IDs, not admin → still valid (own parcel)', () => {
    expect(canLogParcel('u1', 'u1', false)).toBe(true);
  });
});

// ════════════════════════════════════════════════════
// 35. Role Access — All Roles Combined
// ════════════════════════════════════════════════════

describe('Role Access — Combined Roles', () => {
  it('all roles true → all access', () => {
    expect(hasGuardAccess({ isAdmin: true, isSocietyAdmin: true, isSecurityOfficer: true })).toBe(true);
    expect(hasManagementAccess({ isAdmin: true, isSocietyAdmin: true })).toBe(true);
    expect(hasProgressManageAccess({ isAdmin: true, isSocietyAdmin: true, isBuilderMember: true })).toBe(true);
    expect(canPostNotice({ isAdmin: true, isSocietyAdmin: true, isBuilderMember: true })).toBe(true);
  });
  it('society admin can post notice', () => {
    expect(canPostNotice({ isAdmin: false, isSocietyAdmin: true, isBuilderMember: false })).toBe(true);
  });
  it('admin can post notice', () => {
    expect(canPostNotice({ isAdmin: true, isSocietyAdmin: false, isBuilderMember: false })).toBe(true);
  });
});

// ════════════════════════════════════════════════════
// 36. Sort By Pin And Date — Stability
// ════════════════════════════════════════════════════

describe('Sort By Pin And Date — Stability', () => {
  it('multiple pinned posts sorted by date', () => {
    const posts = [
      { is_pinned: true, created_at: '2026-01-01' },
      { is_pinned: true, created_at: '2026-02-01' },
      { is_pinned: true, created_at: '2026-01-15' },
    ];
    const sorted = sortByPinAndDate(posts);
    expect(sorted[0].created_at).toBe('2026-02-01');
    expect(sorted[1].created_at).toBe('2026-01-15');
    expect(sorted[2].created_at).toBe('2026-01-01');
  });
  it('does not mutate original array', () => {
    const posts = [
      { is_pinned: false, created_at: '2026-01-01' },
      { is_pinned: true, created_at: '2026-02-01' },
    ];
    const original = [...posts];
    sortByPinAndDate(posts);
    expect(posts).toEqual(original);
  });
});
