// @ts-nocheck
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { ServiceCategory } from '@/types/categories';
import { DraftProductManager } from '@/components/seller/DraftProductManager';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { LicenseUpload } from '@/components/seller/LicenseUpload';
import { CroppableImageUpload } from '@/components/ui/croppable-image-upload';
import { ServiceAvailabilityManager } from '@/components/seller/ServiceAvailabilityManager';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { DAYS_OF_WEEK } from '@/types/Database';
import { ArrowLeft, Store, Loader2, ChevronRight, Settings, Shield, Save, Send, LayoutGrid, Tags, FileText, Package, CheckCircle2, ArrowRight, Truck, Smartphone, Banknote, Clock, ImageIcon, MapPin, Navigation, CheckCircle, Star, X, Search, ShoppingCart, Calendar, MessageCircle, Phone, Coins, Home } from 'lucide-react';
import { useActionTypeMap, useCategoryAllowedActions } from '@/hooks/useActionTypeMap';
import { OnboardingLocationSheet } from '@/components/seller/OnboardingLocationSheet';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useDeliveryAddresses } from '@/hooks/useDeliveryAddresses';
import { useSellerApplication } from '@/hooks/useSellerApplication';
import { ensureSellerSocietyForSubmit } from '@/lib/seller-society';
import type { SellerFormData } from '@/hooks/useSellerApplication';
import { useSubcategories } from '@/hooks/useSubcategories';
import { SubcategoryPickerDialog, SubcategorySelection } from '@/components/seller/SubcategoryPickerDialog';
import { PendingCategoryRequestsBanner, useOpenCategoryRequests } from '@/components/seller/PendingCategoryRequestsBanner';
import { ParentGroupPickerStep } from '@/components/seller/ParentGroupPickerStep';
import { CommerceModelStep } from '@/components/seller/CommerceModelStep';
import { ProductOfferingStep } from '@/components/seller/ProductOfferingStep';
import { RequestCategoryDialog } from '@/components/seller/RequestCategoryDialog';
import { ExistingStoresOnboardingPanel } from '@/components/seller/ExistingStoresOnboardingPanel';
import { resolveStoreCategoryLabel } from '@/lib/store-category-label';
import { UpiVpaInput } from '@/components/payment/UpiVpaInput';
import {
  resolveListingIntent,
  commerceModelToDefaultAction,
  commerceModelFromActionType,
  softTagToCommerceModel,
  NEW_ONBOARDING_TOTAL_STEPS,
  type SoftListingTag,
  type CommerceModel,
} from '@/lib/listing-intent';
import type { BuyerJourneyId } from '@/lib/buyer-journey';
import { notify } from '@/lib/notify';
import {
  FREE_DELIVERY_NOTICE,
  HOME_SELLER_LOCATION_HINT,
  LICENSE_ONBOARDING_HINT,
  SELLING_RADIUS_HELPER,
  formatStoreLocationLabel,
  isSellerDeliveryMode,
  licenseStatusBlocksOnboarding,
  onboardingLicenseMandatory,
  sellingRadiusCopy,
} from '@/lib/seller-onboarding-copy';
// ─── Store Location Picker ──────────────────────────────────────────────────
function StoreLocationPicker({ latitude, longitude, label, onLocationSet, hasSociety, societyHasCoords, existingStoreLocations = [], societyLocation = null, deliveryLocations = [] }: {
  latitude: number | null;
  longitude: number | null;
  label?: string | null;
  onLocationSet: (lat: number, lng: number, name?: string, formattedAddress?: string) => void;
  hasSociety: boolean;
  /** False when society membership exists but society row has no lat/lng — pin is mandatory. */
  societyHasCoords: boolean | null;
  existingStoreLocations?: { id: string; business_name: string; latitude: number; longitude: number; store_location_label?: string | null }[];
  societyLocation?: { name: string; latitude: number; longitude: number } | null;
  deliveryLocations?: { id: string; label: string; latitude: number; longitude: number; building_name?: string | null }[];
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [locationName, setLocationName] = useState<string | null>(label ?? null);
  const [locationAddress, setLocationAddress] = useState<string | null>(null);
  useEffect(() => { if (label) setLocationName(label); }, [label]);
  const hasCoords = !!(latitude && longitude);
  const locationRequired = true;
  const showSocietyWarning = hasSociety && societyHasCoords === false;

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MapPin size={16} className="text-primary" />
        <h3 className="font-semibold text-sm">Set your selling location {locationRequired && <span className="text-destructive">*</span>}</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{HOME_SELLER_LOCATION_HINT}</p>
      {showSocietyWarning && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <p className="text-xs font-medium text-foreground">Your society has no map location on file</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Set your store pin here before continuing — you won&apos;t be able to submit without it.
          </p>
        </div>
      )}
      {hasCoords ? (
        <div className="flex items-center gap-2 p-3 bg-success/10 rounded-lg">
          <CheckCircle size={16} className="text-success shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-success truncate">{locationName || 'Location set'}</p>
            {locationAddress && locationAddress !== locationName && (
              <p className="text-xs text-muted-foreground truncate">{locationAddress}</p>
            )}
            {!locationName && !locationAddress && (
              <p className="text-xs text-muted-foreground">{latitude?.toFixed(5)}, {longitude?.toFixed(5)}</p>
            )}
          </div>
          <Button variant="outline" size="sm" className="text-xs h-7 shrink-0" onClick={() => setSheetOpen(true)}>Change</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {(existingStoreLocations.length > 0 || societyLocation || deliveryLocations.length > 0) && (
            <>
              <p className="text-xs font-medium text-muted-foreground">Use an existing location</p>
              <div className="space-y-2">
                {societyLocation && (
                  <button
                    type="button"
                    onClick={() => {
                      setLocationName(societyLocation.name);
                      setLocationAddress(null);
                      onLocationSet(societyLocation.latitude, societyLocation.longitude, societyLocation.name, societyLocation.name);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent/50 active:bg-accent/70 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <MapPin size={14} className="text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">Society — {societyLocation.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {societyLocation.latitude.toFixed(4)}, {societyLocation.longitude.toFixed(4)}
                      </p>
                    </div>
                  </button>
                )}
                {existingStoreLocations.map((store) => (
                  <button
                    type="button"
                    key={store.id}
                    onClick={() => {
                      const placeLabel = store.store_location_label || store.business_name;
                      setLocationName(placeLabel);
                      setLocationAddress(store.store_location_label || null);
                      onLocationSet(store.latitude, store.longitude, placeLabel, store.store_location_label || undefined);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent/50 active:bg-accent/70 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Store size={14} className="text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{store.business_name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{store.store_location_label || `${store.latitude.toFixed(4)}, ${store.longitude.toFixed(4)}`}</p>
                    </div>
                  </button>
                ))}
                {deliveryLocations.map((addr) => (
                  <button
                    type="button"
                    key={addr.id}
                    onClick={() => {
                      const placeLabel = addr.building_name || addr.label;
                      setLocationName(placeLabel);
                      setLocationAddress(addr.building_name || null);
                      onLocationSet(addr.latitude, addr.longitude, placeLabel, addr.building_name || addr.label);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent/50 active:bg-accent/70 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Home size={14} className="text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">Delivery — {addr.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{addr.building_name || `${addr.latitude.toFixed(4)}, ${addr.longitude.toFixed(4)}`}</p>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Set your store location so buyers can find you. The Google result does not need to be a formal business listing.
          </p>
          <Button variant="outline" className="w-full h-10" onClick={() => setSheetOpen(true)}>
            <Navigation size={14} className="mr-2" />
            Set selling location
          </Button>
          <p className="text-[10px] text-destructive">Required — your store won&apos;t be visible without a location</p>
        </div>
      )}
      <OnboardingLocationSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onConfirm={(lat, lng, name, formattedAddress) => {
          // Primary label = resolved POI/place name (e.g. "Aarti Special Kitchen").
          // Address goes on the secondary line.
          setLocationName(name || formattedAddress || null);
          setLocationAddress(formattedAddress || null);
          onLocationSet(lat, lng, name, formattedAddress);
          setSheetOpen(false);
        }}
      />
    </div>
  );
}

// ─── Category License Prompt (checks DB for requires_license) ───────────────
function CategoryLicensePrompt({ categoryConfigId, categoryName, draftSellerId, isOnboarding, onStatusChange }: {
  categoryConfigId: string;
  categoryName: string;
  draftSellerId: string | null;
  isOnboarding: boolean;
  onStatusChange: (status: string | null) => void;
}) {
  const [requiresLicense, setRequiresLicense] = useState<boolean | null>(null);
  const [licenseConfig, setLicenseConfig] = useState<{ license_type_name: string | null; license_mandatory: boolean } | null>(null);

  useEffect(() => {
    supabase.from('category_config')
      .select('requires_license, license_type_name, license_mandatory')
      .eq('id', categoryConfigId)
      .single()
      .then(({ data }) => {
        if (data) {
          setRequiresLicense((data as any).requires_license);
          setLicenseConfig(data as any);
        } else {
          setRequiresLicense(false);
        }
      });
  }, [categoryConfigId]);

  if (requiresLicense === null || requiresLicense === false) return null;

  const isMandatory = licenseConfig?.license_mandatory ?? false;

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Shield size={16} className="text-primary" />
        <h3 className="font-semibold text-sm">
          {isMandatory ? 'Required license' : 'License'}: {categoryName}
        </h3>
        {isMandatory && <Badge variant="destructive" className="text-[10px]">Required</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        {isMandatory
          ? `Upload your ${licenseConfig?.license_type_name || 'license'} to continue. ${LICENSE_ONBOARDING_HINT}`
          : 'This category may require a verified license before you can sell.'}
      </p>
      {draftSellerId ? (
        <LicenseUpload sellerId={draftSellerId} categoryConfigId={categoryConfigId} isOnboarding={isOnboarding} onStatusChange={onStatusChange} />
      ) : (
        <p className="text-xs text-muted-foreground italic">Saving your store details… license upload will appear in a moment.</p>
      )}
    </div>
  );
}

// ─── Parent-group License Prompt ─────────────────────────────────────────────
function GroupLicensePrompt({ groupId, groupName, licenseTypeName, licenseMandatory, draftSellerId, isOnboarding, onStatusChange }: {
  groupId: string;
  groupName: string;
  licenseTypeName: string | null;
  licenseMandatory: boolean;
  draftSellerId: string | null;
  isOnboarding: boolean;
  onStatusChange: (status: string | null) => void;
}) {
  const [requiresLicense, setRequiresLicense] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.from('parent_groups')
      .select('requires_license')
      .eq('id', groupId)
      .single()
      .then(({ data }) => setRequiresLicense(!!(data as any)?.requires_license));
  }, [groupId]);

  if (requiresLicense === null || requiresLicense === false) return null;

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Shield size={16} className="text-primary" />
        <h3 className="font-semibold text-sm">
          {licenseMandatory ? 'Required license' : 'License'}: {groupName}
        </h3>
        {licenseMandatory && <Badge variant="destructive" className="text-[10px]">Required</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        {licenseMandatory
          ? `Upload your ${licenseTypeName || 'license'} to continue. ${LICENSE_ONBOARDING_HINT}`
          : `You may need a ${licenseTypeName || 'license'} for this store type.`}
      </p>
      {draftSellerId ? (
        <LicenseUpload sellerId={draftSellerId} groupId={groupId} isOnboarding={isOnboarding} onStatusChange={onStatusChange} />
      ) : (
        <p className="text-xs text-muted-foreground italic">Saving your store details… license upload will appear in a moment.</p>
      )}
    </div>
  );
}

const TOTAL_STEPS = NEW_ONBOARDING_TOTAL_STEPS;
const STEP_META = [
  { label: 'Store type', icon: LayoutGrid, title: 'What type of store?', helper: 'Food, education, services, and more — pick your lane first.' },
  { label: 'Category', icon: Tags, title: 'Choose your category', helper: 'Pick the category and subcategory that best fits what you sell.' },
  { label: 'Buyers', icon: ShoppingCart, title: 'How should buyers get it?', helper: 'This sets your store default — you can customize per product later.' },
  { label: 'Offering', icon: Package, title: 'What exactly are you selling?', helper: 'Name your first product — you can add more details later.' },
  { label: 'Store', icon: FileText, title: 'Set up your store', helper: 'Location first, then how you fulfil orders, then your store details.' },
  { label: 'Configure', icon: Settings, title: 'Configure your store', helper: 'A few quick decisions to get you up and running.' },
  { label: 'Products', icon: Package, title: 'Add your first products', helper: 'Buyers will see these once your store is approved. Start with 1-2 items.' },
  { label: 'Review', icon: CheckCircle2, title: 'Review and submit', helper: 'Double-check everything. You can edit your store after approval too.' },
];

const STORE_SETUP_SUB_STEPS = [
  { key: 'location', title: 'Where do you sell from?', helper: 'Set the exact map location buyers will see.' },
  { key: 'fulfillment', title: 'How will customers receive orders?', helper: 'Choose pickup, delivery, or both before setting distance.' },
  { key: 'radius', title: 'How far do you want to sell?', helper: SELLING_RADIUS_HELPER },
  { key: 'details', title: 'Store information', helper: 'These details help buyers find and trust your business.' },
];

const CONFIG_SUB_STEPS = [
  { key: 'payments', title: 'How do customers pay?', helper: 'Customer payments go to you. Sociva Credits are separate platform usage.' },
  { key: 'schedule', title: 'When are you open?', helper: 'Select your operating days and availability.' },
  { key: 'images', title: 'Make your store shine ✨', helper: 'Add photos to build trust — you can skip this for now.' },
];

function SubStepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-4">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all duration-300',
            i + 1 === current ? 'w-6 bg-primary' : i + 1 < current ? 'w-1.5 bg-primary/60' : 'w-1.5 bg-muted-foreground/20'
          )}
        />
      ))}
    </div>
  );
}
const FULFILLMENT_OPTIONS = [
  { value: 'self_pickup', label: 'Self Pickup', description: 'Customers pick up from your location', icon: Store, disabled: false },
  { value: 'seller_delivery', label: 'I Deliver', description: 'You deliver to customers', icon: Truck, disabled: false },
  { value: 'pickup_and_seller_delivery', label: 'Both', description: 'Buyer can choose pickup or you deliver', icon: Truck, disabled: false },
  { value: 'platform_delivery', label: 'Delivery Partner', description: 'Platform delivery partner delivers — available in future plans', icon: Truck, disabled: true },
  { value: 'pickup_and_platform_delivery', label: 'Pickup + Delivery Partner', description: 'Buyer can choose pickup or delivery partner — available in future plans', icon: Truck, disabled: true },
];

// ─── Guided Step 2: Subcategory Picker ─────────────────────────────────────
import type { SubcategoryPreferences } from '@/hooks/useSellerApplication';
import type { CategoryConfig } from '@/types/categories';

function GuidedStep2({
  selectedGroup, selectedGroupInfo, formData, setFormData,
  groupedConfigs, handleCategoryChange, onBack, onContinue, onSkip,
}: {
  selectedGroup: string;
  selectedGroupInfo: { label: string; icon: string; color: string; description?: string } | undefined;
  formData: SellerFormData;
  setFormData: React.Dispatch<React.SetStateAction<SellerFormData>>;
  groupedConfigs: Record<string, CategoryConfig[]>;
  handleCategoryChange: (cat: ServiceCategory, checked: boolean) => void;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const { groupedConfigs: _, isLoading } = useCategoryConfigs();
  const categories = groupedConfigs[selectedGroup as keyof typeof groupedConfigs] || [];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCategoryId, setPickerCategoryId] = useState<string | null>(null);

  const pickerCategory = categories.find(c => c.id === pickerCategoryId);

  // Fetch subcategories for each category to know which have subs
  const allSubsQuery = useSubcategories(); // fetch all active subcategories

  const getSubCount = (configId: string) => {
    return allSubsQuery.data?.filter(s => s.category_config_id === configId).length || 0;
  };

  const getSelectionCount = (configId: string): number => {
    const pref = formData.subcategory_preferences.data[configId];
    if (!pref) return 0;
    return (pref.primary ? 1 : 0) + pref.others.length;
  };

  const handleCardTap = (config: CategoryConfig) => {
    const subCount = getSubCount(config.id);
    if (subCount === 0) {
      // No subcategories → direct toggle
      handleCategoryChange(config.category, !formData.categories.includes(config.category));
    } else {
      // Open picker dialog
      setPickerCategoryId(config.id);
      setPickerOpen(true);
    }
  };

  const handlePickerSave = (configId: string, category: string, selection: SubcategorySelection) => {
    setFormData(f => {
      const newPrefsData = { ...f.subcategory_preferences.data };
      if (selection.primary || selection.others.length > 0) {
        newPrefsData[configId] = selection;
      } else {
        delete newPrefsData[configId];
      }
      // Auto-sync categories from preferences
      const prefsCategories = Object.keys(newPrefsData);
      const categorySlugMap = categories.reduce((acc, c) => { acc[c.id] = c.category; return acc; }, {} as Record<string, string>);
      const catsFromPrefs = prefsCategories.map(id => categorySlugMap[id]).filter(Boolean);
      // Merge with directly toggled categories (those without subcategories)
      const directToggles = f.categories.filter(cat => {
        const cfg = categories.find(c => c.category === cat);
        return cfg && getSubCount(cfg.id) === 0;
      });
      const mergedCats = [...new Set([...catsFromPrefs, ...directToggles])];
      // Add/remove the current category based on selection
      if (selection.primary || selection.others.length > 0) {
        if (!mergedCats.includes(category)) mergedCats.push(category);
      } else {
        const idx = mergedCats.indexOf(category);
        if (idx >= 0) mergedCats.splice(idx, 1);
      }
      return {
        ...f,
        categories: mergedCats,
        subcategory_preferences: { v: 1, data: newPrefsData },
      };
    });
  };

  const removeSubcategory = (configId: string, subId: string) => {
    setFormData(f => {
      const pref = f.subcategory_preferences.data[configId];
      if (!pref) return f;
      let newPref: SubcategorySelection;
      if (pref.primary === subId) {
        const [newPrimary, ...rest] = pref.others;
        newPref = { primary: newPrimary || null, others: rest };
      } else {
        newPref = { ...pref, others: pref.others.filter(o => o !== subId) };
      }
      const newData = { ...f.subcategory_preferences.data };
      if (!newPref.primary && newPref.others.length === 0) {
        delete newData[configId];
        // Also remove category
        const cfg = categories.find(c => c.id === configId);
        return {
          ...f,
          categories: cfg ? f.categories.filter(c => c !== cfg.category) : f.categories,
          subcategory_preferences: { v: 1, data: newData },
        };
      }
      newData[configId] = newPref;
      return { ...f, subcategory_preferences: { v: 1, data: newData } };
    });
  };

  // Collect all selected subcategory chips for display
  const allSelectedChips: { configId: string; subId: string; isPrimary: boolean; displayName: string; categoryName: string }[] = [];
  Object.entries(formData.subcategory_preferences.data).forEach(([configId, pref]) => {
    const cfg = categories.find(c => c.id === configId);
    const catName = cfg?.displayName || '';
    if (pref.primary) {
      const sub = allSubsQuery.data?.find(s => s.id === pref.primary);
      allSelectedChips.push({ configId, subId: pref.primary, isPrimary: true, displayName: sub?.display_name || 'Selected', categoryName: catName });
    }
    pref.others.forEach(id => {
      const sub = allSubsQuery.data?.find(s => s.id === id);
      allSelectedChips.push({ configId, subId: id, isPrimary: false, displayName: sub?.display_name || 'Selected', categoryName: catName });
    });
  });

  const hasAnySelection = formData.categories.length > 0;

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft size={16} />Change category
      </button>

      {/* Group header */}
      <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center', selectedGroupInfo?.color)}>
          <DynamicIcon name={selectedGroupInfo?.icon || ''} size={24} />
        </div>
        <div>
          <h3 className="font-semibold">{selectedGroupInfo?.label}</h3>
          <p className="text-xs text-muted-foreground">{selectedGroupInfo?.description}</p>
        </div>
      </div>

      <p className="text-sm font-medium text-muted-foreground">What are you looking to sell?</p>

      {/* Category cards grid */}
      {isLoading ? (
        <div className="text-center py-4 text-muted-foreground">Loading categories...</div>
      ) : categories.length === 0 ? (
        <div className="text-center py-4 text-muted-foreground">No categories available</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {categories.map((config) => {
            const isSelected = formData.categories.includes(config.category);
            const selCount = getSelectionCount(config.id);
            const subCount = getSubCount(config.id);
            return (
              <button
                key={config.category}
                onClick={() => handleCardTap(config)}
                className={cn(
                  'flex items-center gap-2 p-3 rounded-xl border-2 transition-all text-left relative',
                  isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30'
                )}
              >
                <DynamicIcon name={config.icon} size={18} />
                <span className="text-sm font-medium flex-1">{config.displayName}</span>
                {selCount > 0 && (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0 h-5 min-w-[20px] justify-center">
                    {selCount}
                  </Badge>
                )}
                {isSelected && subCount === 0 && (
                  <CheckCircle size={16} className="text-primary shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Selected subcategory chips */}
      {allSelectedChips.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Your selections:</p>
          <div className="flex flex-wrap gap-1.5">
            {allSelectedChips.map((chip) => (
              <Badge
                key={`${chip.configId}-${chip.subId}`}
                variant={chip.isPrimary ? 'default' : 'secondary'}
                className="text-xs py-1 px-2 gap-1"
              >
                {chip.isPrimary && <Star size={10} className="fill-current" />}
                {chip.displayName}
                <button
                  onClick={() => removeSubcategory(chip.configId, chip.subId)}
                  className="ml-0.5 hover:opacity-70"
                >
                  <X size={12} />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
        <ArrowRight size={12} />Next: You'll name your store and set operating hours
      </p>

      <Button className="w-full" onClick={onContinue} disabled={!hasAnySelection}>
        Continue<ChevronRight size={16} className="ml-1" />
      </Button>

      {!hasAnySelection && (
        <p className="w-full text-center text-xs text-muted-foreground py-1">
          Select a category to continue
        </p>
      )}

      {/* Subcategory Picker Dialog */}
      {pickerCategory && (
        <SubcategoryPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          categoryConfigId={pickerCategory.id}
          categoryName={pickerCategory.displayName}
          categoryIcon={pickerCategory.icon}
          categorySlug={pickerCategory.category}
          parentGroupSlug={pickerCategory.parentGroup}
          selected={formData.subcategory_preferences.data[pickerCategory.id] || { primary: null, others: [] }}
          onSave={(sel) => handlePickerSave(pickerCategory.id, pickerCategory.category, sel)}
        />
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function BecomeSellerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const forceNew = searchParams.get('new') === '1';
  const { profile, sellerProfiles, setCurrentSellerId, refreshProfile } = useAuth();
  const { addresses: deliveryAddresses } = useDeliveryAddresses();
  const app = useSellerApplication({ forceNew });
  const { configs } = useCategoryConfigs();
  const [societyLoc, setSocietyLoc] = useState<{ name: string; latitude: number; longitude: number } | null>(null);
  const [societyHasCoords, setSocietyHasCoords] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profile?.society_id) {
        setSocietyLoc(null);
        setSocietyHasCoords(null);
        return;
      }
      const { data } = await supabase
        .from('societies')
        .select('name, latitude, longitude')
        .eq('id', profile.society_id)
        .maybeSingle();
      if (cancelled) return;
      const lat = data?.latitude != null ? Number(data.latitude) : null;
      const lng = data?.longitude != null ? Number(data.longitude) : null;
      if (lat && lng) {
        setSocietyLoc({ name: data?.name || 'Your society', latitude: lat, longitude: lng });
        setSocietyHasCoords(true);
      } else {
        setSocietyLoc(null);
        setSocietyHasCoords(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.society_id]);
  const { data: allActions = [] } = useActionTypeMap();
  const { data: openCategoryRequests = [] } = useOpenCategoryRequests();
  const pendingCategoryRequests = openCategoryRequests.filter((r: any) => r.status === 'pending');
  const pendingCategoryNames = pendingCategoryRequests
    .map((r: any) => r.requested_name)
    .filter(Boolean);

  // ─── Interaction mode state (persisted in sessionStorage) ─────────────
  const [storeActionType, setStoreActionType] = useState<string>(() => {
    try { return sessionStorage.getItem('onboarding_store_action_type') || ''; } catch { return ''; }
  });
  const handleSetStoreActionType = useCallback((val: string) => {
    setStoreActionType(val);
    try { sessionStorage.setItem('onboarding_store_action_type', val); } catch { /* */ }
  }, []);
  const {
    user, isLoading, isCheckingExisting, groupsLoading, existingSeller, draftSellerId,
    step, setStep, selectedGroup, setSelectedGroup, formData, setFormData,
    draftProducts, setDraftProducts, acceptedDeclaration, setAcceptedDeclaration,
    licenseStatus, setLicenseStatus, parentGroupInfos, groups, groupedConfigs,
    selectedGroupInfo, selectedGroupRow, handleCategoryChange, toggleOperatingDay,
    handleProceedToSettings, handleProceedToProducts, handleSaveDraftAndExit, handleSubmit,
    setExistingSeller, setDraftSellerId, handleStepBack, handleBackToGroupPicker, handleGroupSelect, submissionComplete,
    loadSellerDataIntoForm, reloadProducts, rejectionFeedback, setRejectionFeedback,
    resumeExistingStore, startNewStoreOnboarding,
    listingIntentPhrase, setListingIntentPhrase,
    commerceModel, setCommerceModel, applyCommerceModelChange,
    seedProductName, setSeedProductName,
    softListingTag, setSoftListingTag,
  } = app;

  // Resume / review can show "add a product" falsely if products weren't loaded yet
  useEffect(() => {
    if (!draftSellerId) return;
    if (step === 7 || step === 8) {
      void reloadProducts(draftSellerId);
    }
  }, [step, draftSellerId, reloadProducts]);

  const allSubsQuery = useSubcategories();
  const allSubs = allSubsQuery.data || [];
  const [requestCategoryOpen, setRequestCategoryOpen] = useState(false);

  const intentCatalogCategories = useMemo(() => (
    configs.map((c: any) => ({
      slug: c.category,
      id: c.id,
      displayName: c.displayName,
      parentGroup: c.parentGroup,
      transactionType: c.transactionType,
      hasDateRange: c.behavior?.hasDateRange,
      requiresTimeSlot: c.behavior?.requiresTimeSlot,
      enquiryOnly: c.behavior?.enquiryOnly,
      supportsCart: c.behavior?.supportsCart,
    }))
  ), [configs]);

  const intentCatalogSubs = useMemo(() => (
    allSubs.map((s: any) => {
      const cfg = configs.find((c: any) => c.id === s.category_config_id);
      return {
        id: s.id,
        slug: s.slug,
        displayName: s.display_name,
        categoryConfigId: s.category_config_id,
        categorySlug: cfg?.category || '',
      };
    })
  ), [allSubs, configs]);

  // Collect selected subcategory display names from Step 2 to suggest in Step 4
  const selectedSubcategoryDisplayNames = useMemo(() => {
    const names: string[] = [];
    Object.entries(formData.subcategory_preferences?.data || {}).forEach(([configId, pref]: [string, any]) => {
      if (pref.primary) {
        const sub = allSubs.find((s: any) => s.id === pref.primary);
        if (sub?.display_name && !names.includes(sub.display_name)) {
          names.push(sub.display_name);
        }
      }
      (pref.others || []).forEach((id: string) => {
        const sub = allSubs.find((s: any) => s.id === id);
        if (sub?.display_name && !names.includes(sub.display_name)) {
          names.push(sub.display_name);
        }
      });
    });
    return names;
  }, [formData.subcategory_preferences, allSubs]);

  // If seller picked subcategories but no seed offering phrase is set yet, pre-fill with the first chosen subcategory
  useEffect(() => {
    if (!seedProductName?.trim() && !listingIntentPhrase?.trim() && selectedSubcategoryDisplayNames.length > 0) {
      const firstChoice = selectedSubcategoryDisplayNames[0];
      setSeedProductName(firstChoice);
      setListingIntentPhrase(firstChoice);
    }
  }, [selectedSubcategoryDisplayNames, seedProductName, listingIntentPhrase, setSeedProductName, setListingIntentPhrase]);

  const softTag = (softListingTag || null) as SoftListingTag;
  const resolvedIntent = useMemo(() => resolveListingIntent({
    phrase: listingIntentPhrase,
    commerceModel: (commerceModel as CommerceModel) || null,
    softTag,
    categories: intentCatalogCategories,
    subcategories: intentCatalogSubs,
  }), [listingIntentPhrase, commerceModel, softTag, intentCatalogCategories, intentCatalogSubs]);

  const persistCommerceChoice = useCallback(async (model: BuyerJourneyId) => {
    const ok = await applyCommerceModelChange(model);
    if (!ok) return false;
    handleSetStoreActionType(commerceModelToDefaultAction(model));
    return true;
  }, [applyCommerceModelChange, handleSetStoreActionType]);

  // Resume: keep React storeActionType synced with session/DB after async draft load
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('onboarding_store_action_type') || '';
      if (stored && stored !== storeActionType) {
        setStoreActionType(stored);
      } else if (!stored && commerceModel) {
        handleSetStoreActionType(commerceModelToDefaultAction(commerceModel as BuyerJourneyId));
      }
    } catch { /* */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSellerId, commerceModel]);

  // ─── Config sub-step state (persisted in sessionStorage) ───────────────
  const [configSubStep, setConfigSubStep] = useState<number>(() => {
    try {
      const raw = parseInt(sessionStorage.getItem('onboarding_config_substep') || '1', 10) || 1;
      return Math.max(1, Math.min(raw, 3));
    } catch { return 1; }
  });
  const handleSetConfigSubStep = useCallback((val: number) => {
    setConfigSubStep(val);
    try { sessionStorage.setItem('onboarding_config_substep', String(val)); } catch { /* */ }
  }, []);

  const [storeSetupSubStep, setStoreSetupSubStep] = useState<number>(() => {
    try {
      const raw = parseInt(sessionStorage.getItem('onboarding_store_substep') || '1', 10) || 1;
      return Math.max(1, Math.min(raw, 4));
    } catch { return 1; }
  });
  const handleSetStoreSetupSubStep = useCallback((val: number) => {
    setStoreSetupSubStep(val);
    try { sessionStorage.setItem('onboarding_store_substep', String(val)); } catch { /* */ }
  }, []);

  // Reset configure substep when entering Configure from Store, or starting a new journey (DEF-009)
  const prevStepRef = useRef(step);
  useEffect(() => {
    const prev = prevStepRef.current;
    prevStepRef.current = step;
    if (step === 6 && prev === 5) {
      handleSetConfigSubStep(1);
    }
    if (step === 5 && prev === 4) {
      handleSetStoreSetupSubStep(1);
    }
    if (step === 1) {
      handleSetConfigSubStep(1);
      handleSetStoreSetupSubStep(1);
    }
  }, [step, handleSetConfigSubStep, handleSetStoreSetupSubStep]);

  // Auto-save draft before opening native image picker (survives WebView reload)
  const beforeImagePick = useCallback(async () => {
    if (draftSellerId) {
      await app.saveDraft();
    }
  }, [draftSellerId, app]);

  const fulfillmentLabel = FULFILLMENT_OPTIONS.find(o => o.value === formData.fulfillment_mode)?.label || formData.fulfillment_mode;
  const paymentMethods = [formData.accepts_cod && 'COD', formData.accepts_upi && 'UPI'].filter(Boolean).join(', ') || 'None';
  const mandatoryLicenseRequired = onboardingLicenseMandatory(selectedGroupRow, formData.categories, configs);
  const licenseBlocksContinue = mandatoryLicenseRequired && licenseStatusBlocksOnboarding(licenseStatus);
  const mandatoryLicenseLabel =
    (selectedGroupRow as any)?.license_type_name ||
    configs.find((c: any) => formData.categories.includes(c.category) && c.license_type_name)?.license_type_name ||
    'license';

  const liveSubmittedStore = draftSellerId
    ? sellerProfiles.find((p) => p.id === draftSellerId)
    : null;
  const liveExistingStore = existingSeller?.id
    ? sellerProfiles.find((p) => p.id === existingSeller.id)
    : null;
  const liveVerificationStatus =
  (liveExistingStore as any)?.verification_status
  ?? (liveSubmittedStore as any)?.verification_status
  ?? (existingSeller as any)?.verification_status
  ?? null;

  // Don't block the first paint when parent groups are already cached from bootstrap
  if (isCheckingExisting || (groupsLoading && parentGroupInfos.length === 0)) {
    return <AppLayout showHeader={false} showNav={false}><div className="flex items-center justify-center min-h-[100dvh]"><Loader2 className="animate-spin" size={32} /></div></AppLayout>;
  }

  // ─── Submission Success Screen ──────────────────────────────────────────────
  if (submissionComplete) {
    const submittedApproved = liveSubmittedStore?.verification_status === 'approved';
    const storeLabel = liveSubmittedStore?.business_name || formData.business_name || 'your store';

    if (submittedApproved) {
      return (
        <AppLayout showHeader={false} showNav={false}>
          <div className="p-4 flex flex-col items-center justify-center min-h-[80dvh] text-center safe-top">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4 }}>
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-success/20 flex items-center justify-center">
                <CheckCircle2 className="text-success" size={40} />
              </div>
              <h1 className="text-2xl font-bold mb-2">Your store is approved!</h1>
              <p className="text-muted-foreground mb-2 max-w-xs mx-auto">
                <strong>{storeLabel}</strong> passed review.
              </p>
              <p className="text-sm text-muted-foreground mb-8 max-w-xs mx-auto">
                Recharge Sociva Credits to make your store visible to buyers nearby.
              </p>
              <div className="flex flex-col gap-3 w-full max-w-xs">
                <Link to="/seller/credits">
                  <Button size="lg" className="w-full">
                    <ArrowRight size={16} className="mr-2" />Recharge credits
                  </Button>
                </Link>
                <Link to="/seller">
                  <Button variant="outline" size="lg" className="w-full">Go to Seller Dashboard</Button>
                </Link>
              </div>
            </motion.div>
          </div>
        </AppLayout>
      );
    }

    return (
      <AppLayout showHeader={false} showNav={false}>
        <div className="p-4 flex flex-col items-center justify-center min-h-[80dvh] text-center safe-top">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4 }}>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-success/20 flex items-center justify-center">
              <CheckCircle2 className="text-success" size={40} />
            </div>
            <h1 className="text-2xl font-bold mb-2">We're reviewing your store</h1>
            <p className="text-muted-foreground mb-2 max-w-xs mx-auto">
              Thank you for submitting <strong>{formData.business_name}</strong>.
            </p>
            <p className="text-sm text-muted-foreground mb-8 max-w-xs mx-auto">
              You'll get a notification as soon as the review is complete — usually within a day. Nothing more is needed from you right now.
            </p>
            <Link to="/">
              <Button size="lg" className="w-full max-w-xs">
                <ArrowRight size={16} className="mr-2" />Go to Home
              </Button>
            </Link>
          </motion.div>
        </div>
      </AppLayout>
    );
  }

  if (existingSeller && selectedGroup) {
    const isRejected = liveVerificationStatus === 'rejected';
    const isPendingReview = liveVerificationStatus === 'pending';
    const isApproved = liveVerificationStatus === 'approved';
    const hasPendingCategoryRequest = pendingCategoryRequests.length > 0;
    const displayStoreName = liveExistingStore?.business_name || existingSeller.business_name;
    const conflictCategoryLabel = resolveStoreCategoryLabel(
      {
        primary_group: (existingSeller as any).primary_group || selectedGroup,
        categories: (existingSeller as any).categories,
      },
      configs,
    );

    if (isApproved) {
      return (
        <AppLayout showHeader={false} showNav={false}>
          <div className="p-4 safe-top max-w-md mx-auto">
            <Link to="/" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0 mb-6"><ArrowLeft size={18} /></Link>
            <div className="text-center py-4">
              <div className="text-[44px] leading-none mb-3" aria-hidden>🏪</div>
              <h1 className="text-2xl font-bold mb-2">You already have a store in this category</h1>
              <p className="text-muted-foreground mb-3">
                <strong>{displayStoreName}</strong> covers <strong>{conflictCategoryLabel}</strong>.
              </p>
              <p className="text-sm text-muted-foreground mb-5">
                Sociva allows <strong>one store per category</strong>. Manage your existing store, or choose a different category to open another business.
              </p>
            </div>
            <ExistingStoresOnboardingPanel
              stores={sellerProfiles}
              configs={configs}
              currentDraftId={draftSellerId}
              onResumeDraft={(store) => void resumeExistingStore(store.id)}
              onAddNewStore={startNewStoreOnboarding}
              onManageStore={(id) => { setCurrentSellerId(id); navigate('/seller'); }}
            />
            <div className="flex flex-col gap-3 mt-4">
              <Button className="w-full" size="lg" onClick={() => { setCurrentSellerId(existingSeller.id); navigate('/seller'); }}>
                <Store size={18} className="mr-2" />Manage {displayStoreName}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => { setSelectedGroup(null); setExistingSeller(null); setStep(1); }}>
                Choose a different category
              </Button>
            </div>
          </div>
        </AppLayout>
      );
    }

    return (
      <AppLayout showHeader={false} showNav={false}>
        <div className="p-4 safe-top">
          <Link to="/" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0 mb-6"><ArrowLeft size={18} /></Link>
          <div className="text-center py-8 max-w-md mx-auto">
            {isRejected ? (
              <>
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-destructive/20 flex items-center justify-center"><Store className="text-destructive" size={32} /></div>
                <h1 className="text-2xl font-bold mb-2">Application Not Approved</h1>
                <p className="text-muted-foreground mb-2">Your seller application for <strong>{existingSeller.business_name}</strong> was not approved.</p>
                {(existingSeller as any).rejection_note && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 mb-4 text-left">
                    <p className="text-xs font-semibold text-destructive mb-1">Admin Feedback:</p>
                    <p className="text-sm text-foreground">{(existingSeller as any).rejection_note}</p>
                  </div>
                )}
                <p className="text-sm text-muted-foreground mb-6">You can update your details and resubmit your application.</p>
                <div className="space-y-3">
                  <Button className="w-full" size="lg" onClick={async () => {
                    // Save the rejection note so it persists in the edit form
                    const note = (existingSeller as any).rejection_note || null;
                    setRejectionFeedback(note);
                    // Load existing data into form before navigating to edit
                    const { data: fullSeller } = await supabase.from('seller_profiles').select('*').eq('id', (existingSeller as any).id).single();
                    if (fullSeller) {
                      loadSellerDataIntoForm(fullSeller);
                      await reloadProducts(fullSeller.id);
                    }
                    setExistingSeller(null);
                    setDraftSellerId((existingSeller as any).id);
                    // Jump to store details (step 5) so rejection edits keep loaded name/products
                    // instead of restarting at category and risking an empty-form draft overwrite.
                    setStep(5);
                  }}>Update & Resubmit</Button>
                  <Button variant="outline" className="w-full" onClick={() => { setSelectedGroup(null); setExistingSeller(null); setStep(1); }}>Choose Different Category</Button>
                </div>
              </>
            ) : isPendingReview ? (
              <>
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-warning/20 flex items-center justify-center"><Clock className="text-warning" size={32} /></div>
                <h1 className="text-2xl font-bold mb-2">We're reviewing your store</h1>
                <p className="text-muted-foreground mb-2">Thank you for submitting <strong>{existingSeller.business_name}</strong>.</p>
                <p className="text-sm text-muted-foreground mb-6">You'll get a notification as soon as the review is complete — usually within a day. Nothing more is needed from you right now.</p>
                <div className="space-y-3">
                  <Link to="/"><Button className="w-full" size="lg"><ArrowRight size={16} className="mr-2" />Go to Home</Button></Link>
                  <Button variant="outline" className="w-full" onClick={() => { setSelectedGroup(null); setExistingSeller(null); setStep(1); }}>Register Another Category</Button>
                </div>
              </>
            ) : (
              <>
                <div className="text-[44px] leading-none mb-3" aria-hidden>{hasPendingCategoryRequest ? '🎈👏' : '🎈'}</div>
                {hasPendingCategoryRequest ? (
                  <>
                    <h1 className="text-2xl font-bold mb-2">Store setup complete</h1>
                    <p className="text-muted-foreground mb-2">
                      Your store <strong>{existingSeller.business_name}</strong> is ready to manage.
                    </p>
                    <p className="text-sm text-muted-foreground mb-5">
                      {pendingCategoryNames.length === 1
                        ? <>The category you requested, <strong>&ldquo;{pendingCategoryNames[0]}&rdquo;</strong>, is still under review, so it is not live yet.</>
                        : <>The categories you requested are still under review, so they are not live yet.</>}
                      {' '}We&apos;ll notify you when {pendingCategoryNames.length === 1 ? "it's" : "they're"} approved — usually within 24 hours.
                    </p>
                  </>
                ) : (
                  <>
                    <h1 className="text-2xl font-bold mb-2">Store is live</h1>
                    <p className="text-muted-foreground mb-5">
                      Your store <strong>{existingSeller.business_name}</strong> is ready. Go to your seller dashboard to manage it.
                    </p>
                  </>
                )}
                <div className="text-left mb-5">
                  <PendingCategoryRequestsBanner />
                </div>
                <div className="flex flex-col gap-4 w-full">
                  <Link to="/seller" className="block w-full">
                    <Button className="w-full" size="lg"><Store size={18} className="mr-2" />Go to Seller Dashboard</Button>
                  </Link>
                  <Link to="/seller/category-requests" className="block w-full">
                    <Button variant="outline" className="w-full" size="lg">My Category Requests</Button>
                  </Link>
                  <Button variant="ghost" className="w-full mt-1" onClick={() => { setSelectedGroup(null); setExistingSeller(null); setStep(1); }}>Register Another Category</Button>
                </div>
              </>
            )}
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showHeader={false} showNav={false}>
      <div className="p-4 pb-24">
        {/* Top Bar */}
        <div className="flex items-center justify-between mb-6">
          <Link to="/" className="flex items-center gap-2 text-muted-foreground"><span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0"><ArrowLeft size={18} /></span><span>Back</span></Link>
          {step >= 2 && <Button variant="ghost" size="sm" onClick={handleSaveDraftAndExit} disabled={isLoading}><Save size={14} className="mr-1" />Save Draft</Button>}
        </div>

        {/* Step Header */}
        <div className="text-center mb-4">
          <h1 className="text-2xl font-bold">
            {step === 5 ? STORE_SETUP_SUB_STEPS[storeSetupSubStep - 1].title : step === 6 ? CONFIG_SUB_STEPS[configSubStep - 1].title : STEP_META[step - 1].title}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {step === 5 ? STORE_SETUP_SUB_STEPS[storeSetupSubStep - 1].helper : step === 6 ? CONFIG_SUB_STEPS[configSubStep - 1].helper : STEP_META[step - 1].helper}
          </p>
        </div>

        {/* Progress Stepper */}
        <div className="flex items-center justify-between mb-6 px-1 overflow-x-auto scrollbar-hide gap-1">
          {STEP_META.map((meta, i) => {
            const stepNum = i + 1; const Icon = meta.icon;
            const isCompleted = step > stepNum; const isActive = step === stepNum;
            return (
              <div key={meta.label} className="flex flex-col items-center gap-1 min-w-[3rem] flex-1">
                <div className="p-0.5">
                  <div className={cn('w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-all text-xs', isCompleted && 'bg-primary text-primary-foreground', isActive && 'bg-primary/20 text-primary ring-2 ring-primary', !isCompleted && !isActive && 'bg-muted text-muted-foreground')}>
                    {isCompleted ? <CheckCircle2 size={14} /> : <Icon size={12} />}
                  </div>
                </div>
                <span className={cn('text-[9px] sm:text-[10px] font-medium text-center leading-tight truncate w-full', isActive ? 'text-primary' : 'text-muted-foreground')}>{meta.label}</span>
              </div>
            );
          })}
        </div>

        {/* Context Breadcrumb */}
        {step >= 5 && selectedGroupInfo && (
          <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-lg bg-muted/60 text-xs">
            <div className={cn('w-6 h-6 rounded flex items-center justify-center', selectedGroupInfo.color)}><DynamicIcon name={selectedGroupInfo.icon} size={14} /></div>
            <span className="font-medium">{selectedGroupInfo.label}</span>
            {formData.categories.length > 0 && (
              <><ChevronRight size={12} className="text-muted-foreground" /><span className="text-muted-foreground truncate">{formData.categories.map(cat => { const config = configs.find(c => c.category === cat); return config?.displayName || cat; }).join(', ')}</span></>
            )}
            {formData.business_name.trim() && step >= 6 && <><span className="text-muted-foreground">|</span><span className="font-medium truncate">"{formData.business_name}"</span></>}
          </div>
        )}

        {/* Step 1: Store type (parent group) */}
        {step === 1 && (
          <>
            <ExistingStoresOnboardingPanel
              stores={sellerProfiles}
              configs={configs}
              currentDraftId={draftSellerId}
              onResumeDraft={(store) => void resumeExistingStore(store.id)}
              onAddNewStore={startNewStoreOnboarding}
              onManageStore={(id) => { setCurrentSellerId(id); navigate('/seller'); }}
            />
            <PendingCategoryRequestsBanner variant="inline" />
            <ParentGroupPickerStep
              groups={parentGroupInfos}
              selectedGroup={selectedGroup}
              isLoading={groupsLoading}
              onSelect={(group) => { void handleGroupSelect(group); }}
            />
          </>
        )}

        {/* Step 2: Category + subcategory */}
        {step === 2 && selectedGroup && (
          <div className="space-y-4">
            <PendingCategoryRequestsBanner variant="inline" />
            <GuidedStep2
              selectedGroup={selectedGroup}
              selectedGroupInfo={selectedGroupInfo}
              formData={formData}
              setFormData={setFormData}
              groupedConfigs={groupedConfigs}
              handleCategoryChange={handleCategoryChange}
              onBack={() => { void handleBackToGroupPicker(); }}
              onContinue={async () => {
                if (formData.categories.length === 0) {
                  notify.block('Select at least one category to continue');
                  return;
                }
                // Auto-infer commerce model from selected categories if not already chosen
                if (!commerceModel) {
                  const firstCat = formData.categories[0];
                  const cfg = configs.find((c: any) => c.category === firstCat);
                  const fromAction = cfg?.default_action_type
                    ? commerceModelFromActionType(cfg.default_action_type)
                    : null;
                  if (fromAction) {
                    await persistCommerceChoice(fromAction);
                  }
                }
                await app.saveDraft({ silent: true });
                setStep(3);
              }}
              onSkip={() => setStep(3)}
            />
            <Button variant="outline" className="w-full" onClick={() => setRequestCategoryOpen(true)}>
              Can&apos;t find your category? Request one
            </Button>
            <RequestCategoryDialog
              open={requestCategoryOpen}
              onOpenChange={setRequestCategoryOpen}
              initialName={seedProductName || listingIntentPhrase || ''}
              parentGroupInfos={parentGroupInfos}
              sellerId={draftSellerId}
              onboardingMode
              onSubmitted={(groupSlug) => {
                if (groupSlug && !selectedGroup) setSelectedGroup(groupSlug);
                setRequestCategoryOpen(false);
              }}
            />
          </div>
        )}

        {/* Step 3: Commerce model */}
        {step === 3 && (
          <CommerceModelStep
            value={(commerceModel as BuyerJourneyId) || null}
            softTag={softTag}
            onChange={(model) => { void persistCommerceChoice(model); }}
            onSoftTagChange={(tag) => {
              setSoftListingTag(tag || '');
              const inferred = softTagToCommerceModel(tag);
              if (inferred && !commerceModel) persistCommerceChoice(inferred);
              else if (inferred && tag) persistCommerceChoice(inferred);
            }}
            onBack={() => handleStepBack(2)}
            onContinue={async () => {
              if (!commerceModel) {
                const firstCat = formData.categories[0];
                const cfg = configs.find((c: any) => c.category === firstCat);
                const fromAction = cfg?.default_action_type
                  ? commerceModelFromActionType(cfg.default_action_type)
                  : null;
                if (fromAction) await persistCommerceChoice(fromAction);
                else if (resolvedIntent.commerceModel) await persistCommerceChoice(resolvedIntent.commerceModel);
              }
              await app.saveDraft({ silent: true });
              setStep(4);
            }}
          />
        )}

        {/* Step 4: Product offering name */}
        {step === 4 && (
          <ProductOfferingStep
            value={seedProductName || listingIntentPhrase}
            categoryLabel={formData.categories.map((cat) => {
              const config = configs.find((c: any) => c.category === cat);
              return config?.displayName || cat;
            }).join(', ')}
            selectedSubcategoryNames={selectedSubcategoryDisplayNames}
            onChange={(name) => {
              const trimmed = name.trim();
              const titled = trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : '';
              setSeedProductName(titled);
              setListingIntentPhrase(titled);
            }}
            onSelectSuggestion={(name) => {
              const titled = name.charAt(0).toUpperCase() + name.slice(1);
              setSeedProductName(titled);
              setListingIntentPhrase(titled);
            }}
            onBack={() => handleStepBack(3)}
            onContinue={async () => {
              const name = (seedProductName || listingIntentPhrase).trim();
              if (name.length < 2) {
                notify.block('Enter what you are selling (at least 2 characters)');
                return;
              }
              const titled = name.charAt(0).toUpperCase() + name.slice(1);
              setSeedProductName(titled);
              setListingIntentPhrase(titled);
              await app.saveDraft({ silent: true });
              setStep(5);
            }}
          />
        )}

        {/* Step 5: Location → Fulfilment → Radius → Store information */}
        {step === 5 && (
          <div className="space-y-5">
            <button onClick={() => {
              if (storeSetupSubStep > 1) {
                handleSetStoreSetupSubStep(storeSetupSubStep - 1);
              } else {
                handleStepBack(4);
              }
            }} className="flex items-center gap-1 text-sm text-muted-foreground">
              <ArrowLeft size={16} />{storeSetupSubStep > 1 ? 'Back' : 'Change offering'}
            </button>
            {rejectionFeedback && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-left">
                <p className="text-xs font-semibold text-destructive mb-1">⚠️ Admin Feedback — Please address before resubmitting:</p>
                <p className="text-sm text-foreground">{rejectionFeedback}</p>
              </div>
            )}
            <SubStepDots current={storeSetupSubStep} total={4} />

            {storeSetupSubStep === 1 && (
              <div className="space-y-5">
                <StoreLocationPicker
                  latitude={formData.latitude}
                  longitude={formData.longitude}
                  label={formData.store_location_label}
                  onLocationSet={async (lat, lng, _name, formattedAddress) => {
                    setFormData({
                      ...formData,
                      latitude: lat,
                      longitude: lng,
                      store_location_label: formattedAddress || _name || formData.store_location_label || null,
                    });
                    // Last-resort only: primary society comes from Auth signup.
                    if (!profile?.society_id && user && draftSellerId) {
                      try {
                        const result = await ensureSellerSocietyForSubmit({
                          userId: user.id,
                          sellerId: draftSellerId,
                          profileSocietyId: profile?.society_id,
                          sellerSocietyId: null,
                          latitude: lat,
                          longitude: lng,
                        });
                        if (result.linked) {
                          await refreshProfile();
                        }
                      } catch (e) {
                        console.warn('Society auto-link skipped:', e);
                      }
                    }
                  }}
                  hasSociety={!!profile?.society_id}
                  societyHasCoords={societyHasCoords}
                  societyLocation={societyLoc}
                  deliveryLocations={
                    (deliveryAddresses || [])
                      .filter((a: any) => a.latitude && a.longitude)
                      .map((a: any) => ({
                        id: a.id,
                        label: a.label || 'Home',
                        latitude: a.latitude,
                        longitude: a.longitude,
                        building_name: a.building_name || a.full_address || null,
                      }))
                  }
                  existingStoreLocations={
                    (sellerProfiles || [])
                      .filter((sp: any) => sp.latitude && sp.longitude && sp.id !== draftSellerId)
                      .map((sp: any) => ({
                        id: sp.id,
                        business_name: sp.business_name || 'Store',
                        latitude: sp.latitude,
                        longitude: sp.longitude,
                        store_location_label: sp.store_location_label || null,
                      }))
                  }
                />
                <Button className="w-full" onClick={() => {
                  if (!formData.latitude || !formData.longitude) {
                    notify.block(
                      societyHasCoords === false
                        ? 'Your society has no location set. Please set your store location on this page before continuing.'
                        : 'Please set your selling location before continuing.',
                    );
                    return;
                  }
                  handleSetStoreSetupSubStep(2);
                }}>
                  Continue<ChevronRight size={16} className="ml-1" />
                </Button>
              </div>
            )}

            {storeSetupSubStep === 2 && (
              <div className="space-y-5">
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2"><Truck size={16} className="text-primary" /><h3 className="font-semibold text-sm">How will customers receive their orders?</h3></div>
                  <RadioGroup value={formData.fulfillment_mode} onValueChange={(value) => setFormData({ ...formData, fulfillment_mode: value })} className="space-y-2">
                    {FULFILLMENT_OPTIONS.filter((option) => !option.disabled || ['self_pickup', 'seller_delivery', 'pickup_and_seller_delivery'].includes(option.value)).map((option) => (
                      <label key={option.value} className={cn('flex items-center gap-3 p-3 rounded-lg border transition-all', option.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer', !option.disabled && formData.fulfillment_mode === option.value ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30')}>
                        <RadioGroupItem value={option.value} disabled={option.disabled} /><div className="flex-1"><span className="text-sm font-medium">{option.label}</span><p className="text-xs text-muted-foreground">{option.description}</p></div>
                      </label>
                    ))}
                  </RadioGroup>
                  {isSellerDeliveryMode(formData.fulfillment_mode) && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1">
                      <p className="text-sm font-medium text-foreground">Delivery is free for customers</p>
                      <p className="text-xs text-muted-foreground">{FREE_DELIVERY_NOTICE}</p>
                    </div>
                  )}
                  {isSellerDeliveryMode(formData.fulfillment_mode) && (
                    <div className="space-y-2 pt-2 border-t">
                      <Label htmlFor="delivery_note" className="text-xs text-muted-foreground">Delivery Note (optional)</Label>
                      <Input id="delivery_note" placeholder="e.g., Delivery available after 5 PM only" value={formData.delivery_note} onChange={(e) => setFormData({ ...formData, delivery_note: e.target.value })} />
                    </div>
                  )}
                </div>
                <Button className="w-full" onClick={() => handleSetStoreSetupSubStep(3)}>
                  Continue<ChevronRight size={16} className="ml-1" />
                </Button>
              </div>
            )}

            {storeSetupSubStep === 3 && (
              <div className="space-y-5">
                <div className="border rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Set your selling radius</Label>
                    <span className="text-sm font-semibold text-primary">{formData.delivery_radius_km} km</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{SELLING_RADIUS_HELPER}</p>
                  <Slider
                    value={[formData.delivery_radius_km]}
                    onValueChange={([v]) => setFormData({ ...formData, delivery_radius_km: v, sell_beyond_community: v > 0 })}
                    min={1}
                    max={10}
                    step={1}
                  />
                  <div className="rounded-lg bg-muted p-3 space-y-1">
                    <p className="text-sm font-medium">Your products can be discovered up to {formData.delivery_radius_km} km away.</p>
                    {isSellerDeliveryMode(formData.fulfillment_mode) && (
                      <p className="text-xs text-muted-foreground">You will be responsible for delivering orders within this area.</p>
                    )}
                    {!isSellerDeliveryMode(formData.fulfillment_mode) && (
                      <p className="text-xs text-muted-foreground">{sellingRadiusCopy(formData.delivery_radius_km, formData.fulfillment_mode)}</p>
                    )}
                  </div>
                </div>
                <Button className="w-full" onClick={() => handleSetStoreSetupSubStep(4)}>
                  Continue<ChevronRight size={16} className="ml-1" />
                </Button>
              </div>
            )}

            {storeSetupSubStep === 4 && (
              <div className="space-y-5">
                {sellerProfiles.filter((s: any) => s.verification_status === 'draft' && s.id !== draftSellerId).length > 0 && (
                  <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Continue an existing draft</p>
                    {sellerProfiles.filter((s: any) => s.verification_status === 'draft' && s.id !== draftSellerId).map((store: any) => (
                      <button
                        key={store.id}
                        type="button"
                        onClick={() => void resumeExistingStore(store.id)}
                        className="w-full flex items-center justify-between p-2.5 rounded-lg border border-border bg-card hover:bg-accent/5 text-left"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{store.business_name || 'Untitled draft'}</p>
                          <p className="text-[11px] text-muted-foreground">{resolveStoreCategoryLabel(store, configs)}</p>
                        </div>
                        <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="business_name">Business / Store Name *</Label>
                  <Input id="business_name" placeholder={groups.find(g => g.slug === selectedGroup)?.placeholder_hint || "e.g., Your Store Name"} value={formData.business_name} onChange={(e) => setFormData({ ...formData, business_name: e.target.value })} />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    This is your shop title — buyers see it on your store page, products, orders, and invoices.
                    The previous “you'll appear as” label is only your specialty (for example, Home Meal Provider), not this store name.
                  </p>
                </div>
                <div className="space-y-2"><Label htmlFor="description">Description</Label><Textarea id="description" placeholder="Tell customers about what you offer..." value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={3} /></div>
                <div className="space-y-2"><Label>Availability Hours</Label><div className="grid grid-cols-2 gap-3"><div><Label htmlFor="start" className="text-xs text-muted-foreground">Opens at</Label><Input id="start" type="time" value={formData.availability_start} onChange={(e) => setFormData({ ...formData, availability_start: e.target.value })} /></div><div><Label htmlFor="end" className="text-xs text-muted-foreground">Closes at</Label><Input id="end" type="time" value={formData.availability_end} onChange={(e) => setFormData({ ...formData, availability_end: e.target.value })} /></div></div></div>
                {mandatoryLicenseRequired && (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
                    <p className="font-semibold">Required: {mandatoryLicenseLabel}</p>
                    <p className="text-muted-foreground mt-1">{LICENSE_ONBOARDING_HINT}</p>
                  </div>
                )}
                {selectedGroupRow?.id && (selectedGroupRow as any).requires_license && (
                  <GroupLicensePrompt
                    groupId={selectedGroupRow.id}
                    groupName={selectedGroupInfo?.label || 'Your store'}
                    licenseTypeName={(selectedGroupRow as any).license_type_name}
                    licenseMandatory={!!(selectedGroupRow as any).license_mandatory}
                    draftSellerId={draftSellerId}
                    isOnboarding
                    onStatusChange={setLicenseStatus}
                  />
                )}
                {(() => {
                  const selectedCatConfigs = configs.filter(c => formData.categories.includes(c.category));
                  return selectedCatConfigs.map(catCfg => {
                    return <CategoryLicensePrompt key={catCfg.id} categoryConfigId={catCfg.id} categoryName={catCfg.displayName} draftSellerId={draftSellerId} isOnboarding={true} onStatusChange={setLicenseStatus} />;
                  });
                })()}
                <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1"><ArrowRight size={12} />Next: Payments, schedule, and store images</p>
                <Button className="w-full" onClick={() => {
                  if (!selectedGroup || formData.categories.length === 0) {
                    notify.block('Please confirm a category before continuing');
                    handleStepBack(2);
                    return;
                  }
                  if (!storeActionType && commerceModel) {
                    handleSetStoreActionType(commerceModelToDefaultAction(commerceModel as BuyerJourneyId));
                  }
                  handleSetConfigSubStep(1);
                  handleProceedToSettings();
                }} disabled={isLoading || !formData.business_name.trim() || licenseBlocksContinue}>{isLoading && <Loader2 className="animate-spin mr-2" size={18} />}Continue<ChevronRight size={16} className="ml-1" /></Button>
              </div>
            )}
          </div>
        )}

        {/* Step 6: Configure (payments → schedule → images) */}
        {step === 6 && (
          <div className="space-y-5">
            <button onClick={() => {
              if (configSubStep > 1) {
                handleSetConfigSubStep(configSubStep - 1);
              } else {
                handleStepBack(5);
              }
            }} className="flex items-center gap-1 text-sm text-muted-foreground">
              <ArrowLeft size={16} />{configSubStep > 1 ? 'Back' : 'Edit store details'}
            </button>

            <SubStepDots current={configSubStep} total={3} />

            <AnimatePresence mode="wait">
              {configSubStep === 1 && (
                <motion.div
                  key="payments"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-5"
                >
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2"><Banknote size={16} className="text-primary" /><h3 className="font-semibold text-sm">Payment Methods</h3></div>
                    <p className="text-xs text-muted-foreground">Customer payments go directly to you. Sociva Credits are a separate prepaid balance for platform usage such as orders, enquiries, bookings, and contact requests.</p>
                    <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer"><div className="flex items-center gap-3"><Banknote size={18} className="text-muted-foreground" /><div><span className="text-sm font-medium">Cash on Delivery</span><p className="text-xs text-muted-foreground">Accept cash payments</p></div></div><Switch checked={formData.accepts_cod} onCheckedChange={(checked) => setFormData({ ...formData, accepts_cod: checked })} /></label>
                    <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer"><div className="flex items-center gap-3"><Smartphone size={18} className="text-muted-foreground" /><div><span className="text-sm font-medium">UPI Payment</span><p className="text-xs text-muted-foreground">Accept UPI / digital payments</p></div></div><Switch checked={formData.accepts_upi} onCheckedChange={(checked) => setFormData({
                      ...formData,
                      accepts_upi: checked,
                      pickup_payment_config: { ...formData.pickup_payment_config, accepts_online: checked },
                      delivery_payment_config: { ...formData.delivery_payment_config, accepts_online: checked },
                    })} /></label>
                    {formData.accepts_upi && <div className="space-y-2 pt-2 border-t"><Label htmlFor="upi_id" className="text-xs text-muted-foreground">UPI ID <span className="text-destructive">*</span></Label><UpiVpaInput value={formData.upi_id} onChange={(v) => setFormData({ ...formData, upi_id: v, upi_validation_status: undefined } as any)} businessName={formData.business_name} placeholder="e.g., yourname@upi" onStatusChange={(status, name) => setFormData({ ...formData, upi_validation_status: status, upi_holder_name: name } as any)} />{formData.accepts_upi && !formData.upi_id.trim() && <p className="text-xs text-destructive">Required when UPI is enabled</p>}</div>}
                  </div>
                  <Button className="w-full" onClick={() => handleSetConfigSubStep(2)} disabled={formData.accepts_upi && !formData.upi_id.trim()}>
                    Continue<ChevronRight size={16} className="ml-1" />
                  </Button>
                </motion.div>
              )}

              {configSubStep === 2 && (
                <motion.div
                  key="schedule"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-5"
                >
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2"><Clock size={16} className="text-primary" /><h3 className="font-semibold text-sm">Operating Days</h3></div>
                    <p className="text-xs text-muted-foreground">Select the days your store is open</p>
                    <div className="flex gap-1.5 flex-wrap">{DAYS_OF_WEEK.map((day) => <button key={day} type="button" onClick={() => toggleOperatingDay(day)} className={cn('px-3 py-2 rounded-lg text-xs font-medium transition-all border', formData.operating_days.includes(day) ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border hover:border-muted-foreground/30')}>{day}</button>)}</div>
                    <button
                      type="button"
                      onClick={() => {
                        const allSelected = formData.operating_days.length === DAYS_OF_WEEK.length;
                        setFormData({
                          ...formData,
                          operating_days: allSelected ? [] : [...DAYS_OF_WEEK],
                        });
                      }}
                      className="text-[10px] font-medium text-primary hover:underline"
                    >
                      {formData.operating_days.length === 7
                        ? 'Open every day · tap to clear'
                        : formData.operating_days.length === 0
                          ? 'No days selected · tap to open every day'
                          : `Open ${formData.operating_days.length} day(s) a week · tap for every day`}
                    </button>
                  </div>
                  {(() => {
                    const effectiveAction = storeActionType || (configs.find((c: any) => c.category === formData.categories[0]) as any)?.default_action_type || '';
                    const actionConfig = allActions.find(a => a.action_type === effectiveAction);
                    return actionConfig?.requires_availability && draftSellerId;
                  })() && (
                    <ServiceAvailabilityManager sellerId={draftSellerId!} onComplete={() => {}} />
                  )}
                  <Button className="w-full" onClick={() => handleSetConfigSubStep(3)} disabled={formData.operating_days.length === 0}>
                    Continue<ChevronRight size={16} className="ml-1" />
                  </Button>
                </motion.div>
              )}

              {configSubStep === 3 && (
                <motion.div
                  key="images"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-5"
                >
                  <div className="border rounded-lg p-4 space-y-3">
                    <p className="text-xs text-muted-foreground">Add a profile photo and cover image to make your store stand out</p>
                    {user && <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Profile Photo</Label><CroppableImageUpload value={formData.profile_image_url} onChange={(url) => setFormData({ ...formData, profile_image_url: url })} folder="sellers" userId={user.id} aspectRatio="square" placeholder="Profile" cropAspect={1} beforePick={beforeImagePick} /></div><div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Cover Image</Label><CroppableImageUpload value={formData.cover_image_url} onChange={(url) => setFormData({ ...formData, cover_image_url: url })} folder="sellers" userId={user.id} aspectRatio="video" placeholder="Cover" cropAspect={16 / 9} beforePick={beforeImagePick} /></div></div>}
                  </div>
                  <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1"><ArrowRight size={12} />Next: Add at least one product or service to your catalog</p>
                  <Button data-continue-products className="w-full" onClick={() => { handleSetConfigSubStep(1); handleProceedToProducts(storeActionType || undefined); }} disabled={isLoading}>
                    {isLoading && <Loader2 className="animate-spin mr-2" size={18} />}Continue to Add Products<ChevronRight size={16} className="ml-1" />
                  </Button>
                  <button
                    onClick={() => { handleSetConfigSubStep(1); handleProceedToProducts(storeActionType || undefined); }}
                    className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
                  >
                    Skip for now
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Step 7: Add Products */}
        {step === 7 && !draftSellerId && (
          <div className="space-y-5 text-center py-8">
            <div className="w-16 h-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center"><Package size={24} className="text-destructive" /></div>
            <h3 className="text-lg font-semibold">Unable to load your store</h3>
            <p className="text-sm text-muted-foreground">Your store draft could not be found. Please go back and try again.</p>
            <Button variant="outline" onClick={() => setStep(5)}><ArrowLeft size={16} className="mr-1" />Go Back</Button>
          </div>
        )}
        {step === 7 && draftSellerId && (
          <div className="space-y-5">
            <button onClick={() => handleStepBack(6)} className="flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft size={16} />Edit store settings</button>
            <DraftProductManager
              sellerId={draftSellerId}
              categories={formData.categories}
              products={draftProducts}
              onProductsChange={setDraftProducts}
              beforePick={beforeImagePick}
              defaultActionType={storeActionType || undefined}
              seedProductName={seedProductName || undefined}
              seedSubcategoryId={(() => {
                const cat = formData.categories[0];
                if (!cat) return null;
                const cfg = configs.find((c: any) => c.category === cat);
                if (!cfg) return null;
                return formData.subcategory_preferences.data[cfg.id]?.primary || null;
              })()}
            />
            <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1"><ArrowRight size={12} />Next: Review everything and submit for approval</p>
            <Button className="w-full" onClick={async () => {
              if (draftSellerId) await reloadProducts(draftSellerId);
              setStep(8);
            }} disabled={draftProducts.length === 0}>Review & Submit<ChevronRight size={16} className="ml-1" /></Button>
          </div>
        )}

        {/* Step 8: Review & Submit */}
        {step === 8 && (() => {
          const validationErrors: { key: string; message: string; step: number }[] = [];
          if (draftProducts.length === 0) validationErrors.push({ key: 'products', message: 'Add at least one product before submitting', step: 7 });
          if (formData.operating_days.length === 0) validationErrors.push({ key: 'days', message: 'Select at least one operating day', step: 6 });
          if (formData.accepts_upi && !formData.upi_id?.trim()) validationErrors.push({ key: 'upi', message: 'Enter your UPI ID or disable UPI payments', step: 6 });
          if (!formData.latitude || !formData.longitude) validationErrors.push({ key: 'location', message: 'Set your store location', step: 5 });
          if (formData.categories.length === 0) validationErrors.push({ key: 'categories', message: 'Select at least one category', step: 2 });
          if (!profile?.society_id && !formData.latitude) {
            validationErrors.push({
              key: 'society',
              message: 'Link your account to a society (Profile) or set a store pin near a registered society',
              step: 5,
            });
          }
          if (licenseBlocksContinue) {
            validationErrors.push({
              key: 'license',
              message: licenseStatus === 'rejected'
                ? `Your ${mandatoryLicenseLabel} was rejected. Please upload a valid document.`
                : `Please upload your ${mandatoryLicenseLabel} before submitting.`,
              step: 5,
            });
          }
          return (
          <div className="space-y-5">
            <button onClick={() => handleStepBack(7)} className="flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft size={16} />Edit products</button>

            {validationErrors.length > 0 && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 space-y-3">
                <h4 className="font-semibold text-destructive text-sm flex items-center gap-2"><X size={16} />Please fix the following before submitting</h4>
                {validationErrors.map((err) => (
                  <div key={err.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-destructive">{err.message}</span>
                    <Button variant="outline" size="sm" className="shrink-0 text-xs h-7 border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => handleStepBack(err.step)}>Fix this</Button>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-muted rounded-lg p-4 space-y-3">
              <h4 className="font-semibold">Application Summary</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Business</span><span className="font-medium">{formData.business_name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span className="font-medium">{selectedGroupInfo?.label}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Products</span><span className="font-medium">{draftProducts.length} item(s)</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Hours</span><span className="font-medium">{formData.availability_start} – {formData.availability_end}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground shrink-0">Location</span><span className="font-medium text-right">{formatStoreLocationLabel(formData.store_location_label) || (formData.latitude ? 'Location selected' : '⚠️ Not set')}</span></div>
                <div className="border-t pt-2 mt-2 space-y-2">
                  <div className="flex justify-between"><span className="text-muted-foreground">Fulfillment</span><span className="font-medium">{fulfillmentLabel}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Payments</span><span className="font-medium">{paymentMethods}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Operating Days</span><span className="font-medium">{formData.operating_days.length === 7 ? 'Every day' : `${formData.operating_days.length} day(s)`}</span></div>
                  {(formData.profile_image_url || formData.cover_image_url) && <div className="flex justify-between"><span className="text-muted-foreground">Store Images</span><span className="font-medium">{[formData.profile_image_url && 'Profile', formData.cover_image_url && 'Cover'].filter(Boolean).join(' + ')}</span></div>}
                </div>
                <div className="border-t pt-2 mt-2 space-y-2">
                  <div className="flex justify-between"><span className="text-muted-foreground">Selling radius</span><span className="font-medium">{formData.delivery_radius_km} km</span></div>
                  {isSellerDeliveryMode(formData.fulfillment_mode) && (
                    <p className="text-xs text-muted-foreground">Delivery is free for customers. You deliver within {formData.delivery_radius_km} km.</p>
                  )}
                </div>
              </div>
            </div>
            {draftSellerId && mandatoryLicenseRequired && licenseStatus && (
              <div className={cn('rounded-lg p-3 text-sm flex items-center gap-2', licenseStatus === 'approved' ? 'bg-success/10 text-success' : licenseStatus === 'pending' ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive')}>
                <Shield size={16} className="flex-shrink-0" /><span>{mandatoryLicenseLabel}: {licenseStatus === 'approved' ? 'Verified ✓' : licenseStatus === 'pending' ? 'Uploaded — will be reviewed with your store' : licenseStatus === 'rejected' ? 'Rejected — please upload again' : 'Not uploaded yet'}</span>
              </div>
            )}
            <div className="bg-muted rounded-lg p-4 text-sm"><h4 className="font-semibold mb-2">What happens next?</h4><ul className="space-y-1 text-muted-foreground"><li>• Your store is submitted for review</li><li>• You'll get an in-app and push notification when the review finishes</li><li>• After approval, recharge Sociva Credits to start selling</li></ul></div>
            <div className="border rounded-lg p-4 space-y-3">
              <h4 className="font-semibold text-sm flex items-center gap-2"><Shield size={16} className="text-primary" />Seller Declaration</h4>
              <div className="text-xs text-muted-foreground space-y-1"><p>By submitting this application, I declare that:</p><ul className="space-y-0.5 ml-3"><li>• I hold all necessary licenses and registrations</li><li>• I am solely responsible for product/service quality and safety</li><li>• I will comply with all applicable laws and regulations</li><li>• I will handle customer complaints professionally</li><li>• I understand that violations may lead to account suspension</li></ul></div>
              <label className="flex items-start gap-3 cursor-pointer"><Checkbox checked={acceptedDeclaration} onCheckedChange={(checked) => setAcceptedDeclaration(checked as boolean)} className="mt-0.5" /><span className="text-sm font-medium">I agree to the seller declaration and community guidelines</span></label>
            </div>
            <Button className="w-full" size="lg" onClick={handleSubmit} disabled={isLoading || !acceptedDeclaration || validationErrors.length > 0}>{isLoading ? <Loader2 className="animate-spin mr-2" size={18} /> : <Send size={18} className="mr-2" />}Submit Application</Button>
          </div>
          );
        })()}
      </div>
    </AppLayout>
  );
}
