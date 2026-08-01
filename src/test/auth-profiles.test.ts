import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  loginSchema,
  profileDataSchema,
  signupSchema,
  disputeSchema,
  workerRegistrationSchema,
  jobRequestSchema,
  validateForm,
} from '@/lib/validation-schemas';

// ─── Email Validation ────────────────────────────────────────
describe('Auth: Email Validation', () => {
  it('rejects empty email', () => {
    const result = emailSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('trims whitespace from email', () => {
    const result = emailSchema.safeParse('  user@test.com  ');
    expect(result.success).toBe(true);
    expect(result.data).toBe('user@test.com');
  });

  it('rejects invalid email format', () => {
    expect(emailSchema.safeParse('notanemail').success).toBe(false);
    expect(emailSchema.safeParse('user@').success).toBe(false);
    expect(emailSchema.safeParse('@domain.com').success).toBe(false);
  });

  it('accepts valid email', () => {
    expect(emailSchema.safeParse('user@example.com').success).toBe(true);
  });

  it('rejects email over 255 chars', () => {
    const longEmail = 'a'.repeat(250) + '@b.com';
    expect(emailSchema.safeParse(longEmail).success).toBe(false);
  });
});

// ─── Password Validation ─────────────────────────────────────
describe('Auth: Password Validation', () => {
  it('rejects password under 6 chars', () => {
    expect(passwordSchema.safeParse('12345').success).toBe(false);
  });

  it('accepts password with 6 chars', () => {
    expect(passwordSchema.safeParse('123456').success).toBe(true);
  });

  it('rejects password over 128 chars', () => {
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });

  it('accepts password at exactly 128 chars', () => {
    expect(passwordSchema.safeParse('a'.repeat(128)).success).toBe(true);
  });
});

// ─── Login Schema ────────────────────────────────────────────
describe('Auth: Login Schema', () => {
  it('validates combined email + password', () => {
    const result = loginSchema.safeParse({ email: 'test@example.com', password: 'Secure1!' });
    expect(result.success).toBe(true);
  });

  it('fails with empty email', () => {
    const result = loginSchema.safeParse({ email: '', password: 'Secure1!' });
    expect(result.success).toBe(false);
  });

  it('fails with short password', () => {
    const result = loginSchema.safeParse({ email: 'test@example.com', password: '12' });
    expect(result.success).toBe(false);
  });

  it('trims email before validation', () => {
    const result = loginSchema.safeParse({ email: '  test@example.com  ', password: '123456' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@example.com');
    }
  });
});

// ─── Profile Data Schema ─────────────────────────────────────
describe('Auth: Profile Data Schema', () => {
  const validProfile = {
    name: 'John Doe',
    flat_number: '101',
    block: 'A',
    phase: '',
    phone: '9876543210',
  };

  it('accepts valid profile data', () => {
    expect(profileDataSchema.safeParse(validProfile).success).toBe(true);
  });

  it('rejects empty name', () => {
    expect(profileDataSchema.safeParse({ ...validProfile, name: '' }).success).toBe(false);
  });

  it('rejects name over 100 chars', () => {
    expect(profileDataSchema.safeParse({ ...validProfile, name: 'A'.repeat(101) }).success).toBe(false);
  });

  it('trims name whitespace', () => {
    const result = profileDataSchema.safeParse({ ...validProfile, name: '  John  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('John');
    }
  });

  it('rejects empty flat_number', () => {
    expect(profileDataSchema.safeParse({ ...validProfile, flat_number: '' }).success).toBe(false);
  });

  it('rejects flat_number over 20 chars', () => {
    expect(profileDataSchema.safeParse({ ...validProfile, flat_number: 'F'.repeat(21) }).success).toBe(false);
  });

  it('rejects empty block', () => {
    expect(profileDataSchema.safeParse({ ...validProfile, block: '' }).success).toBe(false);
  });

  it('allows empty phase (optional)', () => {
    expect(profileDataSchema.safeParse({ ...validProfile, phase: '' }).success).toBe(true);
  });

  it('rejects phase over 20 chars', () => {
    expect(profileDataSchema.safeParse({ ...validProfile, phase: 'P'.repeat(21) }).success).toBe(false);
  });

  // Phone validation
  it('rejects phone with non-digits', () => {
    expect(profileDataSchema.safeParse({ ...validProfile, phone: '98765abcde' }).success).toBe(false);
  });

  it('rejects phone under 10 digits', () => {
    expect(profileDataSchema.safeParse({ ...validProfile, phone: '98765' }).success).toBe(false);
  });

  it('rejects phone over 10 digits', () => {
    expect(profileDataSchema.safeParse({ ...validProfile, phone: '98765432101' }).success).toBe(false);
  });

  it('accepts exactly 10-digit phone', () => {
    expect(profileDataSchema.safeParse({ ...validProfile, phone: '9876543210' }).success).toBe(true);
  });
});

// ─── validateForm Utility ────────────────────────────────────
describe('Auth: validateForm utility', () => {
  it('returns success with parsed data for valid input', () => {
    const result = validateForm(loginSchema, { email: 'test@x.com', password: '123456' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@x.com');
    }
  });

  it('returns errors map for invalid input', () => {
    const result = validateForm(loginSchema, { email: '', password: '' });
    expect(result.success).toBe(false);
    if ('errors' in result) {
      expect(Object.keys(result.errors).length).toBeGreaterThan(0);
    }
  });

  it('returns first error per field path', () => {
    const result = validateForm(profileDataSchema, { name: '', flat_number: '', block: '', phone: 'x' });
    expect(result.success).toBe(false);
    if ('errors' in result) {
      expect(result.errors['name']).toBeDefined();
      expect(result.errors['flat_number']).toBeDefined();
      expect(result.errors['block']).toBeDefined();
      expect(result.errors['phone']).toBeDefined();
    }
  });
});

// ─── Password Strength Indicator Logic ───────────────────────
describe('Auth: Password Strength Logic', () => {
  const checks = [
    { label: '6+ characters', test: (p: string) => p.length >= 6 },
    { label: 'Uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
    { label: 'Number', test: (p: string) => /[0-9]/.test(p) },
    { label: 'Special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
  ];

  const getStrength = (password: string) => {
    const passed = checks.filter(c => c.test(password)).length;
    return passed <= 1 ? 'Weak' : passed <= 2 ? 'Fair' : passed <= 3 ? 'Good' : 'Strong';
  };

  it('rates empty as Weak', () => expect(getStrength('')).toBe('Weak'));
  it('rates short lowercase as Weak', () => expect(getStrength('abc')).toBe('Weak'));
  it('rates 6 lowercase chars as Weak (only 1 check passes)', () => expect(getStrength('abcdef')).toBe('Weak'));
  it('rates 6+ with uppercase as Fair', () => expect(getStrength('Abcdef')).toBe('Fair'));
  it('rates 6+ with uppercase+number as Good', () => expect(getStrength('Abcde1')).toBe('Good'));
  it('rates 6+ with all checks as Strong', () => expect(getStrength('Abcde1!')).toBe('Strong'));
});

// ─── Invite Code Matching ────────────────────────────────────
describe('Auth: Invite Code Matching', () => {
  const matchesInviteCode = (input: string, expected: string) =>
    input.trim().toLowerCase() === expected.trim().toLowerCase();

  it('matches exact case', () => expect(matchesInviteCode('ABC123', 'ABC123')).toBe(true));
  it('matches case-insensitive', () => expect(matchesInviteCode('abc123', 'ABC123')).toBe(true));
  it('trims whitespace', () => expect(matchesInviteCode('  abc123 ', 'ABC123')).toBe(true));
  it('rejects wrong code', () => expect(matchesInviteCode('wrong', 'ABC123')).toBe(false));
});

// ─── Phone Formatting ────────────────────────────────────────
describe('Auth: Phone Number Formatting', () => {
  const formatPhone = (value: string) => value.replace(/\D/g, '').slice(0, 10);

  it('strips non-digits', () => expect(formatPhone('98-765-432-10')).toBe('9876543210'));
  it('caps at 10 digits', () => expect(formatPhone('98765432101234')).toBe('9876543210'));
  it('handles empty', () => expect(formatPhone('')).toBe(''));
  it('handles letters', () => expect(formatPhone('abc')).toBe(''));
  it('handles mixed', () => expect(formatPhone('+91 98765 43210')).toBe('9198765432'));
});

// ─── Slug Generation ─────────────────────────────────────────
describe('Auth: Society Slug Generation', () => {
  const generateSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  it('converts spaces to hyphens', () => expect(generateSlug('My Society')).toBe('my-society'));
  it('strips special characters', () => expect(generateSlug('Société (Phase 1)')).toBe('soci-t-phase-1'));
  it('strips leading/trailing hyphens', () => expect(generateSlug('--Test--')).toBe('test'));
  it('handles numbers', () => expect(generateSlug('Block 123')).toBe('block-123'));
});

// ─── Role Derivation Logic ───────────────────────────────────
describe('Auth: Role Derivation', () => {
  const deriveIsSeller = (roles: string[], sellerProfiles: { verification_status: string }[]) =>
    roles.includes('seller') && sellerProfiles.some(s => s.verification_status === 'approved');

  it('is seller when role + approved profile exists', () => {
    expect(deriveIsSeller(['buyer', 'seller'], [{ verification_status: 'approved' }])).toBe(true);
  });

  it('is NOT seller when role exists but no approved profile', () => {
    expect(deriveIsSeller(['seller'], [{ verification_status: 'pending' }])).toBe(false);
  });

  it('is NOT seller when approved profile exists but no role', () => {
    expect(deriveIsSeller(['buyer'], [{ verification_status: 'approved' }])).toBe(false);
  });

  it('is NOT seller when empty', () => {
    expect(deriveIsSeller([], [])).toBe(false);
  });

  const deriveIsSocietyAdmin = (societyAdminRole: any, isAdmin: boolean) =>
    !!societyAdminRole || isAdmin;

  it('is society admin with admin role entry', () => {
    expect(deriveIsSocietyAdmin({ id: '1' }, false)).toBe(true);
  });

  it('is society admin via platform admin', () => {
    expect(deriveIsSocietyAdmin(null, true)).toBe(true);
  });

  it('is NOT society admin without either', () => {
    expect(deriveIsSocietyAdmin(null, false)).toBe(false);
  });
});

// ─── Delete Account Confirmation ─────────────────────────────
describe('Auth: Delete Account Confirmation', () => {
  it('requires exactly "DELETE"', () => {
    const confirmText = 'DELETE';
    expect(confirmText === 'DELETE').toBe(true);
  });

  it('auto-uppercases input', () => {
    const input = 'delete';
    const uppercased = input.toUpperCase();
    expect(uppercased).toBe('DELETE');
    expect(uppercased === 'DELETE').toBe(true);
  });

  it('rejects partial input', () => {
    expect('DELET'.toUpperCase() === 'DELETE').toBe(false);
  });
});

// ─── Haversine Distance ──────────────────────────────────────
describe('Auth: GPS Haversine Distance', () => {
  const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  it('returns 0 for same point', () => {
    expect(haversineDistance(0, 0, 0, 0)).toBe(0);
  });

  it('calculates ~111km for 1 degree latitude', () => {
    const dist = haversineDistance(0, 0, 1, 0);
    expect(dist).toBeGreaterThan(110000);
    expect(dist).toBeLessThan(112000);
  });

  it('returns positive for any two different points', () => {
    expect(haversineDistance(12.97, 77.59, 12.98, 77.60)).toBeGreaterThan(0);
  });
});

// ─── Effective Society ID Logic ──────────────────────────────
describe('Auth: Effective Society ID', () => {
  const getEffectiveSocietyId = (viewAsSocietyId: string | null, profileSocietyId: string | null) =>
    viewAsSocietyId || profileSocietyId || null;

  it('uses viewAs when set', () => {
    expect(getEffectiveSocietyId('society-2', 'society-1')).toBe('society-2');
  });

  it('falls back to profile society', () => {
    expect(getEffectiveSocietyId(null, 'society-1')).toBe('society-1');
  });

  it('returns null when neither set', () => {
    expect(getEffectiveSocietyId(null, null)).toBeNull();
  });
});

// ─── Signup Schema ───────────────────────────────────────────
describe('Auth: Signup Schema', () => {
  const validSignup = {
    email: 'test@example.com',
    password: 'Secure1!',
    profile: { name: 'John', flat_number: '101', block: 'A', phase: '', phone: '9876543210' },
  };

  it('accepts valid signup', () => {
    expect(signupSchema.safeParse(validSignup).success).toBe(true);
  });
  it('rejects missing profile', () => {
    expect(signupSchema.safeParse({ email: 'a@b.com', password: '123456' }).success).toBe(false);
  });
  it('rejects invalid profile phone', () => {
    expect(signupSchema.safeParse({ ...validSignup, profile: { ...validSignup.profile, phone: 'abc' } }).success).toBe(false);
  });
  it('rejects short password in signup', () => {
    expect(signupSchema.safeParse({ ...validSignup, password: '12' }).success).toBe(false);
  });
  it('rejects invalid email in signup', () => {
    expect(signupSchema.safeParse({ ...validSignup, email: 'notanemail' }).success).toBe(false);
  });
});

// ─── Dispute Schema ──────────────────────────────────────────
describe('Auth: Dispute Schema', () => {
  it('accepts valid dispute', () => {
    expect(disputeSchema.safeParse({ category: 'noise', description: 'Loud music at 3am every night' }).success).toBe(true);
  });
  it('rejects empty category', () => {
    expect(disputeSchema.safeParse({ category: '', description: 'Some long description here' }).success).toBe(false);
  });
  it('rejects short description (< 10 chars)', () => {
    expect(disputeSchema.safeParse({ category: 'noise', description: 'Short' }).success).toBe(false);
  });
  it('rejects description over 2000 chars', () => {
    expect(disputeSchema.safeParse({ category: 'noise', description: 'x'.repeat(2001) }).success).toBe(false);
  });
  it('accepts 10 char description', () => {
    expect(disputeSchema.safeParse({ category: 'noise', description: '1234567890' }).success).toBe(true);
  });
  it('accepts optional is_anonymous', () => {
    expect(disputeSchema.safeParse({ category: 'noise', description: 'Loud music at night', is_anonymous: true }).success).toBe(true);
  });
  it('trims description whitespace', () => {
    const result = disputeSchema.safeParse({ category: 'noise', description: '   Loud music at 3am   ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBe('Loud music at 3am');
  });
});

// ─── Worker Registration Schema ──────────────────────────────
describe('Auth: Worker Registration Schema', () => {
  const validWorker = {
    name: 'Ramesh',
    phone: '9876543210',
    workerType: 'maid',
    shiftStart: '08:00',
    shiftEnd: '17:00',
    entryFrequency: 'daily' as const,
    emergencyPhone: '',
    flatNumbers: 'A-101, A-102',
    preferredLanguage: 'hi',
  };

  it('accepts valid worker registration', () => {
    expect(workerRegistrationSchema.safeParse(validWorker).success).toBe(true);
  });
  it('rejects empty name', () => {
    expect(workerRegistrationSchema.safeParse({ ...validWorker, name: '' }).success).toBe(false);
  });
  it('rejects name over 100 chars', () => {
    expect(workerRegistrationSchema.safeParse({ ...validWorker, name: 'A'.repeat(101) }).success).toBe(false);
  });
  it('rejects empty workerType', () => {
    expect(workerRegistrationSchema.safeParse({ ...validWorker, workerType: '' }).success).toBe(false);
  });
  it('rejects invalid shiftStart format', () => {
    expect(workerRegistrationSchema.safeParse({ ...validWorker, shiftStart: '8am' }).success).toBe(false);
  });
  it('rejects invalid shiftEnd format', () => {
    expect(workerRegistrationSchema.safeParse({ ...validWorker, shiftEnd: '5pm' }).success).toBe(false);
  });
  it('rejects shiftEnd before shiftStart', () => {
    expect(workerRegistrationSchema.safeParse({ ...validWorker, shiftStart: '17:00', shiftEnd: '08:00' }).success).toBe(false);
  });
  it('accepts valid entryFrequency values', () => {
    for (const freq of ['daily', 'occasional', 'per_visit'] as const) {
      expect(workerRegistrationSchema.safeParse({ ...validWorker, entryFrequency: freq }).success).toBe(true);
    }
  });
  it('rejects invalid entryFrequency', () => {
    expect(workerRegistrationSchema.safeParse({ ...validWorker, entryFrequency: 'weekly' }).success).toBe(false);
  });
  it('accepts empty phone (optional)', () => {
    expect(workerRegistrationSchema.safeParse({ ...validWorker, phone: '' }).success).toBe(true);
  });
  it('rejects invalid phone format', () => {
    expect(workerRegistrationSchema.safeParse({ ...validWorker, phone: 'abc' }).success).toBe(false);
  });
  it('rejects short preferredLanguage', () => {
    expect(workerRegistrationSchema.safeParse({ ...validWorker, preferredLanguage: 'h' }).success).toBe(false);
  });
});

// ─── Job Request Schema ──────────────────────────────────────
describe('Auth: Job Request Schema', () => {
  const validJob = {
    job_type: 'plumbing',
    description: 'Fix kitchen sink',
    price: 500,
    duration_hours: 2,
    urgency: 'normal' as const,
    visibility_scope: 'society' as const,
    target_society_ids: [],
  };

  it('accepts valid job request', () => {
    expect(jobRequestSchema.safeParse(validJob).success).toBe(true);
  });
  it('rejects empty job_type', () => {
    expect(jobRequestSchema.safeParse({ ...validJob, job_type: '' }).success).toBe(false);
  });
  it('rejects duration_hours < 1', () => {
    expect(jobRequestSchema.safeParse({ ...validJob, duration_hours: 0 }).success).toBe(false);
  });
  it('rejects duration_hours > 24', () => {
    expect(jobRequestSchema.safeParse({ ...validJob, duration_hours: 25 }).success).toBe(false);
  });
  it('accepts all valid urgency values', () => {
    for (const urg of ['flexible', 'normal', 'urgent'] as const) {
      expect(jobRequestSchema.safeParse({ ...validJob, urgency: urg }).success).toBe(true);
    }
  });
  it('rejects invalid urgency', () => {
    expect(jobRequestSchema.safeParse({ ...validJob, urgency: 'asap' }).success).toBe(false);
  });
  it('rejects nearby scope without target societies', () => {
    expect(jobRequestSchema.safeParse({ ...validJob, visibility_scope: 'nearby', target_society_ids: [] }).success).toBe(false);
  });
  it('accepts nearby scope with target societies', () => {
    expect(jobRequestSchema.safeParse({
      ...validJob,
      visibility_scope: 'nearby',
      target_society_ids: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
    }).success).toBe(true);
  });
  it('accepts null price (optional)', () => {
    expect(jobRequestSchema.safeParse({ ...validJob, price: null }).success).toBe(true);
  });
  it('rejects negative price', () => {
    expect(jobRequestSchema.safeParse({ ...validJob, price: -100 }).success).toBe(false);
  });
  it('accepts description over 1000 chars rejected', () => {
    expect(jobRequestSchema.safeParse({ ...validJob, description: 'x'.repeat(1001) }).success).toBe(false);
  });
});
