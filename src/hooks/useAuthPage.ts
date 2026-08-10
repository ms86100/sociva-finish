// @ts-nocheck
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { Society } from '@/types/Database';
import { useAutocomplete, PlaceDetails } from '@/hooks/useGoogleMaps';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { usePushNotifications } from '@/contexts/PushNotificationContext';
import { notify } from '@/lib/notify';

export type AuthStep = 'phone' | 'otp' | 'society';
export type SocietySubStep = 'search' | 'map-confirm' | 'request-form';

export function useAuthPage() {
  const navigate = useNavigate();
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
  const OTP_SEND_TIMEOUT_MS = 28_000;
  const OTP_VERIFY_TIMEOUT_MS = 25_000;

  // Society selection state
  const [societies, setSocieties] = useState<Society[]>([]);
  const [societySearch, setSocietySearch] = useState('');
  const [selectedSociety, setSelectedSociety] = useState<Society | null>(null);
  const [isLoadingSocieties, setIsLoadingSocieties] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'verified' | 'failed' | 'unavailable'>('idle');
  const [gpsDistance, setGpsDistance] = useState<number | null>(null);

  // Google Places autocomplete
  const { predictions, isSearching, searchPlaces, getPlaceDetails, clearPredictions, isLoaded: mapsLoaded } = useAutocomplete();
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);
  const [adjustedCoords, setAdjustedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const settings = useSystemSettings();
  const { requestFullPermission } = usePushNotifications();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Request form
  const [newSocietyData, setNewSocietyData] = useState({ name: '', address: '', city: '', pincode: '', landmark: '', contact: '' });
  const [pendingNewSociety, setPendingNewSociety] = useState<{
    name: string; slug: string; address: string; city: string; state: string;
    pincode: string; latitude: number; longitude: number;
  } | null>(null);

  useEffect(() => {
    fetchSocieties();
  }, []);

  // Cooldown timer — chained timeout avoids re-creating intervals every tick
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => {
      setResendCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const fetchSocieties = async () => {
    setIsLoadingSocieties(true);
    const { data } = await supabase
      .from('societies')
      .select('*')
      .eq('is_active', true)
      .eq('is_verified', true)
      .order('name');
    setSocieties((data as Society[]) || []);
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

    setIsSendingOtp(true);
    if (!resend) {
      // Optimistic UX: show OTP screen immediately; verify stays gated on otpReqId
      setOtpReqId(null);
      setOtp('');
      setStep('otp');
      setResendCooldown(30);
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
            resend,
            reqId: resend ? otpReqId : undefined,
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
        throw new Error(data?.error || data?.message || 'Failed to send OTP');
      }

      if (data?.reqId) {
        setOtpReqId(data.reqId);
      } else {
        throw new Error('Failed to send OTP. Please try again.');
      }

      if (resend) {
        setResendCooldown(30);
      }
    } catch (error: any) {
      if (!resend) {
        setStep('phone');
        setOtpReqId(null);
        setResendCooldown(0);
      }
      const timedOut = error?.name === 'AbortError';
      toast.error(
        timedOut
          ? 'OTP is taking too long. Please try again.'
          : (error.message || 'Failed to send OTP'),
      );
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
        setOtpError(msg);
        toast.error(msg);
        return;
      }

      const { token_hash, is_new_user } = data;
      setIsNewUser(is_new_user);

      // Establish session using the magic link token.
      // GoTrue's /verify endpoint occasionally 504s under DB pool contention —
      // retry once after a brief backoff before surfacing failure to the user.
      let verifyError: any = null;
      let authUser: any = null;
      for (let attempt = 0; attempt < 2; attempt++) {
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
        if (!isTransient || attempt === 1) break;
        await new Promise((r) => setTimeout(r, 800));
      }

      if (verifyError) {
        const msg = 'Session could not be created. Please try again.';
        setOtpError(msg);
        toast.error(msg);
        return;
      }

      // Request push notification permission right after login
      setTimeout(() => {
        requestFullPermission().catch(e =>
          console.warn('[Auth] Post-login push permission request:', e)
        );
      }, 1500);

      // Guard: even if backend says "new user", trust the DB. If the profile
      // already has a society_id, this is a returning user — skip onboarding.
      // Prefer user from verifyOtp (avoids extra getUser round-trip).
      if (!authUser) {
        const { data: { user } } = await supabase.auth.getUser();
        authUser = user;
      }
      let resolvedNew = is_new_user;
      let prof: any = null;
      if (authUser) {
        const { data } = await supabase.from('profiles')
          .select('name, flat_number, block, society_id')
          .eq('id', authUser.id).maybeSingle();
        prof = data;
        if (resolvedNew && prof?.society_id) resolvedNew = false;
      }

      if (resolvedNew) {
        toast.success('Phone verified! Now select your society.');
        setStep('society');
      } else {
        const isIncomplete = !prof?.name || prof.name === 'User';
        navigate(isIncomplete ? '/profile/edit' : '/');
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
    setSelectedPlace(null);
    setAdjustedCoords(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length >= 3 && mapsLoaded) {
      debounceRef.current = setTimeout(() => searchPlaces(value), 300);
    } else {
      clearPredictions();
    }
  }, [mapsLoaded, searchPlaces, clearPredictions]);

  const handleSelectDbSociety = (society: Society) => {
    setSelectedSociety(society);
    setSocietySearch(society.name);
    clearPredictions();
  };

  // Society match candidates for confirmation UI
  const [potentialMatches, setPotentialMatches] = useState<Array<{ society_id: string; society_name: string; match_type: string; confidence: number }>>([]);
  const [pendingPlaceDetails, setPendingPlaceDetails] = useState<{ details: PlaceDetails; placeId: string } | null>(null);

  const handleSelectGooglePlace = async (placeId: string) => {
    const details = await getPlaceDetails(placeId);
    if (!details) { toast.error('Could not load address details'); return; }
    setSelectedPlace(details);
    clearPredictions();
    setSocietySearch(details.name);

    // Use resolve_society RPC for smart matching
    const { data: matches } = await supabase.rpc('resolve_society', {
      _input_name: details.name,
      _lat: details.latitude,
      _lng: details.longitude,
      _google_place_id: placeId,
    });

    if (matches && matches.length === 1 && matches[0].confidence >= 0.8) {
      // High confidence single match — auto-select
      const existing = societies.find(s => s.id === matches[0].society_id);
      if (existing) {
        setSelectedSociety(existing);
        toast.info(`Found: ${existing.name}`);
        return;
      }
    }

    if (matches && matches.length > 0 && matches[0].confidence >= 0.4) {
      // Medium confidence — show confirmation UI
      setPotentialMatches(matches);
      setPendingPlaceDetails({ details, placeId });
      return;
    }

    // No match — proceed with new society creation
    const name = details.name;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();
    setPendingNewSociety({
      name, slug,
      address: details.formattedAddress,
      city: details.city, state: details.state,
      pincode: details.pincode,
      latitude: details.latitude, longitude: details.longitude,
    });
    setSelectedSociety({ id: 'pending', name, slug, is_active: false, is_verified: false, latitude: details.latitude, longitude: details.longitude, created_at: '', updated_at: '' } as Society);
    toast.success('Location selected! Continue to complete setup.');
  };

  const handleConfirmMatch = (societyId: string) => {
    const existing = societies.find(s => s.id === societyId);
    if (existing) {
      setSelectedSociety(existing);
      setPotentialMatches([]);
      setPendingPlaceDetails(null);
      toast.info(`Selected: ${existing.name}`);
    }
  };

  const handleRejectMatches = () => {
    if (!pendingPlaceDetails) return;
    const { details } = pendingPlaceDetails;
    const name = details.name;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();
    setPendingNewSociety({
      name, slug,
      address: details.formattedAddress,
      city: details.city, state: details.state,
      pincode: details.pincode,
      latitude: details.latitude, longitude: details.longitude,
    });
    setSelectedSociety({ id: 'pending', name, slug, is_active: false, is_verified: false, latitude: details.latitude, longitude: details.longitude, created_at: '', updated_at: '' } as Society);
    setPotentialMatches([]);
    setPendingPlaceDetails(null);
    toast.success('Location selected! Continue to complete setup.');
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
      if (dist <= radius) { setGpsStatus('verified'); toast.success('Location verified!'); }
      else { setGpsStatus('failed'); toast.error(`You appear to be ${Math.round(dist)}m away.`); }
    } catch {
      setGpsStatus('failed'); toast.error('Unable to access your location.');
    }
  };

  const handleRequestNewSociety = () => {
    if (!newSocietyData.name || !newSocietyData.city || !newSocietyData.pincode || !newSocietyData.contact) {
      notify.block('Please fill in all required fields'); return;
    }
    const slug = newSocietyData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const pending = {
      name: newSocietyData.name,
      slug: slug + '-' + Date.now(),
      address: [newSocietyData.address, newSocietyData.landmark].filter(Boolean).join(', ') || '',
      city: newSocietyData.city, state: '', pincode: newSocietyData.pincode,
      latitude: 0, longitude: 0,
    };
    setPendingNewSociety(pending);
    setSelectedSociety({ id: 'pending', name: newSocietyData.name, slug: pending.slug, is_active: false, is_verified: false, created_at: '', updated_at: '' } as Society);
    toast.success("Society details saved! Continue to finish setup.");
    setSocietySubStep('search');
    setNewSocietyData({ name: '', address: '', city: '', pincode: '', landmark: '', contact: '' });
  };

  const handleSocietyComplete = async () => {
    if (!selectedSociety) { notify.block('Please select your society'); return; }
    if (selectedSociety.invite_code && inviteCode.trim().toLowerCase() !== selectedSociety.invite_code.trim().toLowerCase()) {
      toast.error('Invalid invite code for this society'); return;
    }
    setIsLoading(true);
    try {
      let finalSocietyId = selectedSociety.id;

      if (pendingNewSociety && selectedSociety.id === 'pending') {
        const { data: validateData, error: validateError } = await supabase.functions.invoke('validate-society', {
          body: { new_society: pendingNewSociety },
        });
        if (validateError) throw validateError;
        if (validateData?.society?.id) {
          finalSocietyId = validateData.society.id;
        }
      }

      if (!finalSocietyId || finalSocietyId === 'pending') {
        toast.error('Failed to set up your society. Please try again.');
        setIsLoading(false);
        return;
      }

      // Update profile with society_id
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('profiles').update({ society_id: finalSocietyId }).eq('id', user.id);

        // Validate society if it's an existing one
        if (!pendingNewSociety && selectedSociety.id !== 'pending') {
          try {
            await supabase.functions.invoke('validate-society', {
              body: { society_id: selectedSociety.id },
            });
          } catch (e) {
            console.warn('Society validation call failed:', e);
          }
        }
      }

      toast.success('Welcome! Complete your profile to get started.');
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
    setSelectedSociety(null);
    setSelectedPlace(null);
    setAdjustedCoords(null);
    setInviteCode('');
    setGpsStatus('idle');
    setGpsDistance(null);
    setSocietySearch('');
    setIsNewUser(false);
  };

  const totalSteps = isNewUser ? 3 : 2;
  const currentStepNum = step === 'phone' ? 1 : step === 'otp' ? 2 : 3;
  const stepLabels = isNewUser ? ['Phone', 'Verify', 'Society'] : ['Phone', 'Verify'];

  const showDbResults = societySearch.length >= 2 && filteredSocieties.length > 0;
  const showGoogleResults = societySearch.length >= 3 && predictions.length > 0 && !selectedSociety;

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
    inviteCode, setInviteCode, gpsStatus, gpsDistance,
    // Google Maps
    predictions, isSearching, mapsLoaded, selectedPlace,
    // New society
    newSocietyData, setNewSocietyData, pendingNewSociety,
    // Society matching
    potentialMatches, handleConfirmMatch, handleRejectMatches,
    // Settings
    settings,
    // Computed
    filteredSocieties, showDbResults, showGoogleResults,
    totalSteps, currentStepNum, stepLabels,
    // Handlers
    handleSendOtp, handleVerifyOtp,
    handleSearchChange, handleSelectDbSociety, handleSelectGooglePlace,
    verifyGpsLocation, handleRequestNewSociety, handleSocietyComplete,
    formatPhone, resetFlow,
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
