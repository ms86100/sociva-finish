// @ts-nocheck
import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Profile, UserRole, SellerProfile, Society, SocietyAdmin } from '@/types/Database';
import { AuthState, initialAuthState } from './types';
import { toast } from 'sonner';
import {
  persistAuthSession,
  restoreAuthSession,
  readBackupAuthTokens,
  purgeLocalAuthTokens,
} from '@/lib/capacitor-storage';
import { hideSplashScreen } from '@/lib/capacitor';
import { Capacitor } from '@capacitor/core';

export function useAuthState() {
  const [state, setState] = useState<AuthState>(initialAuthState);

  const setPartial = useCallback((partial: Partial<AuthState>) => {
    setState(prev => ({ ...prev, ...partial }));
  }, []);

  // Cancel in-flight profile fetches on logout / user switch
  const profileFetchGen = useRef(0);
  const profileFetchedFor = useRef<string | null>(null);
  const prevUserIdRef = useRef<string | undefined>();
  const isExplicitSignOut = useRef(false);

  const fetchProfile = useCallback(async (userId: string, retryCount = 0) => {
    const gen = profileFetchGen.current;
    if (retryCount === 0) {
      setPartial({ isProfileLoading: true, profileError: null });
    }

    try {
      const { data, error } = await supabase.rpc('get_user_auth_context', {
        _user_id: userId,
      });

      if (gen !== profileFetchGen.current) return;

      if (error || !data) {
        console.error('Error fetching auth context:', error);
        if (retryCount < 2) {
          const delay = (retryCount + 1) * 2000;
          console.warn(`[Auth] Profile fetch failed, retrying in ${delay}ms (attempt ${retryCount + 1})`);
          setTimeout(() => {
            if (gen === profileFetchGen.current) fetchProfile(userId, retryCount + 1);
          }, delay);
        } else {
          setPartial({
            isProfileLoading: false,
            profileError: 'Could not load your profile. Check your connection and try again.',
          });
          toast.error('Could not load your profile. Please check your connection and reload.');
        }
        return;
      }

      const ctx = data as any;

      if (!ctx.profile) {
        console.warn('Authenticated user has no profile, attempting to create one');
        const { data: userData } = await supabase.auth.getUser();
        if (gen !== profileFetchGen.current) return;
        if (userData?.user) {
          const meta = userData.user.user_metadata || {};
          const sanitizedSocietyId = meta.society_id && meta.society_id !== 'pending'
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(meta.society_id)
            ? meta.society_id : null;
          const { error: insertError } = await supabase.from('profiles').upsert({
            id: userId,
            email: userData.user.email || '',
            name: meta.name || meta.full_name || 'User',
            phone: meta.phone || null,
            flat_number: meta.flat_number || '',
            block: meta.block || '',
            phase: meta.phase || null,
            society_id: sanitizedSocietyId,
            browse_beyond_community: true,
          }, { onConflict: 'id' });
          if (!insertError) {
            await supabase.from('user_roles').insert({ user_id: userId, role: 'buyer' });
            const { data: retryData } = await supabase.rpc('get_user_auth_context', { _user_id: userId });
            if (gen !== profileFetchGen.current) return;
            if (retryData) {
              const retryCtx = retryData as any;
              const retrySellers = (retryCtx.seller_profiles as SellerProfile[]) || [];
              setState(prev => ({
                ...prev,
                profile: retryCtx.profile as Profile | null,
                society: retryCtx.society as Society | null,
                societyAdminRole: retryCtx.society_admin_role as SocietyAdmin | null,
                roles: ((retryCtx.roles || []) as any[]).map((r: any) => typeof r === 'string' ? r : r.role) as UserRole[],
                sellerProfiles: retrySellers,
                currentSellerId: retrySellers.length > 0 ? retrySellers[0].id : null,
                managedBuilderIds: (retryCtx.builder_ids as string[]) || [],
                isSecurityOfficer: !!retryCtx.is_security_officer,
                isWorker: !!retryCtx.is_worker,
                isProfileLoading: false,
                profileError: null,
              }));
              return;
            }
          } else {
            console.error('Failed to auto-create profile:', insertError);
          }
        }
        if (gen === profileFetchGen.current) {
          setPartial({
            isProfileLoading: false,
            profileError: 'Your profile could not be loaded. Tap Retry.',
          });
        }
        return;
      }

      const sellers = (ctx.seller_profiles as SellerProfile[]) || [];

      setState(prev => {
        if (gen !== profileFetchGen.current) return prev;
        const newSellerId =
          sellers.length > 0 && !prev.currentSellerId
            ? sellers[0].id
            : sellers.length === 0
            ? null
            : prev.currentSellerId;

        return {
          ...prev,
          profile: ctx.profile as Profile | null,
          society: ctx.society as Society | null,
          societyAdminRole: ctx.society_admin_role as SocietyAdmin | null,
          roles: ((ctx.roles || []) as any[]).map((r: any) => typeof r === 'string' ? r : r.role) as UserRole[],
          sellerProfiles: sellers,
          currentSellerId: newSellerId,
          managedBuilderIds: (ctx.builder_ids as string[]) || [],
          isSecurityOfficer: !!ctx.is_security_officer,
          isWorker: !!ctx.is_worker,
          isProfileLoading: false,
          profileError: null,
        };
      });
    } catch (error) {
      console.error('Error fetching profile:', error);
      if (gen !== profileFetchGen.current) return;
      if (retryCount < 2) {
        setTimeout(() => {
          if (gen === profileFetchGen.current) fetchProfile(userId, retryCount + 1);
        }, (retryCount + 1) * 2000);
      } else {
        setPartial({
          isProfileLoading: false,
          profileError: 'Could not load your profile. Check your connection and try again.',
        });
      }
    }
  }, [setPartial]);

  const refreshProfile = useCallback(async () => {
    if (state.user) {
      profileFetchedFor.current = null;
      profileFetchGen.current += 1;
      profileFetchedFor.current = state.user.id;
      await fetchProfile(state.user.id);
    }
  }, [state.user, fetchProfile]);

  const setViewAsSociety = useCallback(async (id: string | null) => {
    if (!id) {
      setPartial({ viewAsSocietyId: null, viewAsSociety: null });
      return;
    }
    setPartial({ viewAsSocietyId: id });
    const { data } = await supabase
      .from('societies')
      .select('*')
      .eq('id', id)
      .single();
    setPartial({ viewAsSociety: data as Society | null });
  }, [setPartial]);

  const clearAuthState = useCallback(() => {
    profileFetchGen.current += 1;
    profileFetchedFor.current = null;
    prevUserIdRef.current = undefined;
    setState({
      ...initialAuthState,
      isLoading: false,
      isSessionRestored: true,
      isProfileLoading: false,
      profileError: null,
      isSigningOut: false,
    });
  }, []);

  const signOut = useCallback(async () => {
    isExplicitSignOut.current = true;
    setPartial({ isSigningOut: true });
    const currentUserId = state.user?.id;

    // Always clear local session first so UI cannot bounce back into the shell
    try {
      await supabase.auth.signOut({ scope: 'local' } as any);
    } catch (e) {
      console.warn('[Auth] Local signOut failed:', e);
    }

    const remoteSignOut = supabase.auth.signOut().catch((e) => {
      console.warn('[Auth] Remote signOut failed:', e);
    });
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), 4000)
    );
    await Promise.race([remoteSignOut, timeout]);

    purgeLocalAuthTokens();
    persistAuthSession(null);

    profileFetchGen.current += 1;
    profileFetchedFor.current = null;
    prevUserIdRef.current = undefined;

    clearAuthState();
    window.dispatchEvent(new CustomEvent('app:clear-cache'));
    if (currentUserId) {
      try {
        localStorage.removeItem(`app_search_filters_${currentUserId}`);
      } catch { /* ignore */ }
    }

    if (typeof window !== 'undefined') {
      window.location.replace(`${window.location.pathname}${window.location.search}#/auth`);
    }
  }, [clearAuthState, setPartial, state.user?.id]);

  // Boot: Preferences → setSession, with hard timeouts so AppShellGate never spins forever.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const bootMarked = { current: false };

    // Unlock the boot spinner once, but always apply session/user updates.
    // Previously bootMarked early-return dropped SIGNED_IN after failsafe —
    // login succeeded in Supabase while React user stayed null → /landing.
    const markBootComplete = (partial: Partial<AuthState> = {}) => {
      if (cancelled) return;
      if (!bootMarked.current) {
        bootMarked.current = true;
        setPartial({
          isLoading: false,
          isSessionRestored: true,
          ...partial,
        });
        hideSplashScreen();
        return;
      }
      if (Object.keys(partial).length > 0) {
        setPartial(partial);
      }
    };

    const withTimeout = <T,>(
      promise: Promise<T>,
      ms: number,
      label: string,
    ): Promise<T | null> =>
      Promise.race([
        promise,
        new Promise<null>((resolve) => {
          setTimeout(() => {
            if (!cancelled && !bootMarked.current) {
              console.warn(`[Auth] ${label} timed out after ${ms}ms`);
            }
            resolve(null);
          }, ms);
        }),
      ]);

    const failsafe = setTimeout(() => {
      console.warn('[Auth] Boot failsafe — forcing isSessionRestored');
      markBootComplete();
    }, 6000);

    (async () => {
      // Register listener first so INITIAL_SESSION is never missed after a slow restore
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (event, session) => {
          const newUserId = session?.user?.id;

          persistAuthSession(
            session
              ? { access_token: session.access_token, refresh_token: session.refresh_token }
              : null
          );

          if (newUserId && newUserId === prevUserIdRef.current) {
            if (event === 'TOKEN_REFRESHED') {
              setPartial({ session });
            }
            return;
          }
          prevUserIdRef.current = newUserId;

          if (session?.user) {
            markBootComplete({
              session,
              user: session.user,
              isSigningOut: false,
            });
            if (profileFetchedFor.current !== session.user.id) {
              profileFetchedFor.current = session.user.id;
              setTimeout(() => fetchProfile(session.user.id), 0);
            }
          } else if (event === 'SIGNED_OUT') {
            profileFetchGen.current += 1;
            profileFetchedFor.current = null;
            prevUserIdRef.current = undefined;
            if (!isExplicitSignOut.current) {
              window.location.hash = '#/auth';
            }
            isExplicitSignOut.current = false;
            clearAuthState();
            bootMarked.current = true;
          } else {
            markBootComplete();
          }
        }
      );

      unsubscribe = () => subscription.unsubscribe();

      // Native-only: restore from Preferences when localStorage was purged.
      // Web relies on localStorage + INITIAL_SESSION from onAuthStateChange.
      if (Capacitor.isNativePlatform()) {
        try {
          const tokens = await withTimeout(restoreAuthSession(), 2500, 'restoreAuthSession');
          if (tokens && !cancelled) {
            const result = await withTimeout(
              supabase.auth.setSession({
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
              }),
              4000,
              'setSession',
            );
            if (result && (result as any).error) {
              console.warn('[Auth] setSession from Preferences failed:', (result as any).error.message);
            } else if (result) {
              console.log('[Auth] Restored session via setSession from Preferences');
            }
          }
        } catch (e) {
          console.warn('[Auth] Native restore failed:', e);
        }
      }

      // Let INITIAL_SESSION fire before any redundant getSession (parallel getSession
      // can hang or race supabase-js init on slow mobile networks).
      if (!cancelled && !bootMarked.current) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, Capacitor.isNativePlatform() ? 200 : 400);
        });
      }

      if (!cancelled && !bootMarked.current) {
        try {
          const sessionResult = await withTimeout(supabase.auth.getSession(), 5000, 'getSession');
          const session = (sessionResult as any)?.data?.session ?? null;
          if (session?.user) {
            prevUserIdRef.current = session.user.id;
            markBootComplete({
              session,
              user: session.user,
              isSigningOut: false,
            });
            if (profileFetchedFor.current !== session.user.id) {
              profileFetchedFor.current = session.user.id;
              setTimeout(() => fetchProfile(session.user.id), 0);
            }
          } else {
            markBootComplete();
          }
        } catch (e) {
          console.warn('[Auth] getSession backup failed:', e);
          markBootComplete();
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(failsafe);
      unsubscribe?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Proactive session refresh every 5 minutes — local session only (no getUser storm).
  // supabase-js already auto-refreshes tokens; this only recovers Preferences backup
  // or refreshes when expiry is near.
  useEffect(() => {
    const INTERVAL = 5 * 60 * 1000;
    const interval = setInterval(async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error || !session) {
          const backup = await readBackupAuthTokens();
          if (backup) {
            const { data: restored, error: setErr } = await supabase.auth.setSession(backup);
            if (!setErr && restored.session) {
              console.log('[Auth] Recovered session from Preferences during health check');
              return;
            }
          }
          // Do NOT call getUser() here — it hammers Auth while the DB pool is busy
          // and caused /token and /user 504s. Rely on onAuthStateChange + next user action.
          console.warn('[Auth] Local session missing during health check; waiting for auth events');
          return;
        }
        const expiresAt = session.expires_at;
        if (expiresAt) {
          const expiresIn = expiresAt * 1000 - Date.now();
          if (expiresIn < 10 * 60 * 1000) {
            console.log('[Auth] Proactively refreshing session');
            const { error: refreshError } = await supabase.auth.refreshSession();
            if (refreshError) {
              console.warn('[Auth] Proactive refresh failed, will retry next interval:', refreshError.message);
            }
          }
        }
      } catch (e) {
        console.error('[Auth] Session health check failed:', e);
      }
    }, INTERVAL);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const userId = state.user?.id;
    if (!userId) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchProfile(userId), 500);
    };

    const roleChannel = supabase
      .channel(`role-changes-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles', filter: `user_id=eq.${userId}` }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'security_staff', filter: `user_id=eq.${userId}` }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'society_admins', filter: `user_id=eq.${userId}` }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'builder_members', filter: `user_id=eq.${userId}` }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seller_profiles', filter: `user_id=eq.${userId}` }, debouncedFetch)
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(roleChannel);
    };
  }, [state.user?.id, fetchProfile]);

  return {
    state,
    setPartial,
    refreshProfile,
    setViewAsSociety,
    signOut,
  };
}
