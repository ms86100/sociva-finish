import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { Society } from '@/types/database';
import { useAutocomplete, PlaceDetails } from '@/hooks/useGoogleMaps';
import { useSystemSettings } from '@/hooks/useSystemSettings';

export type AuthStep = 'phone' | 'otp' | 'society';
export type SocietySubStep = 'search' | 'map-confirm' | 'request-form';

export function useAuthPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<AuthStep>('phone');
  const [societySubStep, setSocietySubStep] = useState<SocietySubStep>('search');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);

  // OTP cooldown
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [otpReqId, setOtpReqId] = useState<string | null>(null);

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

  // Cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      cooldownRef.current = setInterval(() => {
        setResendCooldown(prev => {
          if (prev <= 1) {
            if (cooldownRef.current) clearInterval(cooldownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
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
      toast.error('Please enter a valid 10-digit phone number');
      return;
    }
    if (!resend && !ageConfirmed) {
      toast.error('Please confirm you are 18 years or older');
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('msg91-send-otp', {
        body: { phone, country_code: '91', resend, reqId: resend ? otpReqId : undefined },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Store reqId for verify and resend calls
      if (data?.reqId) {
        setOtpReqId(data.reqId);
      }

      setStep('otp');
      setResendCooldown(30);
      toast.success(resend ? 'OTP resent!' : 'OTP sent to your phone');
    } catch (error: any) {
      toast.error(error.message || 'Failed to send OTP');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 4) {
      toast.error('Please enter the 4-digit OTP');
      return;
    }
    setIsLoading(true);
    try {
      // Use fetch directly for reliable error body parsing
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/msg91-verify-otp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ reqId: otpReqId, otp, phone, country_code: '91' }),
        }
      );

      let data: any;
      try {
        data = await response.json();
      } catch {
        toast.error('Something went wrong. Please try again.');
        return;
      }

      if (!response.ok || data.error) {
        // Show the friendly error from the edge function directly
        toast.error(data.error || 'Verification failed. Please try again.');
        return;
      }

      const { token_hash, is_new_user } = data;
      setIsNewUser(is_new_user);

      // Establish session using the magic link token
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash,
        type: 'magiclink',
      });

      if (verifyError) {
        toast.error('Session could not be created. Please try again.');
        return;
      }

      if (is_new_user) {
        toast.success('Phone verified! Now select your society.');
        setStep('society');
      } else {
        toast.success('Welcome back!');
        navigate('/');
      }
    } catch {
      // Network error or unexpected failure — never show raw errors
      toast.error('Connection error. Please check your internet and try again.');
    } finally {
      setIsLoading(false);
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

  const handleSelectGooglePlace = async (placeId: string) => {
    const details = await getPlaceDetails(placeId);
    if (!details) { toast.error('Could not load address details'); return; }
    setSelectedPlace(details);
    clearPredictions();
    setSocietySearch(details.name);

    const match = societies.find(s =>
      s.name.toLowerCase() === details.name.toLowerCase() ||
      s.name.toLowerCase().includes(details.name.toLowerCase()) ||
      details.name.toLowerCase().includes(s.name.toLowerCase())
    );

    if (match) {
      setSelectedSociety(match);
      toast.info('Found matching society in our system!');
    } else {
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
    }
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
      toast.error('Please fill in all required fields'); return;
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
    if (!selectedSociety) { toast.error('Please select your society'); return; }
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

      toast.success('Welcome! Your account is set up.');
      navigate('/');
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
    phone, setPhone, otp, setOtp,
    isLoading, isNewUser, ageConfirmed, setAgeConfirmed,
    resendCooldown,
    // Society
    societies, societySearch, selectedSociety, isLoadingSocieties,
    inviteCode, setInviteCode, gpsStatus, gpsDistance,
    // Google Maps
    predictions, isSearching, mapsLoaded, selectedPlace,
    // New society
    newSocietyData, setNewSocietyData, pendingNewSociety,
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
