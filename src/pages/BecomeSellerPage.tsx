// @ts-nocheck
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
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
import { ArrowLeft, Store, Loader2, ChevronRight, Settings, Shield, Save, Send, LayoutGrid, Tags, FileText, Package, CheckCircle2, ArrowRight, Truck, Smartphone, Banknote, Clock, ImageIcon, MapPin, Navigation, CheckCircle, Star, X, Search, ShoppingCart, Calendar, MessageCircle, Phone } from 'lucide-react';
import { useActionTypeMap, useCategoryAllowedActions } from '@/hooks/useActionTypeMap';
import { OnboardingLocationSheet } from '@/components/seller/OnboardingLocationSheet';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useSellerApplication } from '@/hooks/useSellerApplication';
import type { SellerFormData } from '@/hooks/useSellerApplication';
import { useSubcategories } from '@/hooks/useSubcategories';
import { SubcategoryPickerDialog, SubcategorySelection } from '@/components/seller/SubcategoryPickerDialog';
import { CategorySearchPicker } from '@/components/seller/CategorySearchPicker';
import { PendingCategoryRequestsBanner, useOpenCategoryRequests } from '@/components/seller/PendingCategoryRequestsBanner';
import { ListingIntentStep } from '@/components/seller/ListingIntentStep';
import { CommerceModelStep } from '@/components/seller/CommerceModelStep';
import { TaxonomySuggestCard } from '@/components/seller/TaxonomySuggestCard';
import { RequestCategoryDialog } from '@/components/seller/RequestCategoryDialog';
import { UpiVpaInput } from '@/components/payment/UpiVpaInput';
import {
  resolveListingIntent,
  commerceModelToDefaultAction,
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
  SELLING_RADIUS_HELPER,
  formatStoreLocationLabel,
  isSellerDeliveryMode,
  sellingRadiusCopy,
} from '@/lib/seller-onboarding-copy';
// ─── Store Location Picker ──────────────────────────────────────────────────
function StoreLocationPicker({ latitude, longitude, label, onLocationSet, hasSociety, existingStoreLocations = [] }: {
  latitude: number | null;
  longitude: number | null;
  label?: string | null;
  onLocationSet: (lat: number, lng: number, name?: string, formattedAddress?: string) => void;
  hasSociety: boolean;
  existingStoreLocations?: { id: string; business_name: string; latitude: number; longitude: number; store_location_label?: string | null }[];
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [locationName, setLocationName] = useState<string | null>(label ?? null);
  const [locationAddress, setLocationAddress] = useState<string | null>(null);
  useEffect(() => { if (label) setLocationName(label); }, [label]);
  const hasCoords = !!(latitude && longitude);

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MapPin size={16} className="text-primary" />
        <h3 className="font-semibold text-sm">Set your selling location {!hasSociety && <span className="text-destructive">*</span>}</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{HOME_SELLER_LOCATION_HINT}</p>
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
          {existingStoreLocations.length > 0 && (
            <>
              <p className="text-xs font-medium text-muted-foreground">Use location from another store</p>
              <div className="space-y-2">
                {existingStoreLocations.map((store) => (
                  <button
                    key={store.id}
                    onClick={() => {
                      setLocationName(store.business_name);
                      setLocationAddress(store.store_location_label || null);
                      onLocationSet(store.latitude, store.longitude, store.business_name);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent/50 active:bg-accent/70 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <MapPin size={14} className="text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{store.business_name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{store.store_location_label || `${store.latitude.toFixed(4)}, ${store.longitude.toFixed(4)}`}</p>
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
            {hasSociety
              ? 'The Google location result does not need to be a formal business listing.'
              : 'Set your store location so buyers can find you. The Google result does not need to be a formal business listing.'}
          </p>
          <Button variant="outline" className="w-full h-10" onClick={() => setSheetOpen(true)}>
            <Navigation size={14} className="mr-2" />
            Set selling location
          </Button>
          {!hasSociety && (
            <p className="text-[10px] text-destructive">Required — your store won't be visible without a location</p>
          )}
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

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2"><Shield size={16} className="text-primary" /><h3 className="font-semibold text-sm">License Required: {categoryName}</h3></div>
      <p className="text-xs text-muted-foreground">This category requires a verified license before you can sell.</p>
      {draftSellerId ? (
        <LicenseUpload sellerId={draftSellerId} categoryConfigId={categoryConfigId} isOnboarding={isOnboarding} onStatusChange={onStatusChange} />
      ) : (
        <p className="text-xs text-muted-foreground italic">Fill in your business name above — license upload will appear once your draft is saved.</p>
      )}
    </div>
  );
}

const TOTAL_STEPS = NEW_ONBOARDING_TOTAL_STEPS;
const STEP_META = [
  { label: 'Intent', icon: Search, title: 'What are you selling?', helper: 'Describe it in your words — category comes after.' },
  { label: 'Buyers', icon: ShoppingCart, title: 'How should buyers get it?', helper: 'This sets your store default — you can customize per product later.' },
  { label: 'Category', icon: Tags, title: 'We found a home for it', helper: 'Confirm or adjust — taxonomy never blocks you.' },
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
  const { profile, sellerProfiles } = useAuth();
  const app = useSellerApplication();
  const { configs } = useCategoryConfigs();
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
    setExistingSeller, setDraftSellerId, handleStepBack, handleGroupSelect, submissionComplete,
    loadSellerDataIntoForm, reloadProducts, rejectionFeedback, setRejectionFeedback,
    listingIntentPhrase, setListingIntentPhrase,
    commerceModel, setCommerceModel,
    seedProductName, setSeedProductName,
    softListingTag, setSoftListingTag,
  } = app;

  const allSubsQuery = useSubcategories();
  const allSubs = allSubsQuery.data || [];
  const [browseTaxonomy, setBrowseTaxonomy] = useState(false);
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

  const softTag = (softListingTag || null) as SoftListingTag;
  const resolvedIntent = useMemo(() => resolveListingIntent({
    phrase: listingIntentPhrase,
    commerceModel: (commerceModel as CommerceModel) || null,
    softTag,
    categories: intentCatalogCategories,
    subcategories: intentCatalogSubs,
  }), [listingIntentPhrase, commerceModel, softTag, intentCatalogCategories, intentCatalogSubs]);

  const suggestedConfig = useMemo(() => {
    if (!resolvedIntent.suggestedCategorySlug && !resolvedIntent.suggestedCategoryConfigId) return null;
    return configs.find((c: any) =>
      c.id === resolvedIntent.suggestedCategoryConfigId ||
      c.category === resolvedIntent.suggestedCategorySlug
    ) || null;
  }, [configs, resolvedIntent]);

  const persistCommerceChoice = useCallback((model: BuyerJourneyId) => {
    setCommerceModel(model);
    const action = commerceModelToDefaultAction(model);
    handleSetStoreActionType(action);
  }, [setCommerceModel, handleSetStoreActionType]);

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

  const applyTaxonomySuggestion = useCallback((resolved = resolvedIntent) => {
    const cfg = configs.find((c: any) =>
      c.id === resolved.suggestedCategoryConfigId ||
      c.category === resolved.suggestedCategorySlug
    );
    if (!cfg) return false;
    setSelectedGroup(cfg.parentGroup);
    setFormData((f) => {
      // Replace prefs for this suggestion — avoid orphan keys from earlier browse attempts
      const prefs: SellerFormData['subcategory_preferences']['data'] = {};
      if (resolved.suggestedSubcategoryId) {
        prefs[cfg.id] = {
          primary: resolved.suggestedSubcategoryId,
          others: [],
          customLabel: null,
        };
      } else if (resolved.needsOtherSubcategory || resolved.useCustomSubcategoryLabel) {
        prefs[cfg.id] = {
          primary: null,
          others: [],
          customLabel: resolved.useCustomSubcategoryLabel || resolved.seedProductName || 'Other',
        };
      }
      return {
        ...f,
        categories: [cfg.category],
        subcategory_preferences: { v: 1, data: prefs },
      };
    });
    if (resolved.seedProductName) setSeedProductName(resolved.seedProductName);
    return true;
  }, [configs, resolvedIntent, setFormData, setSelectedGroup, setSeedProductName]);

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
    if (step === 5 && prev === 4) {
      handleSetConfigSubStep(1);
    }
    if (step === 4 && prev === 3) {
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

  if (isCheckingExisting || groupsLoading) {
    return <AppLayout showHeader={false} showNav={false}><div className="flex items-center justify-center min-h-[100dvh]"><Loader2 className="animate-spin" size={32} /></div></AppLayout>;
  }

  // ─── Submission Success Screen ──────────────────────────────────────────────
  if (submissionComplete) {
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
    const isRejected = (existingSeller as any).verification_status === 'rejected';
    const isPendingReview = (existingSeller as any).verification_status === 'pending';
    const hasPendingCategoryRequest = pendingCategoryRequests.length > 0;
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
                    setStep(2);
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
            {step === 4 ? STORE_SETUP_SUB_STEPS[storeSetupSubStep - 1].title : step === 5 ? CONFIG_SUB_STEPS[configSubStep - 1].title : STEP_META[step - 1].title}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {step === 4 ? STORE_SETUP_SUB_STEPS[storeSetupSubStep - 1].helper : step === 5 ? CONFIG_SUB_STEPS[configSubStep - 1].helper : STEP_META[step - 1].helper}
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
        {step >= 4 && selectedGroupInfo && (
          <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-lg bg-muted/60 text-xs">
            <div className={cn('w-6 h-6 rounded flex items-center justify-center', selectedGroupInfo.color)}><DynamicIcon name={selectedGroupInfo.icon} size={14} /></div>
            <span className="font-medium">{selectedGroupInfo.label}</span>
            {formData.categories.length > 0 && (
              <><ChevronRight size={12} className="text-muted-foreground" /><span className="text-muted-foreground truncate">{formData.categories.map(cat => { const config = configs.find(c => c.category === cat); return config?.displayName || cat; }).join(', ')}</span></>
            )}
            {formData.business_name.trim() && step >= 5 && <><span className="text-muted-foreground">|</span><span className="font-medium truncate">"{formData.business_name}"</span></>}
          </div>
        )}

        {/* Step 1: What are you selling? */}
        {step === 1 && (
          <>
            <PendingCategoryRequestsBanner variant="inline" />
            <ListingIntentStep
              value={listingIntentPhrase}
              onChange={(phrase) => {
                setListingIntentPhrase(phrase);
                setSeedProductName(phrase.trim() ? phrase.trim().charAt(0).toUpperCase() + phrase.trim().slice(1) : '');
              }}
              onContinue={() => {
                setSeedProductName(
                  listingIntentPhrase.trim()
                    ? listingIntentPhrase.trim().charAt(0).toUpperCase() + listingIntentPhrase.trim().slice(1)
                    : '',
                );
                setStep(2);
              }}
            />
          </>
        )}

        {/* Step 2: Commerce model */}
        {step === 2 && (
          <CommerceModelStep
            value={(commerceModel as BuyerJourneyId) || null}
            softTag={softTag}
            onChange={persistCommerceChoice}
            onSoftTagChange={(tag) => {
              setSoftListingTag(tag || '');
              const inferred = softTagToCommerceModel(tag);
              if (inferred && !commerceModel) persistCommerceChoice(inferred);
              else if (inferred && tag) persistCommerceChoice(inferred);
            }}
            onBack={() => handleStepBack(1)}
            onContinue={() => {
              if (!commerceModel && resolvedIntent.commerceModel) {
                persistCommerceChoice(resolvedIntent.commerceModel);
              }
              setBrowseTaxonomy(false);
              setStep(3);
            }}
          />
        )}

        {/* Step 3: Soft taxonomy suggest */}
        {step === 3 && (
          <div className="space-y-4">
            <button onClick={() => handleStepBack(2)} className="flex items-center gap-1 text-sm text-muted-foreground">
              <ArrowLeft size={16} />Edit buyer interaction
            </button>
            <PendingCategoryRequestsBanner variant="inline" />
            <TaxonomySuggestCard
              intentPhrase={listingIntentPhrase}
              resolved={resolvedIntent}
              categoryDisplayName={suggestedConfig?.displayName || null}
              categoryIcon={suggestedConfig?.icon || null}
              showBrowse={browseTaxonomy}
              onConfirm={() => {
                if (applyTaxonomySuggestion()) setStep(4);
                else notify.block('Category data is still loading — try again in a moment, or browse categories.');
              }}
              onContinueClosest={() => {
                if (applyTaxonomySuggestion()) setStep(4);
                else {
                  setBrowseTaxonomy(true);
                  notify.block('No exact match yet — pick the closest category to continue.');
                }
              }}
              onChangeTaxonomy={() => setBrowseTaxonomy(true)}
              onRequestCategory={() => setRequestCategoryOpen(true)}
              browseSlot={
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setBrowseTaxonomy(false)}
                    className="flex items-center gap-1 text-sm text-muted-foreground"
                  >
                    <ArrowLeft size={16} />Back to suggestion
                  </button>
                  <CategorySearchPicker
                    formData={formData}
                    setFormData={setFormData}
                    groupedConfigs={groupedConfigs}
                    configs={configs}
                    handleCategoryChange={handleCategoryChange}
                    onContinue={() => {
                      if (formData.categories.length === 0) {
                        notify.block('Select a category (or request one) to continue');
                        return;
                      }
                      if (!selectedGroup && formData.categories[0]) {
                        const cfg = configs.find((c: any) => c.category === formData.categories[0]);
                        if (cfg) setSelectedGroup(cfg.parentGroup);
                      }
                      if (resolvedIntent.seedProductName) setSeedProductName(resolvedIntent.seedProductName);
                      setBrowseTaxonomy(false);
                      setStep(4);
                    }}
                    onGroupResolved={(group) => {
                      if (!selectedGroup) setSelectedGroup(group);
                    }}
                    parentGroupInfos={parentGroupInfos}
                    sellerId={draftSellerId}
                    onboardingMode
                  />
                </div>
              }
            />
            <RequestCategoryDialog
              open={requestCategoryOpen}
              onOpenChange={setRequestCategoryOpen}
              initialName={listingIntentPhrase.trim()}
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

        {/* Step 4: Location → Fulfilment → Radius → Store information */}
        {step === 4 && (
          <div className="space-y-5">
            <button onClick={() => {
              if (storeSetupSubStep > 1) {
                handleSetStoreSetupSubStep(storeSetupSubStep - 1);
              } else {
                handleStepBack(3);
              }
            }} className="flex items-center gap-1 text-sm text-muted-foreground">
              <ArrowLeft size={16} />{storeSetupSubStep > 1 ? 'Back' : 'Change categories'}
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
                  onLocationSet={(lat, lng, _name, formattedAddress) => setFormData({ ...formData, latitude: lat, longitude: lng, store_location_label: formattedAddress || _name || formData.store_location_label || null })}
                  hasSociety={!!profile?.society_id}
                  existingStoreLocations={
                    (sellerProfiles || [])
                      .filter((sp: any) => sp.latitude && sp.longitude && sp.id !== draftSellerId)
                      .map((sp: any) => ({ id: sp.id, business_name: sp.business_name || 'Store', latitude: sp.latitude, longitude: sp.longitude, store_location_label: sp.store_location_label || null }))
                  }
                />
                <Button className="w-full" onClick={() => {
                  if (!formData.latitude && !profile?.society_id) {
                    notify.block('Please set your selling location');
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
                    handleStepBack(3);
                    return;
                  }
                  if (!storeActionType && commerceModel) {
                    handleSetStoreActionType(commerceModelToDefaultAction(commerceModel as BuyerJourneyId));
                  }
                  handleSetConfigSubStep(1);
                  handleProceedToSettings();
                }} disabled={isLoading || !formData.business_name.trim() || ((selectedGroupRow as any)?.license_mandatory && (!licenseStatus || licenseStatus === 'rejected'))}>{isLoading && <Loader2 className="animate-spin mr-2" size={18} />}Continue<ChevronRight size={16} className="ml-1" /></Button>
              </div>
            )}
          </div>
        )}

        {/* Step 5: Configure (delivery → schedule → images; interaction already chosen) */}
        {step === 5 && (
          <div className="space-y-5">
            <button onClick={() => {
              if (configSubStep > 1) {
                handleSetConfigSubStep(configSubStep - 1);
              } else {
                handleStepBack(4);
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

        {/* Step 6: Add Products */}
        {step === 6 && !draftSellerId && (
          <div className="space-y-5 text-center py-8">
            <div className="w-16 h-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center"><Package size={24} className="text-destructive" /></div>
            <h3 className="text-lg font-semibold">Unable to load your store</h3>
            <p className="text-sm text-muted-foreground">Your store draft could not be found. Please go back and try again.</p>
            <Button variant="outline" onClick={() => setStep(4)}><ArrowLeft size={16} className="mr-1" />Go Back</Button>
          </div>
        )}
        {step === 6 && draftSellerId && (
          <div className="space-y-5">
            <button onClick={() => handleStepBack(5)} className="flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft size={16} />Edit store settings</button>
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
            <Button className="w-full" onClick={() => setStep(7)} disabled={draftProducts.length === 0}>Review & Submit<ChevronRight size={16} className="ml-1" /></Button>
          </div>
        )}

        {/* Step 7: Review & Submit */}
        {step === 7 && (() => {
          const validationErrors: { key: string; message: string; step: number }[] = [];
          if (draftProducts.length === 0) validationErrors.push({ key: 'products', message: 'Add at least one product before submitting', step: 6 });
          if (formData.operating_days.length === 0) validationErrors.push({ key: 'days', message: 'Select at least one operating day', step: 5 });
          if (formData.accepts_upi && !formData.upi_id?.trim()) validationErrors.push({ key: 'upi', message: 'Enter your UPI ID or disable UPI payments', step: 5 });
          if (!formData.latitude && !profile?.society_id) validationErrors.push({ key: 'location', message: 'Set your store location', step: 4 });
          if (formData.categories.length === 0) validationErrors.push({ key: 'categories', message: 'Select at least one category', step: 3 });
          return (
          <div className="space-y-5">
            <button onClick={() => handleStepBack(6)} className="flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft size={16} />Edit products</button>

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
                <div className="flex justify-between gap-3"><span className="text-muted-foreground shrink-0">Location</span><span className="font-medium text-right">{formatStoreLocationLabel(formData.store_location_label) || (formData.latitude ? 'Location selected' : profile?.society_id ? 'Society default' : '⚠️ Not set')}</span></div>
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
            {draftSellerId && selectedGroupRow && (selectedGroupRow as any).requires_license && licenseStatus && (
              <div className={cn('rounded-lg p-3 text-sm flex items-center gap-2', licenseStatus === 'approved' ? 'bg-success/10 text-success' : licenseStatus === 'pending' ? 'bg-warning/10 text-warning' : 'bg-muted/50 text-muted-foreground')}>
                <Shield size={16} className="flex-shrink-0" /><span>{(selectedGroupRow as any).license_type_name || 'Business License'}: {licenseStatus === 'approved' ? 'Verified ✓' : licenseStatus === 'pending' ? 'Uploaded — awaiting admin verification' : 'Status: ' + licenseStatus}</span>
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
