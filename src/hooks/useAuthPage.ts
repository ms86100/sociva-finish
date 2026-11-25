// @ts-nocheck
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, IS_STAGING_SUPABASE } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { fetchOwnMembership, requestSocietyMembership } from '@/lib/society-membership';
import { hasAssignedSociety } from '@/lib/society-assignment';
import { fetchApprovedSocieties, submitSocietyRegistryRequest } from '@/lib/approved-societies';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { Society } from '@/types/Database';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { markPostLoginPermissionSheet, reopenNotificationAsk } from '@/hooks/usePermissionLifecycle';
import { notify } from '@/lib/notify';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { QA_OTP_REQ_ID } from '@/lib/qa-otp-bypass';
import { pendingAuthReturnPath, peekPendingAuthAction, resolvePendingReturnTo, profileEditOnboardingState, clearPendingAuthAction } from '@/lib/pending-auth-action';
import { consumeAuthReturnTo } from '@/hooks/useDeepLinks';

export type AuthStep = 'phone' | 'otp' | 'society';
export type SocietySubStep = 'search' | 'request-form';

export function useAuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const sessionExpiryReturnRef = useRef<string | null>(null);
  if (sessionExpiryReturnRef.current === null) {
    sessionExpiryReturnRef.current = consumeAuthReturnTo() ?? '';
  }
  const sessionExpiryReturn = sessionExpiryReturnRef.current || null;
  const authReturnTo =
    (location.state as { returnTo?: string; from?: string } | null)?.returnTo ||
    (location.state as { returnTo?: string; from?: string } | null)?.from ||
    sessionExpiryReturn ||
    pendingAuthReturnPath('/');
  const isCheckoutResume =
    peekPendingAuthAction()?.type === 'checkout' ||
    authReturnTo === '/cart' ||
    authReturnTo.startsWith('/cart?');
  const [step, setStep] = useState<AuthStep>('phone');
  const [societySubStep, setSocietySubStep] = useState<SocietySubStep>('search');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);

  // OTP cooldown
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpReqId, setOtpReqId] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  /** MSG91 OTP was consumed but GoTrue session not established - resend must start a fresh send. */
  const otpConsumedNeedsFreshRef = useRef(false);
  const OTP_SEND_TIMEOUT_MS = 28_000;
  const OTP_VERIFY_TIMEOUT_MS = 35_000;

  // Society selection state
  const [societies, setSocieties] = useState<Society[]>([]);
  const [societySearch, setSocietySearch] = useState('');
  const [selectedSociety, setSelectedSociety] = useState<Society | null>(null);
  const [isLoadingSocieties, setIsLoadingSocieties] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'verified' | 'failed' | 'unavailable'>('idle');
  const [gpsDistance, setGpsDistance] = useState<number | null>(null);

  const settings = useSystemSettings();

  // Request form
  const [newSocietyData, setNewSocietyData] = useState({ name: '', address: '', city: '', pincode: '', landmark: '', contact: '' });
  const [pendingNewSociety, setPendingNewSociety] = useState<{
    name: string; slug: string; address: string; city: string; state: string;
    pincode: string; latitude: number; longitude: number;
  } | null>(null);

  useEffect(() => {
    fetchSocieties();
  }, []);

  // Incomplete membership → delivery-address onboarding (society_id set there).
  // Preserve checkout/cart returnTo so first-time buyers land back on cart, not home.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      const { data: prof } = await supabase
        .from('profiles')
        .select('society_id')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      let membership = null;
      if (IS_STAGING_SUPABASE) {
        membership = await fetchOwnMembership(user.id);
      }
      if (hasAssignedSociety({ societyId: prof?.society_id, membership })) return;
      const editState = profileEditOnboardingState({
        locationReturnTo: isCheckoutResume ? '/cart' : (authReturnTo.startsWith('/') ? authReturnTo : null),
        focusAddress: true,
      });
      navigate('/profile/edit', { replace: true, state: editState });
    })();
    return () => { cancelled = true; };
  }, [navigate, authReturnTo, isCheckoutResume]);

  // Cooldown timer - chained timeout avoids re-creating intervals every tick
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => {
      setResendCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const fetchSocieties = async () => {
    setIsLoadingSocieties(true);
    const rows = await fetchApprovedSocieties();
    setSocieties((rows as Society[]) || []);
    setIsLoadingSocieties(false);
  };

  const filteredSocieties = societies.filter(s =>
    societySearch.length >= 2 && (
      s.name.toLowerCase().includes(societySearch.toLowerCase()) ||
      s.pincode?.includes(societySearch) ||
      s.city?.toLowerCase().includes(societySearch.toLowerCase()) ||
      s.address?.toLowerCase().includes(societySearch.toLowerCase())
    )
  );

  // ─── OTP Handlers ───

  const handleSendOtp = async (resend = false) => {
    if (!phone || phone.length !== 10) {
      notify.block('Please enter a valid 10-digit phone number');
      return;
    }
    if (!resend && !ageConfirmed) {
      notify.block('Please confirm you are 18 years or older');
      return;
    }
    if (isSendingOtp) return;

    // After a consumed OTP / failed session, MSG91 retryOtp on the old reqId returns
    // "already verified". Always start a brand-new send in that case.
    // Never treat the first send as a resend just because the phone is a special case.
    const forceFresh =
      otpConsumedNeedsFreshRef.current ||
      (resend && (!otpReqId || otpReqId === QA_OTP_REQ_ID));
    const actuallyResend = resend && !forceFresh && !!otpReqId;

    setIsSendingOtp(true);
    if (!resend || forceFresh) {
      // Optimistic UX: show OTP screen immediately; verify stays gated on otpReqId
      setOtpReqId(null);
      setOtp('');
      setStep('otp');
      setResendCooldown(30);
      setOtpError(null);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OTP_SEND_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/msg91-send-otp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            phone,
            country_code: '91',
            resend: actuallyResend,
            reqId: actuallyResend ? otpReqId : undefined,
          }),
          signal: controller.signal,
        },
      );
      let data: any = null;
      try {
        data = await response.json();
      } catch {
        throw new Error('Failed to send OTP');
      }
      if (!response.ok || data?.error) {
        const errMsg = String(data?.error || data?.message || 'Failed to send OTP');
        const alreadyUsed =
          /already verif|already been used|request a new|fetching record/i.test(errMsg);
        if (actuallyResend && alreadyUsed) {
          // Stale reqId - start a brand-new send (not recursive retryOtp).
          otpConsumedNeedsFreshRef.current = true;
          setOtpReqId(null);
          clearTimeout(timeoutId);
          setIsSendingOtp(false);
          const fresh = await fetch(
            `${SUPABASE_URL}/functions/v1/msg91-send-otp`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_PUBLISHABLE_KEY,
                Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
              },
              body: JSON.stringify({
                phone,
                country_code: '91',
                resend: false,
              }),
            },
          );
          let freshData: any = null;
          try {
            freshData = await fresh.json();
          } catch {
            throw new Error('Failed to send OTP');
          }
          if (!fresh.ok || freshData?.error || !freshData?.reqId) {
            throw new Error(freshData?.error || 'Failed to send OTP');
          }
          setOtpReqId(freshData.reqId);
          otpConsumedNeedsFreshRef.current = false;
          setResendCooldown(30);
          setOtp('');
          showFeedback({ title: 'New OTP sent', variant: 'success' });
          return;
        }
        throw new Error(errMsg);
      }

      if (data?.reqId) {
        setOtpReqId(data.reqId);
        otpConsumedNeedsFreshRef.current = false;
      } else {
        throw new Error('Failed to send OTP. Please try again.');
      }

      if (resend) {
        setResendCooldown(30);
        setOtp('');
        showFeedback({ title: 'New OTP sent', variant: 'success' });
      }
    } catch (error: any) {
      if (!resend || forceFresh) {
        setStep('phone');
        setOtpReqId(null);
        setResendCooldown(0);
      }
      const timedOut = error?.name === 'AbortError';
      showFeedback({
        title: timedOut
          ? 'OTP is taking too long. Please try again.'
          : friendlyError(error) || 'Could not send OTP. Please try again.',
        variant: 'warning',
      });
    } finally {
      clearTimeout(timeoutId);
      setIsSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 4) {
      setOtpError('Please enter the 4-digit OTP');
      notify.block('Please enter the 4-digit OTP');
      return;
    }
    if (!otpReqId) {
      setOtpError('Still sending OTP. Please wait a moment.');
      notify.block('Still sending OTP. Please wait a moment.');
      return;
    }
    if (isVerifyingOtp) return;

    setIsVerifyingOtp(true);
    setOtpError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OTP_VERIFY_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/msg91-verify-otp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ reqId: otpReqId, otp, phone, country_code: '91' }),
          signal: controller.signal,
        },
      );

      let data: any;
      try {
        data = await response.json();
      } catch {
        const msg = 'Something went wrong. Please try again.';
        setOtpError(msg);
        toast.error(msg);
        return;
      }

      if (!response.ok || data.error) {
        const msg = data.error || 'Verification failed. Please try again.';
        const alreadyUsed = /already verif|already been used|request a new/i.test(String(msg));
        if (alreadyUsed) {
          otpConsumedNeedsFreshRef.current = true;
          setOtpReqId(null);
        }
        setOtpError(msg);
        toast.error(msg);
        return;
      }

      const { token_hash, is_new_user, access_token, refresh_token } = data;
      setIsNewUser(is_new_user);
      // MSG91 (or Apple bypass) accepted this code - do not retry the same reqId.
      otpConsumedNeedsFreshRef.current = true;

      // Drop any stale session (e.g. Google/email account) before phone magic-link
      // so OTP cannot leave the user on the wrong identity.
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        /* ignore */
      }

      // Prefer server-minted session (avoids client verifyOtp 504 after OTP already spent).
      let verifyError: any = null;
      let authUser: any = null;

      if (access_token && refresh_token) {
        const { data: sessData, error: sessErr } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        verifyError = sessErr;
        authUser = sessData?.user ?? sessData?.session?.user ?? null;
      } else if (token_hash) {
        // Fallback: establish session using the magic link token.
        // GoTrue's /verify endpoint occasionally 504s under DB pool contention -
        // retry with backoff before surfacing failure to the user.
        for (let attempt = 0; attempt < 4; attempt++) {
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const res = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
          verifyError = res.error;
          authUser = res.data?.user ?? res.data?.session?.user ?? null;
          if (!verifyError) break;
          const msg = String(verifyError?.message || '').toLowerCase();
          const isTransient =
            verifyError?.status === 504 ||
            verifyError?.status === 503 ||
            verifyError?.status === 0 ||
            msg.includes('timeout') ||
            msg.includes('timed out') ||
            msg.includes('failed to fetch') ||
            msg.includes('network');
          if (!isTransient || attempt === 3) break;
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
      } else {
        verifyError = { message: 'missing session tokens' };
      }

      if (verifyError) {
        // Clear spent reqId so Resend starts a fresh MSG91 send (not retryOtp).
        setOtpReqId(null);
        const msg =
          'Phone verified, but sign-in timed out. Tap Resend OTP for a new code.';
        setOtpError(msg);
        toast.error(msg);
        return;
      }

      otpConsumedNeedsFreshRef.current = false;

      // Guard: session must be the phone identity we just verified
      const expectedSynthetic = `91${phone}@phone.sociva.app`;
      const sessionEmail = (authUser?.email || '').toLowerCase();
      const sessionPhone = String(authUser?.phone || '').replace(/\D/g, '');
      const phoneOk =
        sessionEmail === expectedSynthetic ||
        sessionPhone.endsWith(phone) ||
        sessionPhone === `91${phone}`;
      if (authUser && !phoneOk) {
        console.error('[Auth] OTP session mismatch', { sessionEmail, sessionPhone, phone });
        await supabase.auth.signOut({ scope: 'local' });
        const msg = 'Signed into the wrong account. Please try OTP again.';
        setOtpError(msg);
        toast.error(msg);
        return;
      }

      // Soft ask after login. The system dialog waits for Allow.
      // Cart and address stay clear. A plain login asks again on Home.
      markPostLoginPermissionSheet();
      if (!isCheckoutResume) reopenNotificationAsk();

      // Guard: even if backend says "new user", trust the DB. If the profile
      // already has a society_id, this is a returning user - skip onboarding.
      // Prefer user from verifyOtp (avoids extra getUser round-trip).
      if (!authUser) {
        const { data: { user } } = await supabase.auth.getUser();
        authUser = user;
      }
      let resolvedNew = is_new_user;
      let prof: any = null;
      let membership = null;
      if (authUser) {
        const { data } = await supabase.from('profiles')
          .select('name, flat_number, block, society_id')
          .eq('id', authUser.id).maybeSingle();
        prof = data;
        if (IS_STAGING_SUPABASE) {
          membership = await fetchOwnMembership(authUser.id);
        }
        if (resolvedNew && hasAssignedSociety({ societyId: prof?.society_id, membership })) {
          resolvedNew = false;
        }
      }

      const alreadyInSociety = hasAssignedSociety({
        societyId: prof?.society_id,
        membership,
      });
      // New users pick an approved society. Existing members skip join.
      if (resolvedNew || !alreadyInSociety) {
        showFeedback({ title: 'Phone verified! Add your delivery address to continue.', variant: 'success' });
        setIsNewUser(true);
        const editState = profileEditOnboardingState({
          locationReturnTo: isCheckoutResume ? '/cart' : (authReturnTo.startsWith('/') ? authReturnTo : null),
          focusAddress: true,
        });
        navigate('/profile/edit', { replace: true, state: editState });
      } else {
        const isIncomplete = !prof?.name || prof.name === 'User';
        const pending = peekPendingAuthAction();
        if (isIncomplete) {
          const editState = profileEditOnboardingState({
            locationReturnTo: isCheckoutResume ? '/cart' : (pending ? resolvePendingReturnTo(pending, '/cart') : null),
            focusAddress: true,
          });
          navigate('/profile/edit', { replace: true, state: editState });
        } else {
          const dest = pending
            ? resolvePendingReturnTo(pending, isCheckoutResume ? '/cart' : (authReturnTo.startsWith('/') ? authReturnTo : '/'))
            : (isCheckoutResume ? '/cart' : (authReturnTo.startsWith('/') && authReturnTo !== '/profile/edit' ? authReturnTo : '/'));
          if (dest === '/cart') clearPendingAuthAction();
          navigate(dest, { replace: true });
        }
      }

    } catch (error: any) {
      const timedOut = error?.name === 'AbortError';
      const msg = timedOut
        ? 'Verification is taking too long. Please try again.'
        : 'Connection error. Please check your internet and try again.';
      setOtpError(msg);
      toast.error(msg);
    } finally {
      clearTimeout(timeoutId);
      setIsVerifyingOtp(false);
    }
  };

  // ─── Society Handlers ───

  const handleSearchChange = useCallback((value: string) => {
    setSocietySearch(value);
    setSelectedSociety(null);
  }, []);

  const handleSelectDbSociety = (society: Society) => {
    setSelectedSociety(society);
    setSocietySearch(society.name);
  };

  const verifyGpsLocation = async () => {
    if (!selectedSociety?.latitude || !selectedSociety?.longitude) { setGpsStatus('unavailable'); return; }
    setGpsStatus('loading');
    try {
      const { getCurrentPosition } = await import('@/lib/native-location');
      const pos = await getCurrentPosition();
      const dist = haversineDistance(pos.latitude, pos.longitude, Number(selectedSociety.latitude), Number(selectedSociety.longitude));
      setGpsDistance(Math.round(dist));
      const radius = selectedSociety.geofence_radius_meters || 500;
      if (dist <= radius) { setGpsStatus('verified'); showFeedback({ title: 'Location verified!', variant: 'success' }); }
      else { setGpsStatus('failed'); toast.error(`You appear to be ${Math.round(dist)}m away.`); }
    } catch {
      setGpsStatus('failed'); toast.error('Unable to access your location.');
    }
  };

  const handleRequestNewSociety = async () => {
    if (!newSocietyData.name || !newSocietyData.city || !newSocietyData.pincode || !newSocietyData.contact) {
      notify.block('Please fill in all required fields'); return;
    }
    setIsLoading(true);
    try {
      const submitted = await submitSocietyRegistryRequest({
        name: newSocietyData.name,
        address: [newSocietyData.address, newSocietyData.landmark].filter(Boolean).join(', '),
        city: newSocietyData.city,
        pincode: newSocietyData.pincode,
        landmark: newSocietyData.landmark,
        contact: newSocietyData.contact,
      });
      if (!submitted.ok) {
        toast.error(submitted.error);
        return;
      }
      showFeedback({
        title: 'Request sent. Sociva admin will add this society if the RWA is verified.',
        variant: 'success',
      });
      setSocietySubStep('search');
      setSelectedSociety(null);
      setPendingNewSociety(null);
      setNewSocietyData({ name: '', address: '', city: '', pincode: '', landmark: '', contact: '' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocietyComplete = async () => {
    if (!selectedSociety) { notify.block('Please select your society'); return; }
    if (selectedSociety.invite_code && inviteCode.trim().toLowerCase() !== selectedSociety.invite_code.trim().toLowerCase()) {
      setInviteError('Invalid invite code for this society');
      toast.error('Invalid invite code for this society'); return;
    }
    setInviteError(null);
    setIsLoading(true);
    try {
      let finalSocietyId = selectedSociety.id;

      if (pendingNewSociety && selectedSociety.id === 'pending') {
        toast.error('New societies must be approved by Sociva admin before you can join.');
        setIsLoading(false);
        return;
      }

      if (!finalSocietyId || finalSocietyId === 'pending') {
        toast.error('Failed to set up your society. Please try again.');
        setIsLoading(false);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      let joinStatus = 'assigned';
      if (user) {
        const joined = await requestSocietyMembership(user.id, finalSocietyId, inviteCode);
        if (!joined.ok) {
          if (joined.inviteRequired) {
            setInviteError('Invalid invite code for this society');
            toast.error('Invalid invite code for this society');
          } else {
            toast.error(joined.error);
          }
          setIsLoading(false);
          return;
        }
        joinStatus = joined.status;
        await queryClient.invalidateQueries({ queryKey: ['own-membership', user.id] });
        await queryClient.invalidateQueries({ queryKey: ['own-membership'] });

        if (!pendingNewSociety && selectedSociety.id !== 'pending' && !IS_STAGING_SUPABASE) {
          try {
            await supabase.functions.invoke('validate-society', {
              body: { society_id: selectedSociety.id },
            });
          } catch (e) {
            console.warn('Society validation call failed:', e);
          }
        }
      }

      showFeedback({
        title: IS_STAGING_SUPABASE && joinStatus === 'pending'
          ? 'Join request sent. Complete your profile while an admin approves access.'
          : 'Welcome! Complete your profile to get started.',
        variant: 'success',
      });
      navigate('/profile/edit');
    } catch (error: any) {
      toast.error(friendlyError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const formatPhone = (value: string) => value.replace(/\D/g, '').slice(0, 10);

  const resetFlow = () => {
    setStep('phone');
    setSocietySubStep('search');
    setPhone('');
    setOtp('');
    setOtpReqId(null);
    setOtpError(null);
    otpConsumedNeedsFreshRef.current = false;
    setSelectedSociety(null);
    setInviteCode('');
    setInviteError(null);
    setGpsStatus('idle');
    setGpsDistance(null);
    setSocietySearch('');
    setIsNewUser(false);
  };

  const totalSteps = isNewUser ? 3 : 2;
  const currentStepNum = step === 'phone' ? 1 : step === 'otp' ? 2 : 3;
  const stepLabels = isNewUser ? ['Phone', 'Verify', 'Society'] : ['Phone', 'Verify'];

  const showDbResults = societySearch.length >= 2 && filteredSocieties.length > 0;

  return {
    // Step
    step, setStep, societySubStep, setSocietySubStep,
    // Phone/OTP
    phone, setPhone, otp, setOtp, otpReqId, setOtpReqId, otpError, setOtpError,
    isLoading, isSendingOtp, isVerifyingOtp,
    isNewUser, ageConfirmed, setAgeConfirmed,
    resendCooldown,
    // Society
    societies, societySearch, selectedSociety, isLoadingSocieties,
    inviteCode, setInviteCode, inviteError, setInviteError, gpsStatus, gpsDistance,
    // New society
    newSocietyData, setNewSocietyData, pendingNewSociety,
    // Settings
    settings,
    // Computed
    filteredSocieties, showDbResults,
    totalSteps, currentStepNum, stepLabels,
    isCheckoutResume,
    // Handlers
    handleSendOtp, handleVerifyOtp,
    handleSearchChange, handleSelectDbSociety,
    verifyGpsLocation, handleRequestNewSociety, handleSocietyComplete,
    formatPhone, resetFlow,
    resetOtpSessionGuards: () => {
      otpConsumedNeedsFreshRef.current = false;
    },
  };
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
