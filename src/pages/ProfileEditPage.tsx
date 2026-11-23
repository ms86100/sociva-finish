// @ts-nocheck
import { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSmartBack } from '@/hooks/useSmartBack';
import { useBackInterceptor } from '@/hooks/useBackInterceptor';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AddressForm } from '@/components/profile/AddressForm';
import { AddressCard } from '@/components/profile/AddressCard';
import { ApprovedSocietyPicker } from '@/components/society/ApprovedSocietyPicker';
import {
  fetchApprovedSocieties,
  filterApprovedSocieties,
  submitSocietyRegistryRequest,
  type ApprovedSociety,
} from '@/lib/approved-societies';
import { useAuth } from '@/contexts/AuthContext';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { useDeliveryAddresses } from '@/hooks/useDeliveryAddresses';
import { IS_STAGING_SUPABASE, supabase } from '@/integrations/supabase/client';
import { assignSocietyIdToProfile } from '@/lib/resolve-profile-society';
import { fetchOwnMembership } from '@/lib/society-membership';
import { seedDeliveryAddress } from '@/lib/delivery-pin-seed';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useFeedbackPopup } from '@/components/FeedbackPopupProvider';
import { ArrowLeft, Plus, Loader2, Mail, MapPin, Phone, User, ChevronRight, KeyRound, LogOut, Building2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { resolveAfterOnboardingPath, clearPendingAuthAction } from '@/lib/pending-auth-action';
import { useCart } from '@/hooks/useCart';

export default function ProfileEditPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useSmartBack('/profile');
  const { user, profile, society, refreshProfile, signOut } = useAuth();
  const queryClient = useQueryClient();
  const { browsingLocation } = useBrowsingLocation();
  const { showFeedback } = useFeedbackPopup();
  const { addresses, isLoading: addressesLoading, saveAddress, deleteAddress, setDefault, isSaving } = useDeliveryAddresses();

  const { itemCount } = useCart();
  const returnTo = resolveAfterOnboardingPath({
    locationReturnTo: (location.state as { returnTo?: string } | null)?.returnTo,
    itemCount,
  });
  const focusAddress = !!(location.state as { focusAddress?: boolean } | null)?.focusAddress;
  const goesToCart = returnTo === '/cart' || returnTo.startsWith('/cart?');

  const [name, setName] = useState(
    profile?.name && profile.name !== 'User' ? profile.name : ''
  );
  const [email, setEmail] = useState(
    profile?.email && !profile.email.endsWith('@phone.sociva.app') ? profile.email : ''
  );
  const [savingProfile, setSavingProfile] = useState(false);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [editingAddress, setEditingAddress] = useState<any>(null);
  const [step, setStep] = useState<1 | 2>(1);
  useBackInterceptor(step === 2, () => setStep(1));
  const [dismissedAutoOpen, setDismissedAutoOpen] = useState(false);
  const [resolvingSociety, setResolvingSociety] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [societyQuery, setSocietyQuery] = useState('');
  const [pickedSociety, setPickedSociety] = useState<ApprovedSociety | null>(null);
  const [showRegistryForm, setShowRegistryForm] = useState(false);
  const [registryForm, setRegistryForm] = useState({ name: '', city: '', pincode: '', address: '', contact: '' });
  const [pendingInvite, setPendingInvite] = useState<{
    societyId: string;
    societyName: string;
    addressData: any;
  } | null>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const { data: membership } = useQuery({
    queryKey: ['own-membership', user?.id],
    queryFn: () => fetchOwnMembership(user!.id),
    enabled: IS_STAGING_SUPABASE && !!user?.id,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 8_000 : false),
  });
  const needsSociety = IS_STAGING_SUPABASE
    ? !(profile?.society_id || (membership && membership.status !== 'none'))
    : !profile?.society_id;

  const { data: approvedSocieties = [], isLoading: loadingApproved } = useQuery({
    queryKey: ['approved-societies'],
    queryFn: fetchApprovedSocieties,
    enabled: needsSociety,
    staleTime: 60_000,
  });
  const filteredApproved = useMemo(
    () => filterApprovedSocieties(approvedSocieties, societyQuery),
    [approvedSocieties, societyQuery],
  );

  // Auto-open address form if no addresses exist (unless user dismissed it)
  const shouldAutoOpen = !needsSociety && !addressesLoading && addresses.length === 0 && !showAddressForm && !dismissedAutoOpen;

  const handleSaveProfile = async () => {
    if (!user || !name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (needsSociety) {
      toast.error('Pick an approved society first. Maps cannot create a community.');
      setStep(1);
      return;
    }
    setSavingProfile(true);
    try {
      const updates: Record<string, any> = { name: name.trim() };
      const trimmedEmail = email.trim();
      if (trimmedEmail && !trimmedEmail.endsWith('@phone.sociva.app')) {
        updates.email = trimmedEmail;
      }

      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Profile update did not apply');

      await refreshProfile();
      showFeedback({
        title: 'Profile updated! Redirecting…',
        variant: 'success'
      });
      const dest = resolveAfterOnboardingPath({
        locationReturnTo: returnTo,
        itemCount,
      });
      if (dest === '/cart' || dest.startsWith('/cart?')) clearPendingAuthAction();
      navigate(dest);
    } catch (err) {
      console.error('Failed to update profile', err);
      toast.error('Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const persistAddressWithSociety = async (data: any, societyId: string | null) => {
    const payload = {
      ...data,
      society_id: societyId,
      is_default: data.is_default || addresses.length === 0,
    };
    // Don't persist client-only field on delivery_addresses
    delete payload.google_place_id;

    await saveAddress(payload);

    if (user && (data.flat_number || data.block)) {
      try {
        await supabase.from('profiles').update({
          flat_number: data.flat_number || '',
          block: data.block || '',
          phase: data.phase || null,
        }).eq('id', user.id);
        await refreshProfile();
      } catch {
        // Non-critical - don't block address save
      }
    }

    setShowAddressForm(false);
    setEditingAddress(null);
    setPendingInvite(null);
    setInviteCode('');

    // Checkout / cart sent us here to add an address - return there once door details are saved
    // and the profile already has a real name (returning buyer). First-time buyers still need step 2.
    const hasRealName = !!(profile?.name && profile.name !== 'User');
    if (goesToCart && hasRealName) {
      showFeedback({
        title: 'Address saved',
        variant: 'success',
      });
      clearPendingAuthAction();
      navigate(returnTo);
      return;
    }

    setTimeout(() => {
      setStep(2);
      setTimeout(() => {
        detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }, 300);
  };

  const handleJoinApprovedSociety = async () => {
    if (!user || !pickedSociety) {
      toast.error('Pick an approved society from the list');
      return;
    }
    if (pickedSociety.invite_code && !inviteCode.trim()) {
      toast.error('Enter the invite code for this society');
      return;
    }
    setResolvingSociety(true);
    try {
      const assigned = await assignSocietyIdToProfile(user.id, pickedSociety.id, inviteCode);
      if (!assigned.ok) {
        if (assigned.inviteRequired) {
          toast.info(`${pickedSociety.name} requires an invite code`);
        } else {
          toast.error(assigned.error || 'Could not request to join');
        }
        return;
      }
      await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: ['own-membership'] });
      showFeedback({
        title: 'Join request sent. Next, add your door details. The map pin is for delivery, not membership.',
        variant: 'success',
      });
    } finally {
      setResolvingSociety(false);
    }
  };

  const handleRegistryRequest = async () => {
    if (!registryForm.name.trim() || !registryForm.city.trim() || !registryForm.pincode.trim()) {
      toast.error('Name, city, and pincode are required');
      return;
    }
    setResolvingSociety(true);
    try {
      const submitted = await submitSocietyRegistryRequest({
        name: registryForm.name,
        city: registryForm.city,
        pincode: registryForm.pincode,
        address: registryForm.address,
        contact: registryForm.contact || profile?.phone || '',
      });
      if (!submitted.ok) {
        toast.error(submitted.error);
        return;
      }
      showFeedback({
        title: 'Request sent. Sociva admin will add this society if the RWA is verified.',
        variant: 'success',
      });
      setShowRegistryForm(false);
      setRegistryForm({ name: '', city: '', pincode: '', address: '', contact: '' });
    } finally {
      setResolvingSociety(false);
    }
  };

  const handleSaveAddress = async (data: any) => {
    if (!user) return;
    const societyId = profile?.society_id || membership?.societyId || null;
    if (!societyId) {
      toast.error('Pick an approved society first. Maps cannot create or join a community.');
      return;
    }
    setResolvingSociety(true);
    try {
      await persistAddressWithSociety(data, societyId);
    } catch (err) {
      console.error('Failed to save address from profile edit', err);
      toast.error('Failed to save address');
    } finally {
      setResolvingSociety(false);
    }
  };

  const handleInviteContinue = async () => {
    if (!user || !pendingInvite) return;
    if (!inviteCode.trim()) {
      toast.error('Enter the invite code for this society');
      return;
    }
    setResolvingSociety(true);
    try {
      const assigned = await assignSocietyIdToProfile(user.id, pendingInvite.societyId, inviteCode);
      if (!assigned.ok) {
        toast.error(assigned.inviteRequired ? 'Invalid invite code for this society' : assigned.error);
        return;
      }
      await refreshProfile();
      await queryClient.invalidateQueries({ queryKey: ['own-membership'] });
      if (pendingInvite.addressData) {
        await persistAddressWithSociety(pendingInvite.addressData, pendingInvite.societyId);
      }
    } catch (err) {
      console.error('Invite society join failed', err);
      toast.error('Failed to join society');
    } finally {
      setResolvingSociety(false);
    }
  };

  const handleEditAddress = (addr: any) => {
    setEditingAddress(addr);
    setShowAddressForm(true);
  };

  const handleAddNew = () => {
    const firstAddress = addresses.length === 0;
    const defaults = seedDeliveryAddress({
      society,
      browsingLocation: firstAddress ? undefined : browsingLocation,
      preferSociety: firstAddress,
    });
    setEditingAddress(defaults);
    setShowAddressForm(true);
  };

  const handleContinueToDetails = async () => {
    if (!user) return;
    if (needsSociety) {
      toast.error('Pick an approved society first. Maps cannot create a community.');
      return;
    }
    setStep(2);
    setTimeout(() => {
      detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  return (
    <AppLayout headerTitle="Edit Profile" showNav={false} showBack={false}>
      <div className="pb-8">
        {/* Back and optional Sign Out */}
        <div className="px-4 pt-3 flex items-center justify-between">
          <button
            onClick={() => {
              if (step === 2) {
                setStep(1);
              } else if (profile?.society_id) {
                goBack({ fallback: '/profile' });
              } else {
                goBack({ fallback: '/' });
              }
            }}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} /> {step === 2 ? 'Back to Address' : 'Back'}
          </button>
          {needsSociety && (
            <button
              onClick={async () => {
                await signOut();
                navigate('/auth', { replace: true });
              }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              <LogOut size={13} /> Sign Out
            </button>
          )}
        </div>

        {needsSociety && (
          <div className="mx-4 mt-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
            <p className="text-xs font-medium text-foreground">Almost there</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              Pick your approved Sociva society first. Google Maps is not how you join.
            </p>
          </div>
        )}

        {/* Step indicator */}
        <div className="px-4 mt-3 flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${step === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            <MapPin size={12} /> 1. Address
          </div>
          <ChevronRight size={14} className="text-muted-foreground" />
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${step === 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            <User size={12} /> 2. Details
          </div>
        </div>

        {/* ═══ STEP 1: DELIVERY ADDRESS ═══ */}
        {step === 1 && (
          <div className="px-4 mt-4">
            {needsSociety && (
              <div className="mb-5 rounded-2xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <Building2 size={16} className="mt-0.5 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">Choose your society</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Only admin-approved societies can be joined, like MyGate. A map pin later is for your door, not this join.
                    </p>
                  </div>
                </div>
                {showRegistryForm ? (
                  <div className="space-y-2">
                    <Input placeholder="Society name *" value={registryForm.name} onChange={(e) => setRegistryForm({ ...registryForm, name: e.target.value })} className="h-11 rounded-xl" />
                    <Input placeholder="City *" value={registryForm.city} onChange={(e) => setRegistryForm({ ...registryForm, city: e.target.value })} className="h-11 rounded-xl" />
                    <Input placeholder="Pincode *" inputMode="numeric" value={registryForm.pincode} onChange={(e) => setRegistryForm({ ...registryForm, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} className="h-11 rounded-xl" />
                    <Input placeholder="Address" value={registryForm.address} onChange={(e) => setRegistryForm({ ...registryForm, address: e.target.value })} className="h-11 rounded-xl" />
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setShowRegistryForm(false)}>Back</Button>
                      <Button className="flex-1 h-11 rounded-xl" onClick={handleRegistryRequest} disabled={resolvingSociety}>
                        {resolvingSociety ? <Loader2 size={16} className="animate-spin" /> : 'Submit request'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <ApprovedSocietyPicker
                      societies={filteredApproved}
                      query={societyQuery}
                      onQueryChange={setSocietyQuery}
                      selectedId={pickedSociety?.id}
                      onSelect={setPickedSociety}
                      loading={loadingApproved}
                    />
                    {pickedSociety?.invite_code && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Invite code</Label>
                        <Input
                          value={inviteCode}
                          onChange={(e) => setInviteCode(e.target.value)}
                          placeholder="Enter invite code"
                          className="mt-1.5 h-11 rounded-xl"
                        />
                      </div>
                    )}
                    {pickedSociety && (
                      <div className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-2.5">
                        <p className="text-xs font-semibold text-foreground">After you request to join</p>
                        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                          Add your tower/block and flat in Delivery Address so the committee can match and approve you. Status stays pending until approved.
                        </p>
                      </div>
                    )}
                    <Button
                      className="w-full h-11 rounded-xl font-semibold"
                      onClick={handleJoinApprovedSociety}
                      disabled={!pickedSociety || resolvingSociety}
                    >
                      {resolvingSociety ? <Loader2 size={16} className="animate-spin" /> : 'Request to join'}
                    </Button>
                    <button
                      type="button"
                      className="w-full text-center text-sm text-primary font-medium"
                      onClick={() => setShowRegistryForm(true)}
                    >
                      Can&apos;t find your society? Request it
                    </button>
                  </>
                )}
              </div>
            )}
            {!needsSociety && (
            <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Delivery Address</h3>
              {!showAddressForm && !shouldAutoOpen && !pendingInvite && addresses.length > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={handleAddNew}>
                  <Plus size={14} className="mr-1" /> Add New
                </Button>
              )}
            </div>

            {pendingInvite ? (
              <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <KeyRound size={16} className="mt-0.5 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{pendingInvite.societyName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      This society requires an invite code to join.
                    </p>
                  </div>
                </div>
                <div>
                  <Label htmlFor="invite" className="text-xs text-muted-foreground">Invite code</Label>
                  <Input
                    id="invite"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="Enter invite code"
                    className="mt-1.5"
                    autoCapitalize="characters"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setPendingInvite(null); setInviteCode(''); }}
                    disabled={resolvingSociety}
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleInviteContinue}
                    disabled={resolvingSociety || !inviteCode.trim()}
                  >
                    {resolvingSociety ? <Loader2 size={16} className="animate-spin" /> : 'Join & Save'}
                  </Button>
                </div>
              </div>
            ) : showAddressForm || shouldAutoOpen ? (
              <AddressForm
                initial={
                  editingAddress
                  || (shouldAutoOpen || focusAddress
                    ? seedDeliveryAddress({
                        society,
                        preferSociety: true,
                      }) || undefined
                    : undefined)
                  || undefined
                }
                autoOpenMap={false}
                deliveryOnly
                onSave={handleSaveAddress}
                onCancel={() => { setShowAddressForm(false); setEditingAddress(null); setDismissedAutoOpen(true); }}
                saving={isSaving || resolvingSociety}
              />
            ) : addressesLoading ? (
              <div className="space-y-2">
                {[1, 2].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
              </div>
            ) : addresses.length === 0 ? (
              <div className="text-center py-8 bg-muted/30 rounded-xl border border-dashed border-border">
                <MapPin size={24} className="mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No delivery addresses yet</p>
                <p className="text-xs text-muted-foreground mt-0.5">Add one for faster checkout</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={handleAddNew}>
                  <Plus size={14} className="mr-1" /> Add Address
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {addresses.map(addr => (
                  <AddressCard
                    key={addr.id}
                    address={addr as any}
                    onEdit={handleEditAddress}
                    onDelete={deleteAddress}
                    onSetDefault={setDefault}
                  />
                ))}
              </div>
            )}

            {/* Save & Continue button */}
            {!showAddressForm && !shouldAutoOpen && !pendingInvite && addresses.length > 0 && (
              <Button
                onClick={handleContinueToDetails}
                className="w-full h-11 rounded-xl font-semibold mt-4"
              >
                Save & Continue
                <ChevronRight size={16} className="ml-1" />
              </Button>
            )}
            </>
            )}
          </div>
        )}

        {/* ═══ STEP 2: YOUR DETAILS ═══ */}
        {step === 2 && (
          <div ref={detailsRef} className="px-4 mt-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Your Details</h3>
            <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
              {/* Name */}
              <div>
                <Label htmlFor="name" className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <User size={12} /> Full Name
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Enter your full name"
                  className="mt-1.5"
                />
              </div>

              {/* Phone (read-only) */}
              <div>
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Phone size={12} /> Phone
                </Label>
                <Input value={profile?.phone || user?.phone || ''} disabled className="mt-1.5 bg-muted/50" />
              </div>

              {/* Email */}
              <div>
                <Label htmlFor="email" className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Mail size={12} /> Email (optional)
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="mt-1.5"
                />
              </div>

              <Button onClick={handleSaveProfile} disabled={savingProfile || !name.trim()} className="w-full h-11 rounded-xl font-semibold">
                {savingProfile ? <Loader2 size={16} className="mr-1 animate-spin" /> : null}
                {goesToCart
                  ? 'Save & Continue to Cart'
                  : returnTo && returnTo !== '/'
                    ? 'Save & Continue'
                    : 'Save & Go to Home'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
