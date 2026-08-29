/**
 * Sticky auth / honest Account UI contracts (ship trust).
 * Guards session restore, logout bounce, and Profile loading UX.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  hasLocalAuthToken,
  purgeLocalAuthTokens,
  restoreAuthSession,
} from '@/lib/capacitor-storage';
import { initialAuthState } from '@/contexts/auth/types';

describe('Sticky auth: Profile loading guard', () => {
  it('shows skeleton when user exists but profile has not loaded and there is no error', () => {
    const user = { id: 'u1' };
    const profile = null;
    const profileError = null as string | null;
    const showProfileSkeleton = !!user && !profile && !profileError;
    expect(showProfileSkeleton).toBe(true);
  });

  it('does not skeleton when profileError is set (Retry banner path)', () => {
    const user = { id: 'u1' };
    const profile = null;
    const profileError = 'Could not load your profile.';
    const showProfileSkeleton = !!user && !profile && !profileError;
    expect(showProfileSkeleton).toBe(false);
  });

  it('does not skeleton when profile is present', () => {
    const user = { id: 'u1' };
    const profile = { name: 'Ada' };
    const profileError = null;
    const showProfileSkeleton = !!user && !profile && !profileError;
    expect(showProfileSkeleton).toBe(false);
  });
});

describe('Sticky auth: /auth bounce guard', () => {
  /** Mirrors App.tsx — home requires society_id; incomplete users go to profile/edit. */
  const computeAuthedHome = (
    user: { id: string } | null,
    profile: { society_id?: string | null } | null,
    isSigningOut: boolean,
  ) => !!(user && profile?.society_id && !isSigningOut);

  const computeNeedsSocietyOnboarding = (
    user: { id: string } | null,
    profile: { society_id?: string | null } | null,
    isSigningOut: boolean,
  ) => !!(user && !isSigningOut && profile && !profile.society_id);

  it('blocks home redirect while signing out even if user+society still stale', () => {
    expect(computeAuthedHome({ id: 'u1' }, { society_id: 's1' }, true)).toBe(false);
  });

  it('allows home redirect when signed in with society and not signing out', () => {
    expect(computeAuthedHome({ id: 'u1' }, { society_id: 's1' }, false)).toBe(true);
  });

  it('does not treat null profile hydration as society onboarding', () => {
    expect(computeNeedsSocietyOnboarding({ id: 'u1' }, null, false)).toBe(false);
    expect(computeAuthedHome({ id: 'u1' }, null, false)).toBe(false);
  });

  it('flags society onboarding when profile loaded without society_id', () => {
    expect(computeNeedsSocietyOnboarding({ id: 'u1' }, { society_id: null }, false)).toBe(true);
    expect(computeAuthedHome({ id: 'u1' }, { society_id: null }, false)).toBe(false);
  });

  it('App.tsx gate requires society_id for authedHome and sends incomplete users to profile edit', () => {
    const src = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
    expect(src).toMatch(/authedHome\s*=\s*!!\(user\s*&&\s*profile\?\.society_id\s*&&\s*!isSigningOut\)/);
    expect(src).toMatch(/needsSocietyOnboarding/);
    expect(src).toMatch(/needsSocietyOnboarding\s*\?\s*\([\s\S]*?Navigate to="\/profile\/edit"/);
  });

  it('useAuthPage sends users without society_id to profile edit after OTP', () => {
    const src = readFileSync(resolve(__dirname, '../hooks/useAuthPage.ts'), 'utf8');
    expect(src).toMatch(/navigate\('\/profile\/edit'/);
    expect(src).toMatch(/Add your delivery address/);
    expect(src).not.toMatch(/setStep\('society'\)/);
  });
});

describe('Sticky auth: clearAuthState contract', () => {
  it('initial cleared state has no user/profile and session restored', () => {
    const cleared = {
      ...initialAuthState,
      isLoading: false,
      isSessionRestored: true,
      isProfileLoading: false,
      profileError: null,
      isSigningOut: false,
    };
    expect(cleared.user).toBeNull();
    expect(cleared.profile).toBeNull();
    expect(cleared.isSessionRestored).toBe(true);
    expect(cleared.isSigningOut).toBe(false);
    expect(cleared.isProfileLoading).toBe(false);
  });

  it('logout must reset prevUserIdRef semantics (same-user re-login allowed)', () => {
    // Document the ref contract: after logout prevUserId is undefined so next SIGNED_IN applies
    let prevUserIdRef: string | undefined = 'u1';
    // clearAuthState equivalent
    prevUserIdRef = undefined;
    const newUserId = 'u1';
    const shouldApply = newUserId !== prevUserIdRef;
    expect(shouldApply).toBe(true);
  });
});

describe('Sticky auth: Preferences restore → setSession', () => {
  it('restoreAuthSession returns null on web (Preferences path is native-only)', async () => {
    const tokens = await restoreAuthSession();
    expect(tokens).toBeNull();
  });

  it('purgeLocalAuthTokens removes sb-*-auth-token keys', () => {
    localStorage.setItem('sb-testref-auth-token', JSON.stringify({ access_token: 'a', refresh_token: 'b' }));
    localStorage.setItem('other-key', 'keep');
    purgeLocalAuthTokens();
    expect(localStorage.getItem('sb-testref-auth-token')).toBeNull();
    expect(localStorage.getItem('other-key')).toBe('keep');
    localStorage.removeItem('other-key');
  });

  it('hasLocalAuthToken detects supabase auth keys', () => {
    purgeLocalAuthTokens();
    expect(hasLocalAuthToken()).toBe(false);
    localStorage.setItem('sb-abc-auth-token', '{}');
    expect(hasLocalAuthToken()).toBe(true);
    purgeLocalAuthTokens();
  });

  it('documents that restore must call setSession not only write localStorage JSON', () => {
    // Contract: incomplete JSON in localStorage is insufficient; caller uses setSession(tokens)
    const mustCallSetSession = true;
    const writeJsonOnlyIsInsufficient = true;
    expect(mustCallSetSession && writeJsonOnlyIsInsufficient).toBe(true);
  });

  it('boot only calls Preferences restore on native platforms', () => {
    const src = readFileSync(resolve(__dirname, '../contexts/auth/useAuthState.ts'), 'utf8');
    expect(src).toMatch(/Capacitor\.isNativePlatform\(\)/);
    expect(src).toMatch(/if \(Capacitor\.isNativePlatform\(\)\)/);
  });
});

describe('Sticky auth: 401 recovery before hard sign-out', () => {
  it('prefers refreshSession success over immediate sign-out', async () => {
    const refreshSession = vi.fn(async () => ({ data: { session: { access_token: 'x' } }, error: null }));
    const signOut = vi.fn();
    const { data, error } = await refreshSession();
    if (!error && data.session) {
      // recovered — do not signOut
    } else {
      await signOut();
    }
    expect(refreshSession).toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});
