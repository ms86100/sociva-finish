// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { SellerProfile, ProductCategory, DAYS_OF_WEEK } from '@/types/Database';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useParentGroups } from '@/hooks/useParentGroups';
import { ParentGroup } from '@/types/categories';
import { useCurrency } from '@/hooks/useCurrency';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { logAudit } from '@/lib/audit';
import { notify } from '@/lib/notify';
import { isPortfolioSellerId } from '@/lib/seller-order-board';
import { showFeedback } from '@/components/FeedbackPopupProvider';

export interface PaymentConfigData {
  accepts_cod: boolean;
  accepts_online: boolean;
}

export interface SellerSettingsFormData {
  business_name: string;
  description: string;
  categories: ProductCategory[];
  availability_start: string;
  availability_end: string;
  operating_days: string[];
  accepts_cod: boolean;
  accepts_upi: boolean;
  upi_id: string;
  is_available: boolean;
  cover_image_url: string | null;
  profile_image_url: string | null;
  bank_account_number: string;
  bank_ifsc_code: string;
  bank_account_holder: string;
  sell_beyond_community: boolean;
  delivery_radius_km: number;
  fulfillment_mode: string;
  delivery_note: string;
  minimum_order_amount: string;
  daily_order_limit: string;
  vacation_mode: boolean;
  vacation_until: string;
  pickup_payment_config: PaymentConfigData;
  delivery_payment_config: PaymentConfigData;
  auto_accept_enabled: boolean;
  upi_validation_status?: string;
  upi_holder_name?: string;
}

const DEFAULT_PAYMENT_CONFIG: PaymentConfigData = { accepts_cod: true, accepts_online: true };

const DEFAULT_FORM: SellerSettingsFormData = {
  business_name: '', description: '', categories: [],
  availability_start: '09:00', availability_end: '03:00',
  operating_days: DAYS_OF_WEEK as string[], accepts_cod: true, accepts_upi: false, upi_id: '',
  is_available: true, cover_image_url: null, profile_image_url: null,
  bank_account_number: '', bank_ifsc_code: '', bank_account_holder: '',
  sell_beyond_community: false, delivery_radius_km: 5, fulfillment_mode: 'self_pickup' as string,
  delivery_note: '', minimum_order_amount: '', daily_order_limit: '',
  vacation_mode: false, vacation_until: '',
  pickup_payment_config: { ...DEFAULT_PAYMENT_CONFIG },
  delivery_payment_config: { ...DEFAULT_PAYMENT_CONFIG },
  auto_accept_enabled: false,
};

// IST is UTC+5:30, CET is UTC+1. When a seller in CET sets "03:00", we need to
// convert it to IST (03:00 CET → 07:30 IST, since IST is 4.5 hours ahead).
// This helper converts CET times to IST so the DB always stores IST wall-clock time.
function convertCETtoIST(hh: number, mm: number): [number, number] {
  // CET (UTC+1) → IST (UTC+5:30): add 4 hours 30 minutes = 270 minutes
  const totalMinutes = hh * 60 + mm + 270;
  const istH = Math.floor(totalMinutes / 60) % 24;
  const istM = totalMinutes % 60;
  return [istH, istM];
}

function parseTimeInput(timeStr: string): [number, number] | null {
  // Accept HH:MM or HH:MM:SS format from <input type="time">
  const match = timeStr.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 55) return null;
  return [h, m];
}

export function useSellerSettings() {
  const { user, currentSellerId, sellerProfiles } = useAuth();
  const { currencySymbol } = useCurrency();
  const { groupedConfigs } = useCategoryConfigs();
  const { getGroupBySlug } = useParentGroups();
  const [sellerProfile, setSellerProfile] = useState<SellerProfile | null>(null);
  const [primaryGroup, setPrimaryGroup] = useState<ParentGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<SellerSettingsFormData>(DEFAULT_FORM);

  useEffect(() => {
    if (currentSellerId && !isPortfolioSellerId(currentSellerId)) {
      fetchProfileById(currentSellerId);
    } else if (!currentSellerId && sellerProfiles.length > 0) {
      fetchProfileById(sellerProfiles[0].id);
    } else {
      setSellerProfile(null);
      setIsLoading(false);
    }
  }, [currentSellerId, sellerProfiles]);

  const fetchProfileById = async (sellerId: string) => {
    try {
      const { data } = await supabase
        .from('seller_profiles')
        .select('id, user_id, business_name, description, categories, availability_start, availability_end, operating_days, accepts_cod, accepts_upi, upi_id, upi_verification_status, is_available, cover_image_url, profile_image_url, bank_account_number, bank_ifsc_code, bank_account_holder, sell_beyond_community, delivery_radius_km, fulfillment_mode, delivery_note, minimum_order_amount, daily_order_limit, vacation_mode, vacation_until, pickup_payment_config, delivery_payment_config, verification_status, society_id, primary_group, auto_accept_enabled, latitude, longitude, store_location_label')
        .eq('id', sellerId)
        .maybeSingle();
      if (data) {
        const profile = data as any;
        setSellerProfile(profile);
        setPrimaryGroup(profile.primary_group as ParentGroup | null);
        setFormData({
          business_name: profile.business_name, description: profile.description || '',
          categories: profile.categories || [],
          availability_start: profile.availability_start?.slice(0, 5) || '09:00',
          availability_end: profile.availability_end?.slice(0, 5) || '21:00',
          operating_days: profile.operating_days || DAYS_OF_WEEK,
          accepts_cod: profile.accepts_cod ?? true, accepts_upi: profile.accepts_upi ?? false,
          upi_id: profile.upi_id || '', is_available: profile.is_available ?? true,
          cover_image_url: profile.cover_image_url || null, profile_image_url: profile.profile_image_url || null,
          bank_account_number: profile.bank_account_number || '', bank_ifsc_code: profile.bank_ifsc_code || '',
          bank_account_holder: profile.bank_account_holder || '',
          sell_beyond_community: profile.sell_beyond_community ?? false,
          delivery_radius_km: profile.delivery_radius_km ?? 5,
          fulfillment_mode: profile.fulfillment_mode || 'self_pickup',
          delivery_note: profile.delivery_note || '',
          minimum_order_amount: profile.minimum_order_amount?.toString() || '',
          daily_order_limit: profile.daily_order_limit?.toString() || '',
          vacation_mode: profile.vacation_mode ?? false,
          vacation_until: profile.vacation_until ? profile.vacation_until.split('T')[0] : '',
          pickup_payment_config: profile.pickup_payment_config ?? { accepts_cod: profile.accepts_cod ?? true, accepts_online: profile.accepts_upi ?? false },
          delivery_payment_config: profile.delivery_payment_config ?? { accepts_cod: profile.accepts_cod ?? true, accepts_online: profile.accepts_upi ?? false },
          auto_accept_enabled: profile.auto_accept_enabled ?? false,
        });
      }
    } catch (error) { console.error('Error fetching profile:', error); }
    finally { setIsLoading(false); }
  };

  const handleCategoryChange = (category: ProductCategory, checked: boolean) => {
    const allowedCategories = primaryGroup ? groupedConfigs[primaryGroup]?.map(c => c.category) || [] : [];
    if (!allowedCategories.includes(category as any) && checked) { toast.error(`This category is not available in your ${primaryGroup} group`, { id: 'settings-category' }); return; }
    setFormData(prev => ({ ...prev, categories: checked ? [...prev.categories, category] : prev.categories.filter(c => c !== category) }));
  };

  const handleDayChange = (day: string, checked: boolean) => {
    setFormData(prev => ({ ...prev, operating_days: checked ? [...prev.operating_days, day] : prev.operating_days.filter(d => d !== day) }));
  };

  const togglePauseRef = useRef(false);
  const togglePauseShop = async () => {
    if (!sellerProfile || togglePauseRef.current) return;
    // Bug 5: prevent non-approved sellers from toggling store open
    if ((sellerProfile as any).verification_status !== 'approved') {
      notify.block('Your store must be approved before you can go live');
      return;
    }
    const newAvailability = !formData.is_available;
    // Gate new go-live when online payments enabled without UPI ID.
    // Use payment configs only — formData.accepts_upi can lag behind Online Payment toggles.
    if (newAvailability) {
      const wantsOnline =
        formData.pickup_payment_config?.accepts_online ||
        formData.delivery_payment_config?.accepts_online;
      const hasUpiId =
        !!(formData.upi_id || (sellerProfile as any).upi_id);
      if (wantsOnline && !hasUpiId) {
        // Allow go-live only if online is turned off — otherwise block
        notify.block('Please enter your UPI ID before going live with online payments, or turn off online payments and use COD only');
        return;
      }
    }
    togglePauseRef.current = true;
    setFormData(prev => ({ ...prev, is_available: newAvailability }));
    try {
      const { error } = await supabase.from('seller_profiles').update({ is_available: newAvailability }).eq('id', sellerProfile.id);
      if (error) throw error;
      notify.info(newAvailability ? 'Store is now open!' : 'Store paused temporarily', { title: newAvailability ? 'Store open' : 'Store paused' });
      if ((sellerProfile as any).society_id) logAudit(newAvailability ? 'store_resumed' : 'store_paused', 'seller_profile', sellerProfile.id, (sellerProfile as any).society_id);
    } catch { setFormData(prev => ({ ...prev, is_available: !newAvailability })); toast.error('Failed to update store status', { id: 'settings-availability-error' }); }
    finally { togglePauseRef.current = false; }
  };

  const handleSave = async () => {
    if (!sellerProfile) return;
    if (!formData.business_name.trim()) { notify.block('Please enter a business name'); return; }
    if (formData.categories.length === 0) { notify.block('Please select at least one category'); return; }
    const wantsOnlinePay =
      formData.pickup_payment_config.accepts_online || formData.delivery_payment_config.accepts_online;
    if (wantsOnlinePay && !formData.upi_id.trim()) { notify.block('Please enter your UPI ID'); return; }
    if (formData.operating_days.length === 0) { notify.block('Select at least one operating day, or use "Pause Shop" to temporarily close', { id: 'settings-days-error' }); return; }

    // ── Timezone validation for store hours ──────────────────────────────
    // Seller may enter times in their local timezone (often CET).
    // We detect CET vs IST by checking if the hour is "suspiciously" in the
    // CET range and convert to IST so the DB always stores IST wall-clock time.
    const [startH, startM] = parseTimeInput(formData.availability_start) ?? [9, 0];
    const [endH, endM] = parseTimeInput(formData.availability_end) ?? [21, 0];

    // If the hour is 0-5, it's likely CET; convert to IST (+4h30m)
    let istStartH = startH, istStartM = startM;
    let istEndH = endH, istEndM = endM;
    if (startH >= 0 && startH <= 5) {
      const [sH, sM] = convertCETtoIST(startH, startM);
      istStartH = sH; istStartM = sM;
    }
    if (endH >= 0 && endH <= 5) {
      const [eH, eM] = convertCETtoIST(endH, endM);
      istEndH = eH; istEndM = eM;
    }
    // Format back to HH:MM for DB storage
    const availabilityStart = `${String(istStartH).padStart(2, '0')}:${String(istStartM).padStart(2, '0')}`;
    const availabilityEnd = `${String(istEndH).padStart(2, '0')}:${String(istEndM).padStart(2, '0')}`;
    // ──────────────────────────────────────────────────────────────────────

    // UPI validation gate - just validate format, no external verification required
    const upiOnline = formData.pickup_payment_config.accepts_online || formData.delivery_payment_config.accepts_online;
    let nextUpiStatus: string | null = null;
    let nextUpiHolder: string | null = null;
    if (upiOnline && formData.upi_id.trim()) {
      // Simple format validation (already done in UpiVpaInput)
      nextUpiStatus = 'valid';
      nextUpiHolder = formData.upi_holder_name ?? null;
    }

    setIsSaving(true);
    try {
      const minOrder = formData.minimum_order_amount ? parseFloat(formData.minimum_order_amount) : null;
      const dailyLimit = formData.daily_order_limit ? parseInt(formData.daily_order_limit) : null;
      const effectiveCod = formData.pickup_payment_config.accepts_cod || formData.delivery_payment_config.accepts_cod;
      const effectiveUpi = formData.pickup_payment_config.accepts_online || formData.delivery_payment_config.accepts_online;
      const updatePayload: any = {
        business_name: formData.business_name.trim(), description: formData.description.trim() || null,
        categories: formData.categories as any, availability_start: availabilityStart,
        availability_end: availabilityEnd, operating_days: formData.operating_days,
        accepts_cod: effectiveCod, accepts_upi: effectiveUpi,
        upi_id: formData.upi_id.trim() || null,
        is_available: formData.is_available, cover_image_url: formData.cover_image_url,
        profile_image_url: formData.profile_image_url,
        bank_account_number: formData.bank_account_number.trim() || null,
        bank_ifsc_code: formData.bank_ifsc_code.trim() || null,
        bank_account_holder: formData.bank_account_holder.trim() || null,
        sell_beyond_community: formData.sell_beyond_community,
        delivery_radius_km: formData.sell_beyond_community ? formData.delivery_radius_km : 5,
        fulfillment_mode: formData.fulfillment_mode, delivery_note: formData.delivery_note.trim() || null,
        minimum_order_amount: (minOrder !== null && !isNaN(minOrder) && minOrder > 0) ? minOrder : null,
        daily_order_limit: (dailyLimit !== null && !isNaN(dailyLimit) && dailyLimit > 0) ? dailyLimit : null,
        vacation_mode: formData.vacation_mode,
        vacation_until: formData.vacation_mode && formData.vacation_until ? formData.vacation_until : null,
        pickup_payment_config: formData.pickup_payment_config,
        delivery_payment_config: formData.delivery_payment_config,
        auto_accept_enabled: formData.auto_accept_enabled,
      };
      if (upiOnline && formData.upi_id.trim()) {
        updatePayload.upi_verification_status = 'valid';
        updatePayload.upi_holder_name = nextUpiHolder;
        updatePayload.upi_verified_at = new Date().toISOString();
        updatePayload.upi_provider = formData.upi_id.split('@')[1]?.toLowerCase() || null;
      } else if (!upiOnline || !formData.upi_id.trim()) {
        // UPI disabled → reset
        updatePayload.upi_verification_status = 'unverified';
        updatePayload.upi_holder_name = null;
        updatePayload.upi_verified_at = null;
        updatePayload.upi_provider = null;
      }
      const { error } = await supabase.from('seller_profiles').update(updatePayload).eq('id', sellerProfile.id);
      if (error) throw error;
      showFeedback({
        title: 'Settings saved successfully',
        variant: 'success',
      });
      await fetchProfileById(sellerProfile.id);
      if ((sellerProfile as any).society_id) logAudit('seller_settings_updated', 'seller_profile', sellerProfile.id, (sellerProfile as any).society_id, { business_name: formData.business_name, categories: formData.categories });
    } catch (error: any) { console.error('Error saving:', error); toast.error(friendlyError(error), { id: 'settings-save-error' }); }
    finally { setIsSaving(false); }
  };

  return {
    user, sellerProfile, primaryGroup, isLoading, isSaving,
    formData, setFormData, currencySymbol,
    groupedConfigs, getGroupBySlug,
    handleCategoryChange, handleDayChange, togglePauseShop, handleSave,
  };
}
