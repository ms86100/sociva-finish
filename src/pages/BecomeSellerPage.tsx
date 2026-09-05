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
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { PendingCategoryRequestsBanner, useOpenCategoryRequests } from '@/components/seller/PendingCategoryRequestsBanner';
import { ParentGroupPickerStep } from '@/components/seller/ParentGroupPickerStep';
import { CommerceModelStep } from '@/components/seller/CommerceModelStep';
import { OfferingsStep } from '@/components/seller/OfferingsStep';
import { IntentCategoryStep } from '@/components/seller/IntentCategoryStep';
import { SubcategorySelectStep } from '@/components/seller/SubcategorySelectStep';
import { RequestCategoryDialog } from '@/components/seller/RequestCategoryDialog';
import { ExistingStoresOnboardingPanel } from '@/components/seller/ExistingStoresOnboardingPanel';
import { resolveStoreCategoryLabel } from '@/lib/store-category-label';
import { isShelvedSellerStore } from '@/lib/seller-journey';
import { UpiVpaInput } from '@/components/payment/UpiVpaInput';
import {
  commerceModelToDefaultAction,
  softTagToCommerceModel,
  NEW_ONBOARDING_TOTAL_STEPS,
  INTENT_EXAMPLE_CHIPS,
  type SoftListingTag,
  type CommerceModel,
} from '@/lib/listing-intent';
import { commerceModelFromCategory, inferSellerDomain } from '@/lib/seller-domain';
import {
  normalizeOfferingNames,
  pickFallbackCategory,
  resolveOfferingBatch,
  type OfferingStamp,
  type WorkflowConflict,
} from '@/lib/offering-taxonomy';
import { ensureDraftProductsForOfferings, pendingOfferingNamesForProducts } from '@/lib/onboarding-product-sync';
import type { BuyerJourneyId } from '@/lib/buyer-journey';
import { notify } from '@/lib/notify';
import {
  HOME_SELLER_LOCATION_HINT,
  LICENSE_ONBOARDING_HINT,
  licenseStatusBlocksOnboarding,
  onboardingLicenseMandatory,
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
const STEP_META_BASE = [
  { label: 'Sell', icon: Search, title: 'What would you like to sell?', helper: 'Describe it or browse Product, Service, and Listing categories.' },
  { label: 'Type', icon: Tags, title: 'Pick a subcategory', helper: 'This becomes the initial name of your listing. Propose one if yours is missing.' },
  { label: 'Listing', icon: Package, title: 'Add listing details', helper: 'Only the fields that match your category. Start with one item.' },
  { label: 'Store', icon: Store, title: 'Name your store and submit', helper: 'We review your store next — you can keep editing from the Seller Dashboard.' },
];

const FULFILLMENT_OPTIONS = [
  { value: 'self_pickup', label: 'Self Pickup', description: 'Customers pick up from your location', icon: Store, disabled: false },
  { value: 'seller_delivery', label: 'I Deliver', description: 'You deliver to customers', icon: Truck, disabled: false },
  { value: 'pickup_and_seller_delivery', label: 'Both', description: 'Buyer can choose pickup or you deliver', icon: Truck, disabled: false },
  { value: 'platform_delivery', label: 'Delivery Partner', description: 'Platform delivery partner delivers — available in future plans', icon: Truck, disabled: true },
  { value: 'pickup_and_platform_delivery', label: 'Pickup + Delivery Partner', description: 'Buyer can choose pickup or delivery partner — available in future plans', icon: Truck, disabled: true },
];

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function BecomeSellerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const forceNew = searchParams.get('new') === '1';
  const resumeSellerId = searchParams.get('seller');
  const { profile, sellerProfiles, setCurrentSellerId, refreshProfile } = useAuth();
  const { addresses: deliveryAddresses } = useDeliveryAddresses();
  const app = useSellerApplication({ forceNew });
  const { configs } = useCategoryConfigs();
  const [societyLoc, setSocietyLoc] = useState<{ name: string; latitude: number; longitude: number } | null>(null);
  const [societyHasCoords, setSocietyHasCoords] = useState<boolean | null>(null);

  // Deep-link resume: /become-seller?seller=<id>
  useEffect(() => {
    if (!resumeSellerId || forceNew) return;
    if (app.draftSellerId === resumeSellerId) return;
    void app.resumeExistingStore(resumeSellerId);
  }, [resumeSellerId, forceNew, app.draftSellerId, app.resumeExistingStore]);

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
    resumeExistingStore, startNewStoreOnboarding, saveDraft,
    listingIntentPhrase, setListingIntentPhrase,
    commerceModel, setCommerceModel, applyCommerceModelChange,
    seedProductName, setSeedProductName,
    offeringNames, setOfferingNames,
    softListingTag, setSoftListingTag,
  } = app;

  // Resume / review can show "add a product" falsely if products weren't loaded yet
  useEffect(() => {
    if (!draftSellerId) return;
    if (step === 3 || step === 4) {
      void reloadProducts(draftSellerId);
    }
  }, [step, draftSellerId, reloadProducts]);

  const pendingOfferings = useMemo(
    () => pendingOfferingNamesForProducts(
      normalizeOfferingNames(offeringNames || []),
      (draftProducts || []).map((p: { name?: string }) => p.name),
    ),
    [offeringNames, draftProducts],
  );

  const allSubsQuery = useSubcategories();
  const allSubs = allSubsQuery.data || [];
  const [requestCategoryOpen, setRequestCategoryOpen] = useState(false);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string | null>(null);
  const [intentPhrase, setIntentPhrase] = useState(() => listingIntentPhrase || '');
  const selectedCategorySlug = formData.categories[0] || null;
  const selectedCategoryConfig = useMemo(
    () => configs.find((c: any) => c.category === selectedCategorySlug) || null,
    [configs, selectedCategorySlug],
  );
  const sellerDomain = useMemo(() => {
    if (!selectedCategoryConfig) return null;
    return inferSellerDomain({
      sellerDomain: (selectedCategoryConfig as any).sellerDomain,
      parentGroup: selectedCategoryConfig.parentGroup,
      category: selectedCategoryConfig.category,
      supportsCart: selectedCategoryConfig.behavior?.supportsCart,
      isPhysicalProduct: (selectedCategoryConfig.behavior as any)?.isPhysicalProduct,
      enquiryOnly: selectedCategoryConfig.behavior?.enquiryOnly,
      requiresTimeSlot: selectedCategoryConfig.behavior?.requiresTimeSlot,
      defaultActionType: storeActionType || selectedCategoryConfig.defaultActionType,
      transactionType: selectedCategoryConfig.transactionType,
    });
  }, [selectedCategoryConfig, storeActionType]);
  const domainStepLabel = sellerDomain === 'product'
    ? 'Product'
    : sellerDomain === 'service'
      ? 'Service'
      : 'Listing';
  const STEP_META = useMemo(() => {
    const base = STEP_META_BASE.map((m) => ({ ...m }));
    base[2] = {
      ...base[2],
      label: domainStepLabel,
      title: sellerDomain === 'product'
        ? 'Add product details'
        : sellerDomain === 'service'
          ? 'Add service details'
          : 'Add listing details',
      helper: sellerDomain
        ? `Only the fields that match your category. Start with one ${domainStepLabel.toLowerCase()}.`
        : base[2].helper,
    };
    return base;
  }, [domainStepLabel, sellerDomain]);
  const categorySubs = useMemo(
    () => (selectedCategoryConfig
      ? allSubs.filter((s: any) => s.category_config_id === selectedCategoryConfig.id)
      : []),
    [allSubs, selectedCategoryConfig],
  );

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

  const persistCommerceChoice = useCallback(async (model: BuyerJourneyId) => {
    const ok = await applyCommerceModelChange(model);
    if (!ok) return false;
    handleSetStoreActionType(commerceModelToDefaultAction(model));
    return true;
  }, [applyCommerceModelChange, handleSetStoreActionType]);

  const offeringChips = useMemo(() => {
    const catalogNames = (allSubs || []).map((s: any) => s.display_name).filter(Boolean);
    const byLower = new Map(catalogNames.map((n: string) => [n.toLowerCase(), n]));
    const chips: string[] = [];
    for (const example of INTENT_EXAMPLE_CHIPS) {
      const exact = byLower.get(example.toLowerCase());
      if (exact && !chips.includes(exact)) {
        chips.push(exact);
        continue;
      }
      const partial = catalogNames.find((n: string) =>
        n.toLowerCase().includes(example.toLowerCase()) || example.toLowerCase().includes(n.toLowerCase()),
      );
      if (partial && !chips.includes(partial)) chips.push(partial);
    }
    return chips.slice(0, 12);
  }, [allSubs]);

  const groupLabelBySlug = useMemo(() => {
    const map: Record<string, string> = {};
    parentGroupInfos.forEach((g) => { map[g.value] = g.label; });
    return map;
  }, [parentGroupInfos]);

  const [offeringsError, setOfferingsError] = useState<string | null>(null);
  const [taxonomyStampHint, setTaxonomyStampHint] = useState<string | null>(null);
  const [workflowConflict, setWorkflowConflict] = useState<WorkflowConflict | null>(null);
  const pendingStampRef = useRef<OfferingStamp | null>(null);
  const pendingConflictRef = useRef<WorkflowConflict | null>(null);

  const applyStampAndGoToStore = useCallback(async (stamp: OfferingStamp, usedGroupPicker: boolean) => {
    const taken = sellerProfiles.some((p) =>
      p.primary_group === stamp.primaryGroup &&
      p.verification_status !== 'draft' &&
      p.id !== draftSellerId,
    );
    if (taken) {
      notify.block(
        'You already have a store in this type. Manage that store, or offer these items from a different store type.',
        { title: 'Store type already used', id: 'seller-group-taken' },
      );
      return;
    }
    setSelectedGroup(stamp.primaryGroup);
    const overrides = {
      categories: stamp.categories,
      subcategory_preferences: stamp.subcategory_preferences,
    };
    setFormData((f) => ({ ...f, ...overrides }));
    try { sessionStorage.setItem('onboarding_used_group_picker', usedGroupPicker ? '1' : '0'); } catch { /* */ }
    const id = await app.saveDraft({
      silent: true,
      notifyOnError: true,
      allowEmptyCategories: true,
      groupOverride: stamp.primaryGroup,
      formOverrides: overrides,
    });
    if (!id) return;
    setTaxonomyStampHint(stamp.stampLabel);
    const names = normalizeOfferingNames(offeringNames || []);
    if (names[0]) setSeedProductName(names[0]);
    const primaryCfgId = Object.keys(stamp.subcategory_preferences.data || {})[0];
    const primarySub = primaryCfgId ? stamp.subcategory_preferences.data[primaryCfgId]?.primary : null;
    const action = storeActionType || (commerceModel ? commerceModelToDefaultAction(commerceModel as BuyerJourneyId) : 'add_to_cart');
    const seeded = await ensureDraftProductsForOfferings({
      sellerId: id,
      names,
      category: stamp.categories[0],
      actionType: action,
      subcategoryId: primarySub || null,
    });
    if (!seeded.ok && seeded.error) {
      notify.block(seeded.error, { title: 'Could not prefill products', id: 'seller-product-seed' });
    }
    await reloadProducts(id);
    // v5: after taxonomy stamp, continue at listing (step 3), not legacy step 5.
    setStep(3);
  }, [
    sellerProfiles, draftSellerId, setSelectedGroup, setFormData, app, offeringNames,
    setSeedProductName, storeActionType, commerceModel, reloadProducts, setStep,
  ]);

  const continueFromOfferings = useCallback(async () => {
    setOfferingsError(null);
    const batch = resolveOfferingBatch({
      names: offeringNames || [],
      commerceModel: (commerceModel as CommerceModel) || null,
      categories: intentCatalogCategories,
      subcategories: intentCatalogSubs,
      groupLabelBySlug,
    });
    if (batch.status === 'empty') {
      notify.block('Add at least one offering (2 characters or more)');
      return;
    }
    if (batch.status === 'mixed_groups') {
      const detail = batch.mixed.map((m) => `${m.name} (${groupLabelBySlug[m.group] || m.group})`).join(', ');
      setOfferingsError(`These offerings belong to different store types: ${detail}. Keep one type here and open a second store for the other.`);
      return;
    }
    if (batch.status === 'needs_group') {
      setStep(3);
      return;
    }
    if (batch.workflowConflict) {
      pendingStampRef.current = batch.stamp;
      pendingConflictRef.current = batch.workflowConflict;
      setWorkflowConflict(batch.workflowConflict);
      return;
    }
    if (batch.stamp) await applyStampAndGoToStore(batch.stamp, false);
  }, [
    offeringNames, commerceModel, intentCatalogCategories, intentCatalogSubs,
    groupLabelBySlug, setStep, applyStampAndGoToStore,
  ]);

  const continueFromGroupPicker = useCallback(async (group: string) => {
    const fallback = pickFallbackCategory(group, intentCatalogCategories);
    if (!fallback) {
      notify.block('No categories are available for that store type yet.');
      return;
    }
    const stamp: OfferingStamp = {
      primaryGroup: group,
      categories: [fallback.slug],
      subcategory_preferences: { v: 1, data: {} },
      stampLabel: `Saved under ${groupLabelBySlug[group] || group} → ${fallback.displayName}`,
    };
    await applyStampAndGoToStore(stamp, true);
  }, [intentCatalogCategories, groupLabelBySlug, applyStampAndGoToStore]);

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

  const continueFromIntentCategory = useCallback(async (categorySlug: string) => {
    const cfg = configs.find((c: any) => c.category === categorySlug);
    if (!cfg) {
      notify.block('Category not found');
      return;
    }
    const takenStore = sellerProfiles.find((p) =>
      p.primary_group === cfg.parentGroup &&
      p.verification_status !== 'draft' &&
      p.id !== draftSellerId,
    );
    if (takenStore) {
      notify.block(
        `You already have "${takenStore.business_name || 'a store'}" in this store type. Manage that store, or offer items from a different type.`,
        { title: 'Store type already used', id: 'seller-group-taken' },
      );
      return;
    }
    const model = commerceModelFromCategory({
      sellerDomain: (cfg as any).sellerDomain,
      parentGroup: cfg.parentGroup,
      category: cfg.category,
      supportsCart: cfg.behavior?.supportsCart,
      isPhysicalProduct: cfg.behavior?.isPhysicalProduct,
      enquiryOnly: cfg.behavior?.enquiryOnly,
      requiresTimeSlot: cfg.behavior?.requiresTimeSlot,
      defaultActionType: (cfg as any).defaultActionType,
      transactionType: cfg.transactionType,
    });
    const action = commerceModelToDefaultAction(model);
    await persistCommerceChoice(model as BuyerJourneyId);
    handleSetStoreActionType(action);
    setListingIntentPhrase(intentPhrase.trim() || cfg.displayName);
    const overrides = {
      categories: [cfg.category],
      subcategory_preferences: { v: 1 as const, data: {} },
    };
    setFormData((f) => ({ ...f, ...overrides }));
    setSelectedSubcategoryId(null);
    // Clear leftover seed/offerings from a prior store attempt so breadcrumbs and
    // listing seeds don't show e.g. "Daily Tiffin" under Yoga.
    setSeedProductName('');
    setOfferingNames([]);
    const id = await saveDraft({
      silent: true,
      notifyOnError: true,
      allowEmptyCategories: true,
      groupOverride: cfg.parentGroup,
      formOverrides: overrides,
    });
    if (!id) return;
    setSelectedGroup(cfg.parentGroup);
    setStep(2);
  }, [
    configs, sellerProfiles, draftSellerId, persistCommerceChoice, handleSetStoreActionType,
    setListingIntentPhrase, intentPhrase, setFormData, setSeedProductName, setOfferingNames,
    saveDraft, setSelectedGroup, setStep,
  ]);

  const continueFromSubcategory = useCallback(async (sub: { id: string; displayName: string }) => {
    if (!selectedCategoryConfig) {
      notify.block('Select a category first');
      return;
    }
    setSelectedSubcategoryId(sub.id);
    setSeedProductName(sub.displayName);
    setOfferingNames([sub.displayName]);
    const prefs = {
      v: 1 as const,
      data: {
        [selectedCategoryConfig.id]: {
          primary: sub.id,
          others: [] as string[],
          customLabel: null as string | null,
        },
      },
    };
    const overrides = {
      categories: [selectedCategoryConfig.category],
      subcategory_preferences: prefs,
    };
    setFormData((f) => ({ ...f, ...overrides }));
    const id = await saveDraft({
      silent: true,
      notifyOnError: true,
      allowEmptyCategories: false,
      groupOverride: selectedCategoryConfig.parentGroup,
      formOverrides: overrides,
    });
    if (!id) return;
    const action = storeActionType
      || (commerceModel ? commerceModelToDefaultAction(commerceModel as BuyerJourneyId) : 'add_to_cart');
    const seeded = await ensureDraftProductsForOfferings({
      sellerId: id,
      names: [sub.displayName],
      category: selectedCategoryConfig.category,
      actionType: action,
      subcategoryId: sub.id,
    });
    if (!seeded.ok && seeded.error) {
      notify.block(seeded.error, { title: 'Could not prefill listing', id: 'seller-product-seed' });
    }
    await reloadProducts(id);
    setStep(3);
  }, [
    selectedCategoryConfig, setSeedProductName, setOfferingNames, setFormData,
    saveDraft, storeActionType, commerceModel, reloadProducts, setStep,
  ]);

  // Auto-save draft before opening native image picker (survives WebView reload)
  const beforeImagePick = useCallback(async () => {
    if (draftSellerId) {
      await saveDraft();
    }
  }, [draftSellerId, saveDraft]);

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
    const storeLabel = liveSubmittedStore?.business_name || existingSeller?.business_name || formData.business_name || 'your store';

    if (submittedApproved) {
      return (
        <AppLayout showHeader={false} showNav={false}>
          <div className="p-4 flex flex-col items-center justify-center min-h-[80dvh] text-center safe-top">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4 }}>
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-success/20 flex items-center justify-center">
                <CheckCircle2 className="text-success" size={40} />
              </div>
              <h1 className="text-2xl font-bold mb-2">Approved — recharge to go live</h1>
              <p className="text-muted-foreground mb-2 max-w-xs mx-auto">
                <strong>{storeLabel}</strong> passed review.
              </p>
              <p className="text-sm text-muted-foreground mb-8 max-w-xs mx-auto">
                Buyers cannot find your store in search until you recharge Sociva Credits.
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
              Thank you for submitting <strong>{storeLabel}</strong>.
            </p>
            <p className="text-sm text-muted-foreground mb-8 max-w-xs mx-auto">
              You can open the Seller Dashboard now to finish location, payments, photos, and other details while we review.
            </p>
            <div className="flex flex-col gap-3 w-full max-w-xs mx-auto">
              <Link to="/seller">
                <Button size="lg" className="w-full">
                  <ArrowRight size={16} className="mr-2" />Go to Seller Dashboard
                </Button>
              </Link>
              <Link to="/">
                <Button variant="outline" size="lg" className="w-full">Go to Home</Button>
              </Link>
              <Button
                variant="ghost"
                className="w-full"
                onClick={startNewStoreOnboarding}
              >
                Add another store
              </Button>
            </div>
          </motion.div>
        </div>
      </AppLayout>
    );
  }

  if (
    existingSeller &&
    selectedGroup &&
    !forceNew &&
    !isShelvedSellerStore(existingSeller) &&
    !isShelvedSellerStore(liveExistingStore)
  ) {
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
                    // Jump to store name/submit (step 4) so rejection edits keep loaded name/products
                    // instead of restarting at category and risking an empty-form draft overwrite.
                    setStep(4);
                  }}>Update & Resubmit</Button>
                  <Button variant="outline" className="w-full" onClick={() => { setSelectedGroup(null); setExistingSeller(null); setStep(1); }}>Choose Different Category</Button>
                </div>
              </>
            ) : isPendingReview ? (
              <>
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-warning/20 flex items-center justify-center"><Clock className="text-warning" size={32} /></div>
                <h1 className="text-2xl font-bold mb-2">We're reviewing your store</h1>
                <p className="text-muted-foreground mb-2">Thank you for submitting <strong>{existingSeller.business_name}</strong>.</p>
                <p className="text-sm text-muted-foreground mb-6">
                  You'll get a notification when review finishes — usually within a day. You can open the Seller Dashboard now to finish location, payments, and photos.
                </p>
                <div className="space-y-3">
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={() => {
                      setCurrentSellerId(existingSeller.id);
                      navigate('/seller');
                    }}
                  >
                    <ArrowRight size={16} className="mr-2" />Go to Seller Dashboard
                  </Button>
                  <Button variant="outline" className="w-full" onClick={startNewStoreOnboarding}>Register Another Category</Button>
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
          <h1 className="text-2xl font-bold">{STEP_META[Math.max(0, Math.min(step, STEP_META.length)) - 1]?.title}</h1>
          <p className="text-muted-foreground text-sm mt-1">{STEP_META[Math.max(0, Math.min(step, STEP_META.length)) - 1]?.helper}</p>
          <p className="text-xs text-muted-foreground mt-2">Step {Math.min(step, STEP_META.length)} of {STEP_META.length}</p>
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

        {/* Context breadcrumb */}
        {step >= 2 && selectedCategoryConfig && (
          <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-lg bg-muted/60 text-xs">
            <div className={cn('w-6 h-6 rounded flex items-center justify-center', selectedCategoryConfig.color)}>
              <DynamicIcon name={selectedCategoryConfig.icon} size={14} />
            </div>
            <span className="font-medium">{selectedCategoryConfig.displayName}</span>
            {seedProductName && step >= 3 && (
              <><ChevronRight size={12} className="text-muted-foreground" /><span className="text-muted-foreground truncate">{seedProductName}</span></>
            )}
            {formData.business_name.trim() && step >= 4 && (
              <><span className="text-muted-foreground">|</span><span className="font-medium truncate">"{formData.business_name}"</span></>
            )}
          </div>
        )}

        {/* Step 1: Intent + category browse */}
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
            <IntentCategoryStep
              configs={configs}
              phrase={intentPhrase}
              onPhraseChange={(p) => {
                setIntentPhrase(p);
                setListingIntentPhrase(p);
              }}
              selectedCategorySlug={selectedCategorySlug}
              onSelectCategory={(slug) => {
                setFormData((f) => ({ ...f, categories: [slug] }));
              }}
              onContinue={() => {
                if (!selectedCategorySlug) {
                  notify.block('Select a category to continue');
                  return;
                }
                void continueFromIntentCategory(selectedCategorySlug);
              }}
            />
          </>
        )}

        {/* Step 2: Subcategory select / propose */}
        {step === 2 && selectedCategoryConfig && (
          <SubcategorySelectStep
            categoryLabel={selectedCategoryConfig.displayName}
            categoryConfigId={selectedCategoryConfig.id}
            subcategories={categorySubs}
            selectedId={selectedSubcategoryId}
            sellerId={draftSellerId}
            isLoading={allSubsQuery.isLoading}
            onSelect={(sub) => {
              setSelectedSubcategoryId(sub.id);
              setSeedProductName(sub.displayName);
            }}
            onBack={() => handleStepBack(1)}
            onContinue={() => {
              if (!selectedSubcategoryId) {
                notify.block('Select or propose a subcategory');
                return;
              }
              const sub = categorySubs.find((s: any) => s.id === selectedSubcategoryId);
              const name = sub?.display_name || seedProductName;
              if (!name) {
                notify.block('Select or propose a subcategory');
                return;
              }
              void continueFromSubcategory({ id: selectedSubcategoryId, displayName: name });
            }}
          />
        )}

        {/* Step 3: Listing details */}
        {step === 3 && !draftSellerId && (
          <div className="space-y-5 text-center py-8">
            <div className="w-16 h-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center"><Package size={24} className="text-destructive" /></div>
            <h3 className="text-lg font-semibold">Unable to load your store</h3>
            <p className="text-sm text-muted-foreground">Your store draft could not be found. Please go back and try again.</p>
            <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft size={16} className="mr-1" />Go Back</Button>
          </div>
        )}
        {step === 3 && draftSellerId && (
          <div className="space-y-5">
            <button onClick={() => handleStepBack(2)} className="flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft size={16} />Change subcategory</button>
            {rejectionFeedback && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-left">
                <p className="text-xs font-semibold text-destructive mb-1">Admin feedback — please address before resubmitting:</p>
                <p className="text-sm text-foreground">{rejectionFeedback}</p>
              </div>
            )}
            <DraftProductManager
              sellerId={draftSellerId}
              categories={formData.categories}
              products={draftProducts}
              onProductsChange={setDraftProducts}
              beforePick={beforeImagePick}
              defaultActionType={storeActionType || undefined}
              seedProductName={seedProductName || undefined}
              seedProductNames={seedProductName ? [seedProductName] : []}
              commerceModel={commerceModel}
              onStoreCategoriesChange={(cats) => setFormData((f) => ({ ...f, categories: cats }))}
              seedSubcategoryId={selectedSubcategoryId || (() => {
                const cat = formData.categories[0];
                if (!cat) return null;
                const cfg = configs.find((c: any) => c.category === cat);
                if (!cfg) return null;
                return formData.subcategory_preferences.data[cfg.id]?.primary || null;
              })()}
            />
            <Button className="w-full" onClick={async () => {
              if (draftSellerId) await reloadProducts(draftSellerId);
              if (draftProducts.length === 0) {
                notify.block('Add at least one listing before continuing');
                return;
              }
              if (pendingOfferings.length > 0) {
                notify.block('Add remaining offerings before review');
                return;
              }
              setStep(4);
            }} disabled={draftProducts.length === 0 || pendingOfferings.length > 0}>
              Continue to store name<ChevronRight size={16} className="ml-1" />
            </Button>
          </div>
        )}

        {/* Step 4: Business name + submit */}
        {step === 4 && (() => {
          const validationErrors: { key: string; message: string; step: number }[] = [];
          if (!formData.business_name.trim() || formData.business_name.trim() === 'Untitled store') {
            validationErrors.push({ key: 'name', message: 'Enter your business / store name', step: 4 });
          }
          if (draftProducts.length === 0) validationErrors.push({ key: 'products', message: 'Add at least one listing before submitting', step: 3 });
          if (formData.categories.length === 0) validationErrors.push({ key: 'categories', message: 'Select a category', step: 1 });
          if (licenseBlocksContinue) {
            validationErrors.push({
              key: 'license',
              message: licenseStatus === 'rejected'
                ? `Your ${mandatoryLicenseLabel} was rejected. Please upload a valid document.`
                : `Please upload your ${mandatoryLicenseLabel} before submitting.`,
              step: 4,
            });
          }
          return (
            <div className="space-y-5">
              <button onClick={() => handleStepBack(3)} className="flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft size={16} />Edit listing</button>

              <div className="space-y-2">
                <Label htmlFor="business_name">Business / Store Name *</Label>
                <Input
                  id="business_name"
                  placeholder={groups.find(g => g.slug === selectedGroup)?.placeholder_hint || 'e.g., Your Store Name'}
                  value={formData.business_name}
                  onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Buyers see this on your store, products, orders, and invoices.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Short description (optional)</Label>
                <Textarea
                  id="description"
                  placeholder="Tell customers about what you offer..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>

              {mandatoryLicenseRequired && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
                  This category may require a license. You can finish license upload from Seller Settings after submitting if needed.
                </div>
              )}

              <div className="bg-muted rounded-lg p-4 space-y-2 text-sm">
                <h4 className="font-semibold">Summary</h4>
                <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span className="font-medium">{selectedCategoryConfig?.displayName || '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{domainStepLabel}</span><span className="font-medium">{seedProductName || draftProducts[0]?.name || '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="font-medium">{draftProducts.length}</span></div>
                <p className="text-[11px] text-muted-foreground pt-1">Store location defaults from your profile/society. Override later in the Seller Dashboard.</p>
              </div>

              {validationErrors.length > 0 && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 space-y-2">
                  {validationErrors.map((err) => (
                    <div key={err.key} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-destructive">{err.message}</span>
                      {err.step !== 4 && (
                        <Button variant="outline" size="sm" className="shrink-0 text-xs h-7" onClick={() => handleStepBack(err.step)}>Fix</Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="border rounded-lg p-4 space-y-3">
                <h4 className="font-semibold text-sm flex items-center gap-2"><Shield size={16} className="text-primary" />Seller Declaration</h4>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>By submitting, I declare that I hold required licenses, am responsible for quality/safety, and will follow community guidelines.</p>
                </div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox checked={acceptedDeclaration} onCheckedChange={(checked) => setAcceptedDeclaration(checked as boolean)} className="mt-0.5" />
                  <span className="text-sm font-medium">I agree to the seller declaration</span>
                </label>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={handleSubmit}
                disabled={isLoading || !acceptedDeclaration || validationErrors.length > 0}
              >
                {isLoading ? <Loader2 className="animate-spin mr-2" size={18} /> : <Send size={18} className="mr-2" />}
                Submit for review
              </Button>
            </div>
          );
        })()}
      </div>
    </AppLayout>
  );
}
