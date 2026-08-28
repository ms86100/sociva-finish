// @ts-nocheck
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useParentGroups } from '@/hooks/useParentGroups';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useActionTypeMap } from '@/hooks/useActionTypeMap';
import { ServiceCategory } from '@/types/categories';
import { DAYS_OF_WEEK } from '@/types/Database';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { notifyAdminsNewStoreApplication } from '@/lib/admin-notifications';
import { notify } from '@/lib/notify';
import { migrateOnboardingStep, NEW_ONBOARDING_TOTAL_STEPS, commerceModelFromActionType, commerceModelToDefaultAction } from '@/lib/listing-intent';
import {
  buildOnboardingMeta,
  parseOnboardingMeta,
  pruneSubcategoryPreferences,
  restoreStepFromBackup,
  validateStoreProductActionConsistency,
} from '@/lib/onboarding-state';
import {
  findProductsMissingServiceListings,
  syncDraftProductsToStoreAction,
} from '@/lib/onboarding-product-sync';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import {
  assertLicenseAllowsSellerSubmit,
  evaluateSellerLicenseEligibility,
} from '@/lib/seller-license';

const ONBOARDING_VERSION_KEY = 'seller_onboarding_version';
const ONBOARDING_VERSION = '3';
const ONBOARDING_FORM_BACKUP_KEY = 'seller_onboarding_form_backup';
const INTENT_PHRASE_KEY = 'listing_intent_phrase';
const COMMERCE_MODEL_KEY = 'commerce_model';
const SEED_PRODUCT_KEY = 'seed_product_name';
const SOFT_TAG_KEY = 'soft_listing_tag';

function readSession(key: string): string {
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
}
function writeSession(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch { /* */ }
}

export interface SubcategoryPreferences {
  v: number;
  data: Record<string, { primary: string | null; others: string[]; customLabel?: string | null }>;
}

export interface PaymentConfigData {
  accepts_cod: boolean;
  accepts_online: boolean;
}

export interface SellerFormData {
  business_name: string;
  description: string;
  categories: string[];
  availability_start: string;
  availability_end: string;
  accepts_cod: boolean;
  sell_beyond_community: boolean;
  delivery_radius_km: number;
  fulfillment_mode: string;
  delivery_note: string;
  accepts_upi: boolean;
  upi_id: string;
  operating_days: string[];
  profile_image_url: string | null;
  cover_image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  store_location_label: string | null;
  subcategory_preferences: SubcategoryPreferences;
  pickup_payment_config: PaymentConfigData;
  delivery_payment_config: PaymentConfigData;
}

const DEFAULT_PAYMENT_CONFIG: PaymentConfigData = { accepts_cod: true, accepts_online: false };

const INITIAL_FORM: SellerFormData = {
  business_name: '',
  description: '',
  categories: [],
  availability_start: '09:00',
  availability_end: '21:00',
  accepts_cod: true,
  sell_beyond_community: false,
  delivery_radius_km: 1,
  fulfillment_mode: 'self_pickup',
  delivery_note: '',
  accepts_upi: false,
  upi_id: '',
  operating_days: [...DAYS_OF_WEEK],
  profile_image_url: null,
  cover_image_url: null,
  latitude: null,
  longitude: null,
  store_location_label: null,
  subcategory_preferences: { v: 1, data: {} },
  pickup_payment_config: { ...DEFAULT_PAYMENT_CONFIG },
  delivery_payment_config: { ...DEFAULT_PAYMENT_CONFIG },
};

export function useSellerApplication() {
  const navigate = useNavigate();
  const { user, profile, refreshProfile, sellerProfiles } = useAuth();
  const { parentGroupInfos, groups, isLoading: groupsLoading } = useParentGroups();
  const { groupedConfigs, configs } = useCategoryConfigs();
  const { data: allActionsData = [] } = useActionTypeMap();

  const [isLoading, setIsLoading] = useState(false);
  const [submissionComplete, setSubmissionComplete] = useState(false);
  const [isCheckingExisting, setIsCheckingExisting] = useState(true);
  const [existingSeller, setExistingSeller] = useState<{ id: string; business_name: string; verification_status?: string; rejection_note?: string | null } | null>(null);
  const [rejectionFeedback, setRejectionFeedback] = useState<string | null>(null);
  const [draftSellerId, setDraftSellerId] = useState<string | null>(null);
  const [step, _setStep] = useState(1);

  // Wrap setStep to persist to localStorage
  const setStep = useCallback((s: number | ((prev: number) => number)) => {
    _setStep(prev => {
      const next = typeof s === 'function' ? s(prev) : s;
      if (next >= 2) {
        localStorage.setItem('seller_onboarding_step', String(next));
        localStorage.setItem(ONBOARDING_VERSION_KEY, ONBOARDING_VERSION);
      }
      return next;
    });
  }, []);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [formData, setFormData] = useState<SellerFormData>(INITIAL_FORM);
  const [draftProducts, setDraftProducts] = useState<any[]>([]);
  const [acceptedDeclaration, setAcceptedDeclaration] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState<string | null>(null);
  const autoSaveInFlightRef = useRef(false);

  // Intent-first draft fields (sessionStorage — survive mid-flow refresh)
  const [listingIntentPhrase, setListingIntentPhraseState] = useState(() => readSession(INTENT_PHRASE_KEY));
  const [commerceModel, setCommerceModelState] = useState(() => readSession(COMMERCE_MODEL_KEY));
  const [seedProductName, setSeedProductNameState] = useState(() => readSession(SEED_PRODUCT_KEY));
  const [softListingTag, setSoftListingTagState] = useState(() => readSession(SOFT_TAG_KEY));

  const setListingIntentPhrase = useCallback((phrase: string) => {
    setListingIntentPhraseState(phrase);
    writeSession(INTENT_PHRASE_KEY, phrase);
  }, []);
  const setCommerceModel = useCallback((model: string) => {
    setCommerceModelState(model);
    writeSession(COMMERCE_MODEL_KEY, model);
  }, []);
  const setSeedProductName = useCallback((name: string) => {
    setSeedProductNameState(name);
    writeSession(SEED_PRODUCT_KEY, name);
  }, []);
  const setSoftListingTag = useCallback((tag: string) => {
    setSoftListingTagState(tag);
    writeSession(SOFT_TAG_KEY, tag);
  }, []);

  const persistFormBackup = useCallback(() => {
    if (!user?.id || step < 2 || !selectedGroup) return;
    try {
      localStorage.setItem(ONBOARDING_FORM_BACKUP_KEY, JSON.stringify({
        userId: user.id,
        formData,
        selectedGroup,
        step,
        commerceModel,
        seedProductName,
        listingIntentPhrase,
        softListingTag,
        onboardingVersion: ONBOARDING_VERSION,
        savedAt: Date.now(),
      }));
    } catch { /* */ }
  }, [user?.id, step, formData, selectedGroup, commerceModel, seedProductName, listingIntentPhrase, softListingTag]);

  const reloadProducts = useCallback(async (sellerId: string) => {
    try {
      const { data: prods } = await supabase.from('products').select('id, name, price, description, image_url, category, approval_status, seller_id, availability_status, action_type').eq('seller_id', sellerId);
      setDraftProducts(prods || []);
    } catch (err) {
      console.error('Error reloading products:', err);
    }
  }, []);

  /** Resolve store action type: session → seller profile → draft product action types. */
  const resolveOnboardingStoreActionType = useCallback(async (sellerId: string): Promise<string | null> => {
    try {
      const stored = sessionStorage.getItem('onboarding_store_action_type');
      if (stored) return stored;
    } catch { /* */ }
    try {
      const { data: profile } = await supabase
        .from('seller_profiles')
        .select('default_action_type')
        .eq('id', sellerId)
        .maybeSingle();
      if (profile?.default_action_type) return profile.default_action_type;
    } catch { /* */ }
    const fromProduct = draftProducts.find((p) => p.action_type)?.action_type;
    return fromProduct || null;
  }, [draftProducts]);

  const storeActionRequiresAvailability = useCallback((actionType: string | null): boolean => {
    if (!actionType) {
      return draftProducts.some((p) => {
        const at = p.action_type;
        if (!at) return false;
        return allActionsData.find((a) => a.action_type === at)?.requires_availability ?? false;
      });
    }
    return allActionsData.find((a) => a.action_type === actionType)?.requires_availability ?? false;
  }, [allActionsData, draftProducts]);

  const assertServiceProductsHaveListings = async (sellerId: string, storeActionType: string | null): Promise<boolean> => {
    const resolvedAction = storeActionType || await resolveOnboardingStoreActionType(sellerId);

    const consistency = validateStoreProductActionConsistency(draftProducts, resolvedAction);
    if (!consistency.ok) {
      notify.block(consistency.message || 'Product buyer interaction does not match your store mode.');
      return false;
    }

    const { data: serverCheck, error: serverErr } = await supabase.rpc('validate_seller_service_products_ready', {
      p_seller_id: sellerId,
    });
    if (serverErr) {
      console.error('validate_seller_service_products_ready error:', serverErr);
      notify.block('Could not verify service settings. Please try again.');
      return false;
    }
    if (serverCheck && serverCheck.ok === false) {
      notify.block(serverCheck.reason || 'Service settings are missing. Open each product, save again, then continue.');
      return false;
    }

    if (!storeActionRequiresAvailability(resolvedAction)) return true;

    const productIds = draftProducts.map((p) => p.id).filter(Boolean);
    if (productIds.length === 0) return true;

    const missingIds = await findProductsMissingServiceListings(sellerId, productIds);
    if (missingIds.length === 0) return true;

    const missingProduct = draftProducts.find((p) => p.id === missingIds[0]);
    notify.block(
      `Service settings are missing for "${missingProduct?.name || 'a product'}". Open it, save again, then continue.`,
    );
    return false;
  };

  const hydrateOnboardingFromMeta = useCallback((seller: any) => {
    const meta = parseOnboardingMeta(seller?.onboarding_meta);
    if (meta?.commerce_model) {
      setCommerceModelState(meta.commerce_model);
      writeSession(COMMERCE_MODEL_KEY, meta.commerce_model);
      const action = commerceModelToDefaultAction(meta.commerce_model as any);
      try { sessionStorage.setItem('onboarding_store_action_type', action); } catch { /* */ }
    }
    if (meta?.seed_product_name) {
      setSeedProductNameState(meta.seed_product_name);
      writeSession(SEED_PRODUCT_KEY, meta.seed_product_name);
    }
    if (meta?.listing_intent_phrase) {
      setListingIntentPhraseState(meta.listing_intent_phrase);
      writeSession(INTENT_PHRASE_KEY, meta.listing_intent_phrase);
    }
    if (meta?.soft_listing_tag) {
      setSoftListingTagState(meta.soft_listing_tag);
      writeSession(SOFT_TAG_KEY, meta.soft_listing_tag);
    }
    if (meta?.step) {
      localStorage.setItem('seller_onboarding_step', String(clampMetaStep(meta.step)));
    }
  }, []);

  const clampMetaStep = (s: number) => Math.max(1, Math.min(s, NEW_ONBOARDING_TOTAL_STEPS));

  const restoreFromBackup = useCallback((backup: any) => {
    if (!backup?.userId || !backup?.selectedGroup) return;
    setSelectedGroup(backup.selectedGroup);
    setFormData((prev) => ({ ...prev, ...backup.formData }));
    if (backup.commerceModel) {
      setCommerceModelState(backup.commerceModel);
      writeSession(COMMERCE_MODEL_KEY, backup.commerceModel);
    }
    if (backup.seedProductName) {
      setSeedProductNameState(backup.seedProductName);
      writeSession(SEED_PRODUCT_KEY, backup.seedProductName);
    }
    if (backup.listingIntentPhrase) {
      setListingIntentPhraseState(backup.listingIntentPhrase);
      writeSession(INTENT_PHRASE_KEY, backup.listingIntentPhrase);
    }
    if (backup.softListingTag) {
      setSoftListingTagState(backup.softListingTag);
      writeSession(SOFT_TAG_KEY, backup.softListingTag);
    }
    const restoredStep = restoreStepFromBackup(backup.step);
    localStorage.setItem('seller_onboarding_step', String(restoredStep));
    localStorage.setItem(ONBOARDING_VERSION_KEY, ONBOARDING_VERSION);
    setStep(restoredStep);
  }, [setStep]);
  useEffect(() => {
    const checkExisting = async () => {
      if (!user) { setIsCheckingExisting(false); return; }
      try {
        const { data } = await supabase.from('seller_profiles').select('id, user_id, business_name, description, categories, primary_group, availability_start, availability_end, accepts_cod, sell_beyond_community, delivery_radius_km, fulfillment_mode, delivery_note, accepts_upi, upi_id, operating_days, profile_image_url, cover_image_url, latitude, longitude, store_location_label, subcategory_preferences, verification_status, rejection_note, society_id, pickup_payment_config, delivery_payment_config, default_action_type, onboarding_meta').eq('user_id', user.id);
        if (data && data.length > 0) {
          // Look for draft to resume directly
          const draft = data.find((s: any) => s.verification_status === 'draft');
          if (draft) {
            setDraftSellerId(draft.id);
            setSelectedGroup((draft as any).primary_group);
            loadSellerDataIntoForm(draft);
            hydrateOnboardingFromMeta(draft);
            await reloadProducts(draft.id);
            const meta = parseOnboardingMeta((draft as any).onboarding_meta);
            const savedStep = parseInt(
              localStorage.getItem('seller_onboarding_step') || String(meta?.step || 2),
              10,
            );
            const version = localStorage.getItem(ONBOARDING_VERSION_KEY);
            const restoredStep = version === ONBOARDING_VERSION
              ? clampMetaStep(savedStep)
              : migrateOnboardingStep(
                  Math.max(1, Math.min(savedStep, version === '2' ? 7 : 5)),
                  version,
                );
            localStorage.setItem(ONBOARDING_VERSION_KEY, ONBOARDING_VERSION);
            localStorage.setItem('seller_onboarding_step', String(restoredStep));
            setStep(restoredStep);
          } else {
            // No DB draft — restore local backup if seller left mid-onboarding
            try {
              const raw = localStorage.getItem(ONBOARDING_FORM_BACKUP_KEY);
              if (raw) {
                const backup = JSON.parse(raw);
                if (backup?.userId === user.id && backup.formData && backup.selectedGroup) {
                  restoreFromBackup(backup);
                }
              }
            } catch { /* */ }
            // For non-draft profiles, check status
            const existing = data.find((s: any) =>
              s.verification_status === 'rejected' ||
              s.verification_status === 'pending'
            );
            if (existing) {
              setSelectedGroup((existing as any).primary_group);
              setExistingSeller({
                id: existing.id,
                business_name: (existing as any).business_name,
                verification_status: (existing as any).verification_status,
                rejection_note: (existing as any).rejection_note,
              });
            }
          }
        } else {
          try {
            const raw = localStorage.getItem(ONBOARDING_FORM_BACKUP_KEY);
            if (raw) {
              const backup = JSON.parse(raw);
              if (backup?.userId === user.id && backup.formData && backup.selectedGroup) {
                restoreFromBackup(backup);
              }
            }
          } catch { /* */ }
        }
      } catch (error) {
        console.error('Error checking existing seller:', error);
      } finally {
        setIsCheckingExisting(false);
      }
    };
    checkExisting();
  }, [user, reloadProducts]);

  // Helper to populate formData from an existing seller profile
  const loadSellerDataIntoForm = useCallback((seller: any) => {
    const rawPrefs = seller.subcategory_preferences;
    const prefs: SubcategoryPreferences = rawPrefs && typeof rawPrefs === 'object' && rawPrefs.v === 1
      ? rawPrefs
      : { v: 1, data: {} };
    setFormData(f => ({
      ...f,
      business_name: seller.business_name || '',
      description: seller.description || '',
      categories: seller.categories || [],
      availability_start: seller.availability_start || '09:00',
      availability_end: seller.availability_end || '21:00',
      accepts_cod: seller.accepts_cod ?? true,
      sell_beyond_community: seller.sell_beyond_community ?? false,
      delivery_radius_km: seller.delivery_radius_km ?? 1,
      fulfillment_mode: seller.fulfillment_mode || 'self_pickup',
      delivery_note: seller.delivery_note || '',
      accepts_upi: seller.accepts_upi ?? false,
      upi_id: seller.upi_id || '',
      operating_days: seller.operating_days || [...DAYS_OF_WEEK],
      profile_image_url: seller.profile_image_url || null,
      cover_image_url: seller.cover_image_url || null,
      latitude: seller.latitude ?? null,
      longitude: seller.longitude ?? null,
      store_location_label: seller.store_location_label ?? null,
      subcategory_preferences: prefs,
      pickup_payment_config: seller.pickup_payment_config || { ...DEFAULT_PAYMENT_CONFIG },
      delivery_payment_config: seller.delivery_payment_config || { ...DEFAULT_PAYMENT_CONFIG },
    }));
    // Restore the seller's chosen Buyer Interaction into the onboarding session
    // so subsequent product creation reuses the same choice rather than re-asking.
    try {
      if (seller.default_action_type) {
        sessionStorage.setItem('onboarding_store_action_type', seller.default_action_type);
        const model = commerceModelFromActionType(seller.default_action_type);
        if (model) {
          writeSession(COMMERCE_MODEL_KEY, model);
          setCommerceModelState(model);
        }
      }
      const meta = parseOnboardingMeta(seller.onboarding_meta);
      if (meta?.commerce_model) {
        writeSession(COMMERCE_MODEL_KEY, meta.commerce_model);
        setCommerceModelState(meta.commerce_model);
      }
      if (meta?.seed_product_name) {
        writeSession(SEED_PRODUCT_KEY, meta.seed_product_name);
        setSeedProductNameState(meta.seed_product_name);
      }
      if (meta?.listing_intent_phrase) {
        writeSession(INTENT_PHRASE_KEY, meta.listing_intent_phrase);
        setListingIntentPhraseState(meta.listing_intent_phrase);
      }
    } catch { /* */ }
  }, []);

  // Rehydrate commerce model React state from session (set by loadSellerDataIntoForm or prior steps)
  useEffect(() => {
    const stored = readSession(COMMERCE_MODEL_KEY);
    if (stored && stored !== commerceModel) setCommerceModelState(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSellerId]);

  const approvalToastShownRef = useRef<Set<string>>(new Set());

  // Keep existingSeller / submission UI in sync with auth sellerProfiles (realtime + refresh)
  useEffect(() => {
    if (!sellerProfiles?.length) return;

    if (existingSeller?.id) {
      const fresh = sellerProfiles.find((p) => p.id === existingSeller.id);
      if (fresh) {
        const prevStatus = (existingSeller as any).verification_status;
        const nextStatus = (fresh as any).verification_status;
        if (nextStatus && nextStatus !== prevStatus) {
          setExistingSeller({
            ...existingSeller,
            business_name: fresh.business_name || existingSeller.business_name,
            verification_status: nextStatus,
            rejection_note: (fresh as any).rejection_note ?? (existingSeller as any).rejection_note,
          });
          if (nextStatus === 'approved' && !approvalToastShownRef.current.has(fresh.id)) {
            approvalToastShownRef.current.add(fresh.id);
            showFeedback({
              title: '🎉 Your store is approved!',
              description: `${fresh.business_name || 'Your store'} is ready. Recharge Sociva Credits to go live for buyers.`,
              variant: 'success',
            });
          }
        }
      }
    }

    if (submissionComplete && draftSellerId) {
      const submitted = sellerProfiles.find((p) => p.id === draftSellerId);
      if (submitted?.verification_status === 'approved' && !approvalToastShownRef.current.has(draftSellerId)) {
        approvalToastShownRef.current.add(draftSellerId);
        showFeedback({
          title: '🎉 Your store is approved!',
          description: `${submitted.business_name || formData.business_name || 'Your store'} passed review. Recharge credits to start selling.`,
          variant: 'success',
        });
      }
    }
  }, [sellerProfiles, existingSeller, submissionComplete, draftSellerId, formData.business_name]);

  // Dedicated realtime channel so onboarding screens update without app restart
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`seller-onboarding-status-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'seller_profiles', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as { id?: string; verification_status?: string; business_name?: string; rejection_note?: string | null };
          if (!row?.id) return;

          setExistingSeller((prev) => {
            if (!prev || prev.id !== row.id) return prev;
            return {
              ...prev,
              verification_status: row.verification_status ?? prev.verification_status,
              business_name: row.business_name || prev.business_name,
              rejection_note: row.rejection_note ?? prev.rejection_note,
            };
          });

          void refreshProfile();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, refreshProfile]);

  // Check group conflict
  useEffect(() => {
    const checkGroupConflict = async () => {
      if (!user || !selectedGroup) return;
      const { data } = await supabase.from('seller_profiles')
        .select('id, business_name, verification_status, rejection_note, primary_group, categories')
        .eq('user_id', user.id)
        .eq('primary_group', selectedGroup)
        .neq('verification_status', 'draft')
        .maybeSingle();
      setExistingSeller(data ? data as any : null);
    };
    checkGroupConflict();
  }, [user, selectedGroup]);

  // Fetch license status
  const fetchLicenseStatus = useCallback(async () => {
    const groupRow = groups.find(g => g.slug === selectedGroup);
    if (!draftSellerId || !groupRow) { setLicenseStatus(null); return; }
    if (!(groupRow as any).requires_license) { setLicenseStatus(null); return; }
    try {
      const { data: licensedCategories } = await supabase
        .from('category_config')
        .select('id')
        .eq('parent_group', selectedGroup)
        .eq('requires_license', true);
      const categoryIds = (licensedCategories || []).map((c: any) => c.id).filter(Boolean);
      let licenseQuery = supabase
        .from('seller_licenses')
        .select('status, submitted_at')
        .eq('seller_id', draftSellerId)
        .order('submitted_at', { ascending: false })
        .limit(10);
      licenseQuery = categoryIds.length
        ? licenseQuery.or(`group_id.eq.${groupRow.id},category_config_id.in.(${categoryIds.join(',')})`)
        : licenseQuery.eq('group_id', groupRow.id);
      const { data } = await licenseQuery;
      const statuses = (data || []).map((row: any) => row.status);
      setLicenseStatus(statuses.includes('approved') ? 'approved' : statuses.includes('pending') ? 'pending' : statuses.includes('rejected') ? 'rejected' : null);
    } catch { setLicenseStatus(null); }
  }, [draftSellerId, groups, selectedGroup]);

  useEffect(() => { fetchLicenseStatus(); }, [fetchLicenseStatus]);

  // Auto-save draft while onboarding (from step 2 once group is chosen)
  useEffect(() => {
    if (step < 2 || isCheckingExisting || !user || !selectedGroup) return;
    persistFormBackup();

    const timer = setTimeout(async () => {
      if (autoSaveInFlightRef.current) return;
      autoSaveInFlightRef.current = true;
      try {
        await saveDraft({ silent: true, allowEmptyCategories: !formData.categories.length });
      } finally {
        autoSaveInFlightRef.current = false;
      }
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, formData, selectedGroup, draftSellerId, isCheckingExisting, user, persistFormBackup, commerceModel, seedProductName, listingIntentPhrase]);

  const categorySlugToConfigId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of configs) map[c.category] = c.id;
    return map;
  }, [configs]);

  const handleCategoryChange = (category: ServiceCategory, checked: boolean) => {
    setFormData((f) => {
      const newCategories = checked ? [...f.categories, category] : f.categories.filter((c) => c !== category);
      let newPrefsData = { ...f.subcategory_preferences.data };
      if (!checked) {
        const cfgId = categorySlugToConfigId[category];
        if (cfgId) delete newPrefsData[cfgId];
      }
      const pruned = pruneSubcategoryPreferences(
        { v: 1, data: newPrefsData },
        newCategories,
        categorySlugToConfigId,
      );
      return { ...f, categories: newCategories, subcategory_preferences: pruned };
    });
  };

  const toggleOperatingDay = (day: string) => {
    setFormData(prev => ({
      ...prev,
      operating_days: prev.operating_days.includes(day) ? prev.operating_days.filter(d => d !== day) : [...prev.operating_days, day],
    }));
  };

  const saveDraft = async (opts?: {
    silent?: boolean;
    allowEmptyCategories?: boolean;
    formOverrides?: Partial<SellerFormData>;
  }): Promise<string | null> => {
    if (!user) return null;
    if (!selectedGroup) {
      if (!opts?.silent) notify.block('Please choose a store type before continuing');
      return null;
    }
    const effectiveForm = opts?.formOverrides ? { ...formData, ...opts.formOverrides } : formData;
    if (!opts?.allowEmptyCategories && !effectiveForm.categories.length) {
      if (!opts?.silent) notify.block('Please select at least one category before continuing');
      return null;
    }
    const businessName = effectiveForm.business_name.trim() || 'Untitled store';
    if (!effectiveForm.business_name.trim() && !opts?.silent && step >= 5) {
      notify.block('Please enter a business name');
      return null;
    }
    if (!opts?.silent) setIsLoading(true);
    try {
      let storeActionType: string | null = null;
      try { storeActionType = sessionStorage.getItem('onboarding_store_action_type') || null; } catch { /* */ }
      const resolvedCommerceModel = readSession(COMMERCE_MODEL_KEY) || commerceModel;
      const resolvedSeedName = readSession(SEED_PRODUCT_KEY) || seedProductName;
      const resolvedIntentPhrase = readSession(INTENT_PHRASE_KEY) || listingIntentPhrase;
      const resolvedSoftTag = readSession(SOFT_TAG_KEY) || softListingTag;
      if (!storeActionType && resolvedCommerceModel) {
        storeActionType = commerceModelToDefaultAction(resolvedCommerceModel as any);
      }

      const draftPayload: any = {
        business_name: businessName, description: effectiveForm.description.trim() || null,
        categories: effectiveForm.categories, primary_group: selectedGroup,
        availability_start: effectiveForm.availability_start, availability_end: effectiveForm.availability_end,
        accepts_cod: effectiveForm.accepts_cod, sell_beyond_community: true,
        delivery_radius_km: effectiveForm.delivery_radius_km || 1, fulfillment_mode: effectiveForm.fulfillment_mode,
        delivery_note: effectiveForm.delivery_note.trim() || null, accepts_upi: effectiveForm.accepts_upi,
        upi_id: effectiveForm.accepts_upi ? effectiveForm.upi_id.trim() || null : null,
        operating_days: effectiveForm.operating_days, profile_image_url: effectiveForm.profile_image_url,
        cover_image_url: effectiveForm.cover_image_url,
        latitude: effectiveForm.latitude,
        longitude: effectiveForm.longitude,
        store_location_label: effectiveForm.store_location_label,
        subcategory_preferences: effectiveForm.subcategory_preferences,
        pickup_payment_config: effectiveForm.pickup_payment_config,
        delivery_payment_config: effectiveForm.delivery_payment_config,
        onboarding_meta: buildOnboardingMeta({
          step,
          commerceModel: resolvedCommerceModel || undefined,
          seedProductName: resolvedSeedName || undefined,
          listingIntentPhrase: resolvedIntentPhrase || undefined,
          softListingTag: resolvedSoftTag || undefined,
          onboardingVersion: ONBOARDING_VERSION,
        }),
      };
      if (storeActionType) draftPayload.default_action_type = storeActionType;
      if (profile?.society_id) draftPayload.society_id = profile.society_id;
      if (draftSellerId) {
        const { error } = await supabase.from('seller_profiles').update(draftPayload as any).eq('id', draftSellerId);
        if (error) throw error;
        persistFormBackup();
        return draftSellerId;
      } else {
        const { data, error } = await supabase.from('seller_profiles').insert({
          ...draftPayload, user_id: user.id, society_id: profile?.society_id || null, verification_status: 'draft' as any,
        } as any).select('id').single();
        if (error) throw error;
        setDraftSellerId(data.id);
        persistFormBackup();
        return data.id;
      }
    } catch (error: any) {
      console.error('Error saving draft:', error);
      if (!opts?.silent) toast.error(friendlyError(error), { id: 'seller-app-draft-error' });
      return null;
    } finally { if (!opts?.silent) setIsLoading(false); }
  };

  const handleProceedToSettings = async () => { const id = await saveDraft(); if (id) setStep(6); };
  const handleProceedToProducts = async (storeActionType?: string) => {
    const id = await saveDraft();
    if (id) {
      const resolvedAction = storeActionType || await resolveOnboardingStoreActionType(id);
      if (storeActionRequiresAvailability(resolvedAction)) {
        const { count } = await (supabase
          .from('service_availability_schedules') as any)
          .select('id', { count: 'exact', head: true })
          .eq('seller_id', id)
          .eq('is_active', true);

        if (!count || count === 0) {
          notify.block('Please save your availability schedule before continuing');
          return;
        }
      }

      await reloadProducts(id);
      if (!(await assertServiceProductsHaveListings(id, resolvedAction))) return;

      setStep(7);
    }
  };

  // Navigate back with auto-save when a draft exists (Bug 2: always save before step change)
  const handleStepBack = async (targetStep: number) => {
    // Auto-save draft if going back from steps where data may have changed
    if (draftSellerId && step >= 2) {
      const savedId = await saveDraft();
      // Bug 2: After saving, reload form data from DB to ensure consistency on re-mount
      if (savedId) {
        try {
          const { data: freshProfile } = await supabase
            .from('seller_profiles')
            .select('*')
            .eq('id', savedId)
            .single();
          if (freshProfile) loadSellerDataIntoForm(freshProfile);
        } catch { /* non-critical */ }
      }
    }
    setStep(targetStep);
  };

  /** Step 2 → 1: clear category selections so a new group cannot inherit stale prefs. */
  const handleBackToGroupPicker = useCallback(async () => {
    const clearedPrefs = { v: 1 as const, data: {} };
    const clearedForm = {
      ...formData,
      categories: [] as string[],
      subcategory_preferences: clearedPrefs,
    };
    setFormData(clearedForm);
    if (draftSellerId) {
      await saveDraft({
        silent: true,
        allowEmptyCategories: true,
        formOverrides: { categories: [], subcategory_preferences: clearedPrefs },
      });
    } else if (user?.id && selectedGroup) {
      try {
        localStorage.setItem(ONBOARDING_FORM_BACKUP_KEY, JSON.stringify({
          userId: user.id,
          formData: clearedForm,
          selectedGroup,
          step: 1,
          commerceModel,
          seedProductName,
          listingIntentPhrase,
          softListingTag,
          onboardingVersion: ONBOARDING_VERSION,
          savedAt: Date.now(),
        }));
      } catch { /* */ }
    }
    setStep(1);
  }, [
    draftSellerId, setStep, formData, user?.id, selectedGroup,
    commerceModel, seedProductName, listingIntentPhrase, softListingTag,
  ]);

  const handleSaveDraftAndExit = async () => {
    if (step >= 2) {
      const savedId = await saveDraft({ silent: step < 5, allowEmptyCategories: !formData.categories.length });
      if (!savedId) {
        toast.error('Could not save draft. Please fix any errors and try again.', { id: 'seller-app-draft-error' });
        return;
      }
    }
    localStorage.removeItem('seller_onboarding_step');
    localStorage.removeItem(ONBOARDING_FORM_BACKUP_KEY);
    showFeedback({
        title: 'Draft saved! You can resume later.',
        variant: 'success',
      });
    navigate('/profile');
  };

  const handleSubmit = async () => {
    if (!user || !draftSellerId) return;
    if (draftProducts.length === 0) { notify.block('Please add at least one product'); return; }
    if (!acceptedDeclaration) { notify.block('Please accept the seller declaration'); return; }
    if (formData.operating_days.length === 0) { notify.block('Please select at least one operating day'); return; }
    if (formData.accepts_upi && !formData.upi_id.trim()) { notify.block('Please enter your UPI ID or disable UPI payments'); return; }
    if (!profile?.society_id) {
      notify.block('Link your account to a society before submitting your store for review.');
      setIsLoading(false);
      return;
    }
    // Check location: must have direct coords OR society with coords
    if (!formData.latitude) {
      if (!profile?.society_id) {
        notify.block('Please set your store location before submitting');
        setIsLoading(false);
        return;
      }
      // Verify society actually has coordinates
      const { data: society } = await supabase.from('societies').select('latitude, longitude').eq('id', profile.society_id).single();
      if (!society?.latitude || !society?.longitude) {
        notify.block('Your society has no location set. Please set your store location manually.');
        setIsLoading(false);
        return;
      }
    }

    // Mandatory license — frontend gate (DB also enforces on admin approval / live products)
    try {
      const el = await evaluateSellerLicenseEligibility(draftSellerId);
      assertLicenseAllowsSellerSubmit(el);
    } catch (licErr: any) {
      const msg = String(licErr?.message || '');
      if (/failed to fetch dynamically imported module|importing a module script failed|chunkloaderror/i.test(msg)) {
        toast.error('App update in progress. Please refresh the page and submit again.', { id: 'seller-license-chunk' });
        return;
      }
      notify.block(licErr?.message || 'Please upload the required license before submitting');
      return;
    }

    setIsLoading(true);
    try {
      const storeActionType = await resolveOnboardingStoreActionType(draftSellerId);

      if (!(await assertServiceProductsHaveListings(draftSellerId, storeActionType))) {
        setIsLoading(false);
        return;
      }

      const consistency = validateStoreProductActionConsistency(draftProducts, storeActionType);
      if (!consistency.ok) {
        notify.block(consistency.message || 'Product buyer interaction does not match your store.');
        setIsLoading(false);
        return;
      }

      const submitPayload: any = {
        verification_status: 'pending' as any, business_name: formData.business_name.trim(),
        description: formData.description.trim() || null, categories: formData.categories,
        availability_start: formData.availability_start, availability_end: formData.availability_end,
        accepts_cod: formData.accepts_cod, sell_beyond_community: true,
        delivery_radius_km: formData.delivery_radius_km || 1, fulfillment_mode: formData.fulfillment_mode,
        delivery_note: formData.delivery_note.trim() || null, accepts_upi: formData.accepts_upi,
        upi_id: formData.accepts_upi ? formData.upi_id.trim() || null : null,
        operating_days: formData.operating_days, profile_image_url: formData.profile_image_url,
        cover_image_url: formData.cover_image_url, rejection_note: null,
        latitude: formData.latitude, longitude: formData.longitude, store_location_label: formData.store_location_label,
        subcategory_preferences: formData.subcategory_preferences,
        pickup_payment_config: formData.pickup_payment_config,
        delivery_payment_config: formData.delivery_payment_config,
        society_id: profile.society_id,
      };
      if (storeActionType) submitPayload.default_action_type = storeActionType;
      const { error } = await supabase.from('seller_profiles').update(submitPayload).eq('id', draftSellerId);
      if (error) throw error;
      const { error: prodError } = await supabase.from('products').update({ approval_status: 'pending' } as any).eq('seller_id', draftSellerId).eq('approval_status', 'draft');
      if (prodError) {
        // Roll profile back so seller is not told "submitted" with products still draft
        await supabase.from('seller_profiles').update({ verification_status: 'draft' } as any).eq('id', draftSellerId);
        throw prodError;
      }
      await refreshProfile();
      localStorage.setItem('seller_onboarding_completed', 'true');
    localStorage.removeItem('seller_onboarding_step');
    localStorage.removeItem(ONBOARDING_FORM_BACKUP_KEY);
    showFeedback({
        title: "We're reviewing your store",
        variant: 'success',
      });
      supabase.rpc('enqueue_seller_lifecycle_notification', {
        p_user_id: user.id,
        p_business_name: formData.business_name.trim(),
        p_status: 'pending',
        p_seller_id: draftSellerId,
        p_rejection_note: null,
      }).then(({ error }) => {
        if (error) console.error('Failed to enqueue store-submitted notification:', error);
      });
    // Notify admins about the new store application
      notifyAdminsNewStoreApplication(formData.business_name.trim(), user.id, draftSellerId).catch(console.error);
      setSubmissionComplete(true);
    } catch (error: any) {
      console.error('Error submitting application:', error);
      toast.error(friendlyError(error), { id: 'seller-app-submit-error' });
    } finally { setIsLoading(false); }
  };

  // Safe group selection: warn if products exist before changing group (Bug 10)
  const resumeExistingStore = useCallback(async (storeId: string) => {
    try {
      const { data: fullSeller } = await supabase.from('seller_profiles').select('*').eq('id', storeId).single();
      if (!fullSeller) return;
      setExistingSeller(null);
      setDraftSellerId(fullSeller.id);
      setSelectedGroup((fullSeller as any).primary_group || null);
      loadSellerDataIntoForm(fullSeller);
      await reloadProducts(fullSeller.id);
      const savedStep = parseInt(localStorage.getItem('seller_onboarding_step') || '2', 10);
      const nextStep = (fullSeller as any).verification_status === 'draft'
        ? Math.max(2, Math.min(savedStep, NEW_ONBOARDING_TOTAL_STEPS))
        : 2;
      setStep(nextStep);
    } catch (err) {
      console.error('Failed to resume store:', err);
      toast.error('Could not load that store. Please try again.');
    }
  }, [loadSellerDataIntoForm, reloadProducts, setStep]);

  const startNewStoreOnboarding = useCallback(() => {
    setExistingSeller(null);
    setDraftSellerId(null);
    setSelectedGroup(null);
    setFormData(INITIAL_FORM);
    setDraftProducts([]);
    setStep(1);
  }, [setStep]);

  const reloadProductsAndGet = useCallback(async (sellerId: string) => {
    const { data: prods } = await supabase
      .from('products')
      .select('id, name, price, description, image_url, category, approval_status, seller_id, availability_status, action_type')
      .eq('seller_id', sellerId);
    setDraftProducts(prods || []);
    return prods || [];
  }, []);

  const applyCommerceModelChange = useCallback(async (model: string): Promise<boolean> => {
    const action = commerceModelToDefaultAction(model as any);
    setCommerceModel(model);
    try { sessionStorage.setItem('onboarding_store_action_type', action); } catch { /* */ }

    if (draftSellerId && draftProducts.length > 0) {
      const mismatched = draftProducts.filter((p) => p.action_type && p.action_type !== action);
      if (mismatched.length > 0) {
        const sync = await syncDraftProductsToStoreAction(draftSellerId, action, draftProducts);
        if (!sync.ok) {
          notify.block(sync.error || 'Could not update products for the new buyer interaction.');
          return false;
        }
        const refreshed = await reloadProductsAndGet(draftSellerId);
        if (storeActionRequiresAvailability(action)) {
          const missing = await findProductsMissingServiceListings(
            draftSellerId,
            refreshed.map((p: any) => p.id).filter(Boolean),
          );
          if (missing.length > 0) {
            notify.block(
              'Your products need service settings for Book mode. Open each product, save again, then continue.',
            );
            return false;
          }
        }
        if (sync.updatedCount > 0) {
          toast.info(
            `Updated ${sync.updatedCount} product${sync.updatedCount === 1 ? '' : 's'} to match your new buyer interaction.`,
            { id: 'commerce-sync' },
          );
        }
      }
    }

    if (draftSellerId || (selectedGroup && formData.categories.length)) {
      await saveDraft({ silent: true, allowEmptyCategories: !formData.categories.length });
    }
    return true;
  }, [
    draftSellerId, draftProducts, selectedGroup, formData.categories.length,
    setCommerceModel, storeActionRequiresAvailability, reloadProductsAndGet,
  ]);

  const handleGroupSelect = async (group: string) => {
    if (group !== selectedGroup) {
      // Bug 10: If draft products exist from the old group, clean them up
      if (draftSellerId && draftProducts.length > 0) {
        const confirmed = await notify.confirm(
          `Changing your store type will remove ${draftProducts.length} existing draft product${draftProducts.length === 1 ? '' : 's'}. This cannot be undone.`,
          {
            id: 'seller-change-store-type',
            title: 'Remove draft products?',
            okLabel: 'Change store type',
            cancelLabel: 'Keep drafts',
            priority: 'critical',
          },
        );
        if (!confirmed) return;
        // Delete orphaned products from DB
        try {
          const { error: delErr } = await supabase.from('products').delete().eq('seller_id', draftSellerId).eq('approval_status', 'draft');
          if (delErr) throw delErr;
          setDraftProducts([]);
        } catch (err) {
          console.error('Failed to delete orphaned draft products:', err);
          toast.error('Failed to remove old products. Please try again.');
          return;
        }
      }
      setSelectedGroup(group);
      setFormData(f => ({ ...f, categories: [], subcategory_preferences: { v: 1, data: {} } }));
    }
    await saveDraft({ silent: true, allowEmptyCategories: true });
    setTimeout(() => setStep(2), 350);
  };

  const selectedGroupInfo = parentGroupInfos.find(g => g.value === selectedGroup);
  const selectedGroupRow = groups.find(g => g.slug === selectedGroup);

  return {
    user, isLoading, isCheckingExisting, groupsLoading, existingSeller, draftSellerId,
    step, setStep, selectedGroup, setSelectedGroup, formData, setFormData,
    draftProducts, setDraftProducts, acceptedDeclaration, setAcceptedDeclaration,
    licenseStatus, setLicenseStatus, parentGroupInfos, groups, groupedConfigs,
    selectedGroupInfo, selectedGroupRow, handleCategoryChange, toggleOperatingDay,
    saveDraft, handleProceedToSettings, handleProceedToProducts, handleSaveDraftAndExit,
    handleSubmit, setExistingSeller, setDraftSellerId, handleStepBack, handleBackToGroupPicker, handleGroupSelect,
    reloadProducts, submissionComplete, loadSellerDataIntoForm, rejectionFeedback, setRejectionFeedback,
    resumeExistingStore, startNewStoreOnboarding,
    listingIntentPhrase, setListingIntentPhrase,
    commerceModel, setCommerceModel, applyCommerceModelChange,
    seedProductName, setSeedProductName,
    softListingTag, setSoftListingTag,
  };
}
