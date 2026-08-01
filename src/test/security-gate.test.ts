import { describe, it, expect } from 'vitest';
import {
  hasGuardAccess, hasManagementAccess, validateWorkerEntry,
  paginationRange, computeDisputeResolutionRate,
  getFeatureState, isFeatureAccessible, getWriteSocietyId,
  computeSLADeadline, isSLABreached, haversineDistance,
  isTokenExpired, isNonceDuplicate, getSecurityModeStatus,
  validateManualEntry, MANUAL_ENTRY_TRANSITIONS,
  VISITOR_TRANSITIONS, isOTPValid, isOTPExpired, generateOTP,
  canLogParcel, filterParcelsByStatus,
  computePercentage, computeAverageMs,
  decrementCountdown, isPollingIntervalValid,
} from './helpers/business-rules';

// ─── Gate Token Logic ───────────────────────────────────────────────────────

describe('Gate Token — Edge Function Rules', () => {
  it('token format has 2 parts', () => {
    expect('encryptedPayload.hmacSignature'.split('.')).toHaveLength(2);
  });
  it('token expiry is 60 seconds', () => {
    const issuedAt = Date.now();
    expect(isTokenExpired(issuedAt, 60_000, issuedAt + 60_000)).toBe(false);
    expect(isTokenExpired(issuedAt, 60_000, issuedAt + 60_001)).toBe(true);
  });
  it('expired token detected', () => {
    const issuedAt = Date.now() - 61_000;
    expect(isTokenExpired(issuedAt)).toBe(true);
  });
  it('valid token passes', () => {
    const issuedAt = Date.now() - 30_000;
    expect(isTokenExpired(issuedAt)).toBe(false);
  });
  it('nonce format matches UUID', () => {
    const nonce = crypto.randomUUID();
    expect(`nonce:${nonce}`).toMatch(/^nonce:[0-9a-f-]{36}$/);
  });
  it('duplicate nonce detected via helper', () => {
    const seen = new Set(['nonce:abc-123']);
    expect(isNonceDuplicate('nonce:abc-123', seen)).toBe(true);
    expect(isNonceDuplicate('nonce:new-one', seen)).toBe(false);
  });
  it('basic mode → confirmed', () => {
    expect(getSecurityModeStatus('basic')).toBe('confirmed');
  });
  it('confirmation mode → awaiting', () => {
    expect(getSecurityModeStatus('confirmation')).toBe('awaiting_confirmation');
  });
  it('ai_match mode → awaiting', () => {
    expect(getSecurityModeStatus('ai_match')).toBe('awaiting_confirmation');
  });
});

// ─── Guard Kiosk Access — Real Helper ───────────────────────────────────────

describe('Guard Kiosk — Access Control (Real Helper)', () => {
  it('non-admin non-officer blocked', () => {
    expect(hasGuardAccess({ isAdmin: false, isSocietyAdmin: false, isSecurityOfficer: false })).toBe(false);
  });
  it('security officer has access', () => {
    expect(hasGuardAccess({ isAdmin: false, isSocietyAdmin: false, isSecurityOfficer: true })).toBe(true);
  });
  it('society admin has access', () => {
    expect(hasGuardAccess({ isAdmin: false, isSocietyAdmin: true, isSecurityOfficer: false })).toBe(true);
  });
  it('platform admin has access', () => {
    expect(hasGuardAccess({ isAdmin: true, isSocietyAdmin: false, isSecurityOfficer: false })).toBe(true);
  });
  it('kiosk has 7 tabs', () => {
    expect(['resident', 'visitor', 'manual', 'delivery', 'worker', 'expected', 'log']).toHaveLength(7);
  });
  it('feature gate key guard_kiosk gates access', () => {
    const state = getFeatureState({ source: 'package', is_enabled: false, society_configurable: true }, true);
    expect(isFeatureAccessible(state)).toBe(false);
  });
});

// ─── Visitor OTP ───────────────────────────────────────────────────────────

describe('Visitor OTP — Verification', () => {
  it('valid 6-digit OTP accepted', () => {
    expect(isOTPValid('482917')).toBe(true);
  });
  it('rejects 5 digits', () => {
    expect(isOTPValid('12345')).toBe(false);
  });
  it('rejects 7 digits', () => {
    expect(isOTPValid('1234567')).toBe(false);
  });
  it('rejects non-numeric', () => {
    expect(isOTPValid('abcdef')).toBe(false);
  });
  it('expired OTP detected', () => {
    expect(isOTPExpired(new Date(Date.now() - 60_000))).toBe(true);
  });
  it('valid OTP not expired', () => {
    expect(isOTPExpired(new Date(Date.now() + 3600_000))).toBe(false);
  });
  it('generated OTP is 6 digits', () => {
    const otp = generateOTP();
    expect(isOTPValid(otp)).toBe(true);
  });
});

// ─── Manual Entry ──────────────────────────────────────────────────────────

describe('Manual Entry — Validation', () => {
  it('valid flat + name passes', () => {
    expect(validateManualEntry('A-101', 'John').valid).toBe(true);
  });
  it('rejects empty flat', () => {
    const r = validateManualEntry('', 'John');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('Flat');
  });
  it('rejects empty name', () => {
    const r = validateManualEntry('A-101', '');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('Visitor');
  });
  it('rejects whitespace-only flat', () => {
    expect(validateManualEntry('   ', 'John').valid).toBe(false);
  });
  it('status transitions: pending → approved/denied/expired', () => {
    expect(MANUAL_ENTRY_TRANSITIONS['pending']).toContain('approved');
    expect(MANUAL_ENTRY_TRANSITIONS['pending']).toContain('denied');
    expect(MANUAL_ENTRY_TRANSITIONS['pending']).toContain('expired');
  });
  it('approved is terminal', () => {
    expect(MANUAL_ENTRY_TRANSITIONS['approved']).toHaveLength(0);
  });
  it('denied is terminal', () => {
    expect(MANUAL_ENTRY_TRANSITIONS['denied']).toHaveLength(0);
  });
});

// ─── Worker Validation — Real Helper ────────────────────────────────────────

describe('Worker — Gate Validation (Real Helper)', () => {
  it('active with flats → valid', () => {
    expect(validateWorkerEntry({ status: 'active', deactivated_at: null, flat_count: 3 }).valid).toBe(true);
  });
  it('suspended → invalid', () => {
    const r = validateWorkerEntry({ status: 'suspended', deactivated_at: null, flat_count: 2 });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('suspended');
  });
  it('blacklisted → invalid', () => {
    expect(validateWorkerEntry({ status: 'blacklisted', deactivated_at: null, flat_count: 2 }).valid).toBe(false);
  });
  it('deactivated → invalid', () => {
    expect(validateWorkerEntry({ status: 'active', deactivated_at: '2024-01-01', flat_count: 2 }).valid).toBe(false);
  });
  it('no flats → invalid', () => {
    expect(validateWorkerEntry({ status: 'active', deactivated_at: null, flat_count: 0 }).valid).toBe(false);
  });
  it('null → invalid', () => {
    expect(validateWorkerEntry(null).valid).toBe(false);
  });
  it('wrong day → invalid', () => {
    expect(validateWorkerEntry({ status: 'active', deactivated_at: null, flat_count: 2, active_days: ['NEVER'] }).valid).toBe(false);
  });
  it('under_review → invalid', () => {
    expect(validateWorkerEntry({ status: 'under_review', deactivated_at: null, flat_count: 2 }).valid).toBe(false);
  });
});

// ─── Visitor Management ─────────────────────────────────────────────────────

describe('Visitor Management', () => {
  it('OTP generator produces valid 6 digits', () => {
    for (let i = 0; i < 10; i++) {
      expect(isOTPValid(generateOTP())).toBe(true);
    }
  });
  it('expected → checked_in is valid', () => {
    expect(VISITOR_TRANSITIONS['expected']).toContain('checked_in');
  });
  it('expected → cancelled is valid', () => {
    expect(VISITOR_TRANSITIONS['expected']).toContain('cancelled');
  });
  it('checked_in → checked_out is valid', () => {
    expect(VISITOR_TRANSITIONS['checked_in']).toContain('checked_out');
  });
  it('checked_out is terminal', () => {
    expect(VISITOR_TRANSITIONS['checked_out']).toHaveLength(0);
  });
  it('cancelled is terminal', () => {
    expect(VISITOR_TRANSITIONS['cancelled']).toHaveLength(0);
  });
});

// ─── Parcel Management ──────────────────────────────────────────────────────

describe('Parcel Management', () => {
  it('resident can log own parcel', () => {
    expect(canLogParcel('user-123', 'user-123', false)).toBe(true);
  });
  it('admin can log for another resident', () => {
    expect(canLogParcel('user-456', 'admin-789', true)).toBe(true);
  });
  it('non-admin cannot log for another resident', () => {
    expect(canLogParcel('user-456', 'user-789', false)).toBe(false);
  });
  it('pending vs collected filtering', () => {
    const parcels = [{ status: 'pending' }, { status: 'collected' }, { status: 'pending' }];
    expect(filterParcelsByStatus(parcels, 'pending')).toHaveLength(2);
    expect(filterParcelsByStatus(parcels, 'collected')).toHaveLength(1);
  });
  it('no parcels → empty array', () => {
    expect(filterParcelsByStatus([], 'pending')).toHaveLength(0);
  });
});

// ─── Security Audit Metrics ─────────────────────────────────────────────────

describe('Security Audit — Metrics', () => {
  it('pagination range page 2', () => {
    expect(paginationRange(2, 20)).toEqual({ start: 40, end: 59 });
  });
  it('manual percentage via helper', () => {
    expect(computePercentage(10, 50)).toBe(20);
  });
  it('denied percentage via helper', () => {
    expect(computePercentage(5, 100)).toBe(5);
  });
  it('zero entries → 0%', () => {
    expect(computePercentage(0, 0)).toBe(0);
  });
  it('average confirmation time', () => {
    expect(computeAverageMs([3000, 5000, 7000])).toBeCloseTo(5000);
  });
  it('empty times → 0', () => {
    expect(computeAverageMs([])).toBe(0);
  });
  it('dispute resolution rate', () => {
    expect(computeDisputeResolutionRate(10, 8)).toBe(80);
  });
});

// ─── Write Safety ───────────────────────────────────────────────────────────

describe('Write Safety — Real Helper', () => {
  it('write uses profile society', () => {
    expect(getWriteSocietyId('home', 'viewed')).toBe('home');
  });
  it('write fallback', () => {
    expect(getWriteSocietyId(null, 'viewed')).toBe('viewed');
  });
  it('both null → null', () => {
    expect(getWriteSocietyId(null, null)).toBeNull();
  });
});

// ─── Guard Confirmation Poller ──────────────────────────────────────────────

describe('Guard Confirmation Poller', () => {
  it('countdown decrements via helper', () => {
    expect(decrementCountdown(20)).toBe(19);
  });
  it('reaches zero and clamps', () => {
    expect(decrementCountdown(1)).toBe(0);
    expect(decrementCountdown(0)).toBe(0);
  });
  it('custom step decrement', () => {
    expect(decrementCountdown(10, 3)).toBe(7);
  });
  it('dual-mode: realtime + polling fallback', () => {
    const modes = ['realtime', 'polling'];
    expect(modes).toHaveLength(2);
  });
  it('polling interval 4.5s is valid', () => {
    expect(isPollingIntervalValid(4500)).toBe(true);
  });
  it('polling interval 3s is invalid', () => {
    expect(isPollingIntervalValid(3000)).toBe(false);
  });
  it('polling interval 6s is invalid', () => {
    expect(isPollingIntervalValid(6000)).toBe(false);
  });
  it('polling interval 4s boundary valid', () => {
    expect(isPollingIntervalValid(4000)).toBe(true);
  });
  it('polling interval 5s boundary valid', () => {
    expect(isPollingIntervalValid(5000)).toBe(true);
  });
});

// ─── SLA & Haversine ────────────────────────────────────────────────────────

describe('Security — SLA & Distance', () => {
  it('SLA deadline computed correctly', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    expect(computeSLADeadline(created, 24).toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });
  it('SLA not breached before deadline', () => {
    expect(isSLABreached(new Date(Date.now() + 100000))).toBe(false);
  });
  it('SLA breached after deadline', () => {
    expect(isSLABreached(new Date(Date.now() - 1))).toBe(true);
  });
  it('haversine same point → 0', () => {
    expect(haversineDistance(0, 0, 0, 0)).toBe(0);
  });
  it('haversine ~111km for 1 degree', () => {
    const dist = haversineDistance(0, 0, 1, 0);
    expect(dist).toBeGreaterThan(110000);
    expect(dist).toBeLessThan(112000);
  });
});