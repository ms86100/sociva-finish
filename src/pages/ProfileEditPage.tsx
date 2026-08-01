// @ts-nocheck
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AddressForm } from '@/components/profile/AddressForm';
import { AddressCard } from '@/components/profile/AddressCard';
import { useAuth } from '@/contexts/AuthContext';
import { useDeliveryAddresses } from '@/hooks/useDeliveryAddresses';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Loader2, Mail, MapPin, Phone, User, ChevronRight } from 'lucide-react';
import { useRef } from 'react';

export default function ProfileEditPage() {
  const navigate = useNavigate();
  const { user, profile, society, refreshProfile } = useAuth();
  const { addresses, isLoading: addressesLoading, saveAddress, deleteAddress, setDefault, isSaving } = useDeliveryAddresses();

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
  const [dismissedAutoOpen, setDismissedAutoOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);

  // Auto-open address form if no addresses exist (unless user dismissed it)
  const shouldAutoOpen = !addressesLoading && addresses.length === 0 && !showAddressForm && !dismissedAutoOpen;

  const handleSaveProfile = async () => {
    if (!user || !name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSavingProfile(true);
    try {
      const { error } = await supabase.from('profiles').update({
        name: name.trim(),
        email: email.trim() && !email.trim().endsWith('@phone.sociva.app') ? email.trim() : null,
      }).eq('id', user.id);
      if (error) throw error;
      await refreshProfile();
      toast.success('Profile updated! Redirecting…');
      navigate('/');
    } catch {
      toast.error('Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveAddress = async (data: any) => {
    const payload = {
      ...data,
      society_id: profile?.society_id || null,
    };

    await saveAddress(payload);

    // Sync flat_number and block back to profile
    if (user && (data.flat_number || data.block)) {
      try {
        await supabase.from('profiles').update({
          flat_number: data.flat_number || '',
          block: data.block || '',
          phase: data.phase || null,
        }).eq('id', user.id);
        await refreshProfile();
      } catch {
        // Non-critical — don't block address save
      }
    }

    setShowAddressForm(false);
    setEditingAddress(null);

    // Auto-advance to step 2 after first address save
    setTimeout(() => {
      setStep(2);
      setTimeout(() => {
        detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }, 300);
  };

  const handleEditAddress = (addr: any) => {
    setEditingAddress(addr);
    setShowAddressForm(true);
  };

  const handleAddNew = () => {
    const defaults: any = {};
    if (society) {
      defaults.building_name = society.name;
      if (society.latitude) defaults.latitude = society.latitude;
      if (society.longitude) defaults.longitude = society.longitude;
      if (society.pincode) defaults.pincode = society.pincode;
    }
    setEditingAddress(Object.keys(defaults).length > 0 ? defaults : null);
    setShowAddressForm(true);
  };

  const handleContinueToDetails = () => {
    setStep(2);
    setTimeout(() => {
      detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  return (
    <AppLayout headerTitle="Edit Profile" showNav={false}>
      <div className="pb-8">
        {/* Back */}
        <div className="px-4 pt-3">
          <button onClick={() => step === 2 ? setStep(1) : navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <ArrowLeft size={16} /> {step === 2 ? 'Back to Address' : 'Back'}
          </button>
        </div>

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
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Delivery Address</h3>
              {!showAddressForm && !shouldAutoOpen && addresses.length > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={handleAddNew}>
                  <Plus size={14} className="mr-1" /> Add New
                </Button>
              )}
            </div>

            {showAddressForm || shouldAutoOpen ? (
              <AddressForm
                initial={editingAddress || undefined}
                onSave={handleSaveAddress}
                onCancel={() => { setShowAddressForm(false); setEditingAddress(null); setDismissedAutoOpen(true); }}
                saving={isSaving}
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
            {!showAddressForm && !shouldAutoOpen && addresses.length > 0 && (
              <Button
                onClick={handleContinueToDetails}
                className="w-full h-11 rounded-xl font-semibold mt-4"
              >
                Save & Continue
                <ChevronRight size={16} className="ml-1" />
              </Button>
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
                Save & Go to Home
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
