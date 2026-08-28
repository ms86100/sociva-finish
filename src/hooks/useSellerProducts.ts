// @ts-nocheck
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

import { useAuth } from '@/contexts/AuthContext';
import { Product, ProductCategory, SellerProfile, ProductActionType } from '@/types/Database';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useActionTypeMap } from '@/hooks/useActionTypeMap';
import { ParentGroup } from '@/types/categories';
import { useSubcategories } from '@/hooks/useSubcategories';
import type { BlockData } from '@/hooks/useAttributeBlocks';
import { INITIAL_SERVICE_FIELDS, type ServiceFieldsData } from '@/components/seller/ServiceFieldsSection';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { buildDraftKey, readDraft, useAutoSaveDraft } from '@/hooks/useProductFormDraft';
import { deriveActionFromCategoryFlags } from '@/lib/marketplace-constants';
import { notify } from '@/lib/notify';
import { isPortfolioSellerId } from '@/lib/seller-order-board';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { leadTimeFromHours, leadTimeToHours, type LeadTimeUnit } from '@/lib/lead-time';
import { resolveStockSaveValues } from '@/lib/product-stock-form';

export interface ProductFormData {
  name: string;
  description: string;
  price: string;
  mrp: string;
  prep_time_minutes: string;
  category: ProductCategory | '';
  is_veg: boolean;
  is_available: boolean;
  is_bestseller: boolean;
  is_recommended: boolean;
  is_urgent: boolean;
  image_url: string | null;
  action_type: ProductActionType;
  contact_phone: string;
  tracks_stock: boolean;
  stock_quantity: string;
  tracks_low_stock_alert: boolean;
  low_stock_threshold: string;
  subcategory_id: string;
  lead_time_value: string;
  lead_time_unit: LeadTimeUnit;
  accepts_preorders: boolean;
}

const INITIAL_FORM: ProductFormData = {
  name: '', description: '', price: '', mrp: '', prep_time_minutes: '',
  category: '', is_veg: true, is_available: true, is_bestseller: false,
  is_recommended: false, is_urgent: false, image_url: null,
  action_type: 'add_to_cart', contact_phone: '', tracks_stock: false, stock_quantity: '',
  tracks_low_stock_alert: false, low_stock_threshold: '', subcategory_id: '', lead_time_value: '', lead_time_unit: 'hours',
  accepts_preorders: false,
};

interface SellerProductDraft {
  formData: ProductFormData;
  attributeBlocks: BlockData[];
  serviceFields: ServiceFieldsData;
  editingProductId: string | null;
}

export type SellerProductFormIntent = 'list' | 'new' | 'edit';

export function useSellerProducts(opts?: { formIntent?: SellerProductFormIntent }) {
  const formIntent = opts?.formIntent ?? 'list';
  const { user, sellerProfiles, currentSellerId } = useAuth();
  const { groupedConfigs, configs } = useCategoryConfigs();
  const { data: allActions = [] } = useActionTypeMap();

  const [sellerProfile, setSellerProfile] = useState<SellerProfile | null>(null);
  const [primaryGroup, setPrimaryGroup] = useState<ParentGroup | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [licenseBlocked, setLicenseBlocked] = useState<{ blocked: boolean; status: string; licenseName: string } | null>(null);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [attributeBlocks, setAttributeBlocks] = useState<BlockData[]>([]);
  const [formData, setFormData] = useState<ProductFormData>(INITIAL_FORM);
  const patchFormData = useCallback((
    patch: Partial<ProductFormData> | ((prev: ProductFormData) => Partial<ProductFormData>),
  ) => {
    setFormData((prev) => ({
      ...prev,
      ...(typeof patch === 'function' ? patch(prev) : patch),
    }));
  }, []);
  const [serviceFields, setServiceFields] = useState<ServiceFieldsData>(INITIAL_SERVICE_FIELDS);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const activeCategoryConfig = useMemo(() => {
    if (!formData.category) return null;
    return configs.find(c => c.category === formData.category) || null;
  }, [formData.category, configs]);

  // Auto-derive action_type from category flags (category is fallback source of truth)
  const derivedActionType = useMemo<ProductActionType>(() => {
    if (!activeCategoryConfig) return 'add_to_cart';
    return deriveActionFromCategoryFlags({
      supportsCart: activeCategoryConfig.behavior.supportsCart,
      enquiryOnly: activeCategoryConfig.behavior.enquiryOnly,
      transactionType: (activeCategoryConfig as any).transactionType || (activeCategoryConfig as any).transaction_type,
    });
  }, [activeCategoryConfig]);

  // Effective action type: seller's configured default (set during onboarding) takes
  // priority over the category-derived fallback. This is the single Buyer Interaction
  // mode the seller chose during store configuration.
  const effectiveActionType = useMemo<ProductActionType>(() => {
    const stored = (sellerProfile as any)?.default_action_type as ProductActionType | undefined;
    return (stored || derivedActionType) as ProductActionType;
  }, [sellerProfile, derivedActionType]);

  // Sync formData.action_type whenever the effective type changes
  useEffect(() => {
    if (formData.action_type !== effectiveActionType) {
      setFormData(prev => ({ ...prev, action_type: effectiveActionType }));
    }
  }, [effectiveActionType]);

  const activeCategoryConfigId = activeCategoryConfig?.id || null;
  const { data: subcategories = [] } = useSubcategories(activeCategoryConfigId);

  const activeSubcategory = useMemo(() => {
    if (!formData.subcategory_id) return null;
    return subcategories.find(s => s.id === formData.subcategory_id) || null;
  }, [formData.subcategory_id, subcategories]);

  const showVegToggle = activeSubcategory?.show_veg_toggle ?? activeCategoryConfig?.formHints.showVegToggle ?? false;
  const showDurationField = activeSubcategory?.show_duration_field ?? activeCategoryConfig?.formHints.showDurationField ?? false;

  const allowedCategories = useMemo(() => {
    const sellerCats: string[] = (sellerProfile as any)?.categories || [];
    if (!primaryGroup) {
      if (sellerCats.length) {
        return configs.filter(c => sellerCats.includes(c.category));
      }
      return configs.filter(c => c.isActive !== false);
    }
    const groupConfigs = groupedConfigs[primaryGroup] || [];
    if (!sellerCats.length) return groupConfigs;
    const matched = groupConfigs.filter(c => sellerCats.includes(c.category));
    // Onboarding may sync primary_group without populating categories[] — don't block listing.
    return matched.length > 0 ? matched : groupConfigs;
  }, [primaryGroup, groupedConfigs, configs, sellerProfile]);


  // ── Draft persistence ──
  const draftKey = buildDraftKey('seller-product-draft', sellerProfile?.id || 'unknown');
  const draftData = useMemo<SellerProductDraft>(() => ({
    formData, attributeBlocks, serviceFields, editingProductId: editingProduct?.id || null,
  }), [formData, attributeBlocks, serviceFields, editingProduct]);

  const isFormDirty = formData.name.trim() !== '' || formData.description.trim() !== '' || formData.price !== '' || (formData.image_url ?? '') !== '';
  const clearDraftFn = useAutoSaveDraft(draftKey, draftData, isDialogOpen && isFormDirty);

  // Restore draft on mount (once seller profile is known) — never on explicit "add new" route
  useEffect(() => {
    if (!sellerProfile || draftRestored) return;
    // Dedicated add/edit routes manage their own form state — never restore list-dialog drafts.
    if (formIntent === 'new' || formIntent === 'edit') {
      setDraftRestored(true);
      return;
    }
    const key = buildDraftKey('seller-product-draft', sellerProfile.id);
    const saved = readDraft<SellerProductDraft>(key);
    if (saved && saved.formData && saved.formData.name?.trim()) {
      // Validate category is still allowed
      const validCategory = !saved.formData.category ||
        configs.some(c => c.category === saved.formData.category);
      if (validCategory) {
        setFormData(saved.formData);
        setAttributeBlocks(saved.attributeBlocks || []);
        setServiceFields(saved.serviceFields || INITIAL_SERVICE_FIELDS);
        if (saved.editingProductId) {
          // Verify the product still exists in the loaded list
          const existing = products.find(p => p.id === saved.editingProductId);
          if (existing) setEditingProduct(existing);
          // If product no longer exists, treat as new product (don't set editingProduct)
        }
        setIsDialogOpen(true);
        setDraftRestored(true);
      }
    }
    setDraftRestored(true);
  }, [sellerProfile, products, configs, draftRestored, formIntent]);

  useEffect(() => {
    if (user && currentSellerId && !isPortfolioSellerId(currentSellerId)) {
      fetchData(currentSellerId);
    } else if (user && !currentSellerId && sellerProfiles.length > 0) {
      fetchData(sellerProfiles[0].id);
    } else if (user && isPortfolioSellerId(currentSellerId)) {
      setSellerProfile(null);
      setProducts([]);
      setIsLoading(false);
    }
  }, [user, currentSellerId, sellerProfiles]);

  const fetchData = async (sellerId: string) => {
    if (!user) return;
    setIsLoading(true);
    try {
      // Parallel fetch: profile + products at the same time
      const [profileRes, productRes] = await Promise.all([
        supabase.from('seller_profiles')
          .select('id, user_id, business_name, description, verification_status, is_available, rating, total_reviews, avg_response_minutes, completed_order_count, cancellation_rate, last_active_at, society_id, primary_group, latitude, longitude, rejection_note, operating_days, sell_beyond_community, delivery_radius_km, cover_image_url, profile_image_url, categories, is_featured, availability_start, availability_end, accepts_cod, accepts_upi, upi_id, created_at, updated_at, fulfillment_mode, minimum_order_amount, daily_order_limit, pickup_payment_config, delivery_payment_config, default_action_type')
          .eq('id', sellerId).single(),
        supabase.from('products')
          .select('id, name, description, price, mrp, image_url, category, is_veg, is_available, is_bestseller, is_recommended, is_urgent, seller_id, action_type, contact_phone, stock_quantity, low_stock_threshold, prep_time_minutes, created_at, updated_at, approval_status, subcategory_id, lead_time_hours, accepts_preorders, specifications, discount_percentage')
          .eq('seller_id', sellerId)
          .order('is_bestseller', { ascending: false })
          .order('created_at', { ascending: false }),
      ]);

      const profile = profileRes.data;
      if (!profile) { setIsLoading(false); setSellerProfile(null); return; }
      setSellerProfile(profile as SellerProfile);
      setPrimaryGroup((profile as any).primary_group as ParentGroup | null);
      setProducts((productRes.data || []) as Product[]);

      if ((profile as any).primary_group) {
        const { data: groupData } = await supabase.from('parent_groups').select('id, requires_license, license_mandatory, license_type_name').eq('slug', (profile as any).primary_group).eq('requires_license', true).eq('license_mandatory', true).maybeSingle();
        if (groupData) {
          const { data: licensedCategories } = await supabase
            .from('category_config')
            .select('id')
            .eq('parent_group', (profile as any).primary_group)
            .eq('requires_license', true);
          const categoryIds = (licensedCategories || []).map((c: any) => c.id).filter(Boolean);
          let licenseQuery = supabase
            .from('seller_licenses')
            .select('status, submitted_at')
            .eq('seller_id', profile.id)
            .order('submitted_at', { ascending: false })
            .limit(10);
          licenseQuery = categoryIds.length
            ? licenseQuery.or(`group_id.eq.${groupData.id},category_config_id.in.(${categoryIds.join(',')})`)
            : licenseQuery.eq('group_id', groupData.id);
          const { data: licenseRows } = await licenseQuery;
          const statuses = (licenseRows || []).map((row: any) => row.status);
          const status = statuses.includes('approved') ? 'approved' : statuses.includes('pending') ? 'pending' : statuses.includes('rejected') ? 'rejected' : 'none';
          setLicenseBlocked(status !== 'approved' ? { blocked: true, status, licenseName: groupData.license_type_name || 'License' } : null);
        } else { setLicenseBlocked(null); }
      } else { setLicenseBlocked(null); }
    } catch (error) { console.error('Error fetching data:', error); }
    finally { setIsLoading(false); }
  };

  const resetForm = () => {
    const defaultCategory = allowedCategories.length === 1 ? allowedCategories[0].category as ProductCategory : '';
    setFormData({ ...INITIAL_FORM, category: defaultCategory });
    setEditingProduct(null); setAttributeBlocks([]); setServiceFields(INITIAL_SERVICE_FIELDS); setFieldErrors({});
    clearDraftFn();
  };

  /** Fresh add-product form — clears any stale edit draft from localStorage. */
  const beginNewProduct = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = async (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name, description: product.description || '', price: product.price.toString(),
      mrp: (product as any).mrp?.toString() || '', prep_time_minutes: (product as any).prep_time_minutes?.toString() || '',
      category: product.category, is_veg: product.is_veg, is_available: product.is_available,
      is_bestseller: product.is_bestseller, is_recommended: product.is_recommended, is_urgent: product.is_urgent || false,
      image_url: product.image_url, action_type: (product as any).action_type || 'add_to_cart',
      contact_phone: (product as any).contact_phone || user?.phone || '',
      tracks_stock: (product as any).stock_quantity != null,
      stock_quantity: (product as any).stock_quantity?.toString() || '',
      tracks_low_stock_alert: (product as any).low_stock_threshold != null,
      low_stock_threshold: (product as any).low_stock_threshold?.toString() || '',
      subcategory_id: (product as any).subcategory_id || '',
      ...(() => {
        const lt = leadTimeFromHours((product as any).lead_time_hours);
        return { lead_time_value: lt.value, lead_time_unit: lt.unit };
      })(),
      accepts_preorders: (product as any).accepts_preorders || false,
    });
    // Always re-fetch specifications — list cache must not wipe attribute blocks on save
    const { data: freshRow } = await supabase
      .from('products')
      .select('specifications')
      .eq('id', product.id)
      .maybeSingle();
    const specs = freshRow?.specifications ?? (product as any).specifications;
    const blocks: BlockData[] =
      specs?.blocks && Array.isArray(specs.blocks) ? (specs.blocks as BlockData[]) : [];
    setAttributeBlocks(blocks);

    const { data: sl } = await supabase.from('service_listings').select('*').eq('product_id', product.id).maybeSingle();
    if (sl) {
      setServiceFields({
        service_type: sl.service_type || 'scheduled', location_type: sl.location_type || 'at_seller',
        duration_minutes: sl.duration_minutes?.toString() || '60', buffer_minutes: sl.buffer_minutes?.toString() || '15',
        max_bookings_per_slot: sl.max_bookings_per_slot?.toString() || '1', cancellation_notice_hours: sl.cancellation_notice_hours?.toString() || '24',
        rescheduling_notice_hours: sl.rescheduling_notice_hours?.toString() || '12', preparation_instructions: (sl as any).preparation_instructions || '',
      });
    } else { setServiceFields(INITIAL_SERVICE_FIELDS); }
    setIsDialogOpen(true);
  };

  const handleSave = async (): Promise<boolean> => {
    if (!sellerProfile || !user || isSaving) return false;
    const price = parseFloat(formData.price);
    const actionNeedsPrice = !['contact_seller', 'request_quote', 'make_offer'].includes(formData.action_type);

    // Collect all errors at once
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = 'Product name is required';
    if (!formData.category) errors.category = 'Category is required';
    if (!formData.image_url) errors.image_url = 'Product image is required';
    if (actionNeedsPrice && (isNaN(price) || price <= 0)) errors.price = 'Please enter a valid price';
    if (formData.action_type === 'contact_seller' && !formData.contact_phone.trim()) {
      const fallbackPhone = user?.phone || '';
      if (fallbackPhone) {
        formData.contact_phone = fallbackPhone;
      } else {
        errors.contact_phone = 'Phone number is required for Contact Seller action';
      }
    }
    if (formData.contact_phone.trim() && !/^[\d+\-\s()]{7,15}$/.test(formData.contact_phone.trim())) errors.contact_phone = 'Please enter a valid phone number';

    const stockResolved = resolveStockSaveValues(formData);
    Object.assign(errors, stockResolved.errors);

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const fieldLabels: Record<string, string> = {
        name: 'Product Name', category: 'Category', image_url: 'Product Image',
        price: 'Price', contact_phone: 'Contact Phone',
        stock_quantity: 'Current Stock', low_stock_threshold: 'Low Stock Alert',
      };
      const missingNames = Object.keys(errors).map(k => fieldLabels[k] || k);
      toast.error(`Missing: ${missingNames.join(', ')}`, { id: 'product-validation' });
      // Expose first error key for step navigation
      (window as any).__productFormFirstError = Object.keys(errors)[0];
      return false;
    }
    setFieldErrors({});

    setIsSaving(true);
    try {
      const sellerCats: string[] = (sellerProfile as any)?.categories || [];
      if (formData.category && !sellerCats.includes(formData.category)) {
        const { error: catSyncErr } = await supabase
          .from('seller_profiles')
          .update({ categories: [...new Set([...sellerCats, formData.category])] } as any)
          .eq('id', sellerProfile.id);
        if (catSyncErr) {
          console.error('Could not sync store categories before product save:', catSyncErr);
          toast.error('Could not enable this category for your store. Try again or contact support.', { id: 'product-category-sync' });
          return false;
        }
      }

      const prepTime = formData.prep_time_minutes ? parseInt(formData.prep_time_minutes) : null;
      const mrp = formData.mrp ? parseFloat(formData.mrp) : null;
      const leadVal = formData.lead_time_value ? parseFloat(formData.lead_time_value) : NaN;
      const lead_time_hours = leadTimeToHours(leadVal, formData.lead_time_unit);
      const { stockQty, lowStockThreshold } = stockResolved;
    // effectiveActionType (declared at hook scope) is the single source of truth
    // for buyer interaction — it uses the seller's configured default.
    const productData = {
        seller_id: sellerProfile.id, name: formData.name.trim(), description: formData.description.trim() || null,
        price: isNaN(price) ? 0 : price, mrp: (mrp && !isNaN(mrp) && mrp > 0) ? mrp : null,
        prep_time_minutes: (prepTime && !isNaN(prepTime) && prepTime > 0) ? prepTime : null,
        category: formData.category, is_veg: formData.is_veg, is_available: formData.is_available,
        is_bestseller: formData.is_bestseller, is_recommended: formData.is_recommended, is_urgent: formData.is_urgent,
        image_url: formData.image_url, action_type: effectiveActionType, contact_phone: formData.contact_phone.trim() || null,
        stock_quantity: (stockQty !== null && !isNaN(stockQty) && stockQty >= 0) ? stockQty : null,
        low_stock_threshold: (lowStockThreshold !== null && !isNaN(lowStockThreshold) && lowStockThreshold > 0) ? lowStockThreshold : null, subcategory_id: formData.subcategory_id || null,
        lead_time_hours,
        accepts_preorders: formData.accepts_preorders,
        specifications: attributeBlocks.length > 0 ? { blocks: attributeBlocks } : null,
        ...(editingProduct
          ? {
              approval_status: (() => {
                const ep = editingProduct as any;
                const contentChanged = formData.name.trim() !== ep.name || (formData.description.trim() || null) !== (ep.description || null) || parseFloat(formData.price) !== ep.price || formData.category !== ep.category || formData.image_url !== ep.image_url || formData.action_type !== (ep.action_type || 'add_to_cart') || formData.subcategory_id !== (ep.subcategory_id || '') || (parseFloat(formData.mrp) || null) !== (ep.mrp || null) || JSON.stringify(attributeBlocks) !== JSON.stringify(ep.specifications?.blocks || []);
                if (contentChanged && ['approved', 'rejected'].includes(ep.approval_status)) return 'pending';
                return ep.approval_status;
              })(),
              ...((() => { const ep = editingProduct as any; if (ep.approval_status === 'pending') return { updated_while_pending: true }; return {}; })()),
              ...((() => {
                const ep = editingProduct as any;
                const contentChanged = formData.name.trim() !== ep.name || (formData.description.trim() || null) !== (ep.description || null) || parseFloat(formData.price) !== ep.price || formData.category !== ep.category || formData.image_url !== ep.image_url;
                return contentChanged && ['approved', 'rejected'].includes(ep.approval_status) ? { rejection_note: null } : {};
              })()),
            }
          : { approval_status: 'draft' as const }),
      };

      // Decide whether this category needs service settings
      const actionRequiresAvailability = (() => {
        const ac = allActions.find(a => a.action_type === effectiveActionType);
        return ac?.requires_availability ?? false;
      })();
      const servicePayload = actionRequiresAvailability ? {
        service_type: serviceFields.service_type,
        location_type: serviceFields.location_type,
        duration_minutes: parseInt(serviceFields.duration_minutes) || 60,
        buffer_minutes: parseInt(serviceFields.buffer_minutes) || 0,
        max_bookings_per_slot: parseInt(serviceFields.max_bookings_per_slot) || 1,
        cancellation_notice_hours: parseInt(serviceFields.cancellation_notice_hours) || 24,
        rescheduling_notice_hours: parseInt(serviceFields.rescheduling_notice_hours) || 12,
        preparation_instructions: serviceFields.preparation_instructions || '',
      } : null;

      let savedProductId: string;
      if (editingProduct) {
        // Save snapshot of previous version before updating (for admin diff review)
        const ep = editingProduct as any;
        const snapshotFields = {
          name: ep.name, price: ep.price, mrp: ep.mrp, category: ep.category,
          description: ep.description, image_url: ep.image_url, is_veg: ep.is_veg,
          specifications: ep.specifications, action_type: ep.action_type,
          is_bestseller: ep.is_bestseller, is_recommended: ep.is_recommended,
          is_urgent: ep.is_urgent, is_available: ep.is_available,
          stock_quantity: ep.stock_quantity, low_stock_threshold: ep.low_stock_threshold,
          prep_time_minutes: ep.prep_time_minutes, lead_time_hours: ep.lead_time_hours,
          accepts_preorders: ep.accepts_preorders, contact_phone: ep.contact_phone,
          subcategory_id: ep.subcategory_id,
        };
        const anyContentChanged = JSON.stringify(snapshotFields) !== JSON.stringify({
          name: productData.name, price: productData.price, mrp: productData.mrp, category: productData.category,
          description: productData.description, image_url: productData.image_url, is_veg: productData.is_veg,
          specifications: productData.specifications, action_type: productData.action_type,
          is_bestseller: productData.is_bestseller, is_recommended: productData.is_recommended,
          is_urgent: productData.is_urgent, is_available: productData.is_available,
          stock_quantity: productData.stock_quantity, low_stock_threshold: productData.low_stock_threshold,
          prep_time_minutes: productData.prep_time_minutes, lead_time_hours: productData.lead_time_hours,
          accepts_preorders: productData.accepts_preorders, contact_phone: productData.contact_phone,
          subcategory_id: productData.subcategory_id,
        });
        if (anyContentChanged && ['approved', 'rejected'].includes(ep.approval_status)) {
          const { error: snapErr } = await supabase.from('product_edit_snapshots').insert({
            product_id: editingProduct.id,
            snapshot: snapshotFields,
          } as any);
          if (snapErr) {
            console.error('Failed to save edit snapshot:', snapErr);
            toast.error('Could not save version history — product not updated. Try again.');
            return false;
          }
        }
        const { error } = await (supabase as any).rpc('update_product_with_service', {
          p_product_id: editingProduct.id,
          p_product: productData,
          p_service: servicePayload,
        });
        if (error) throw error;
        savedProductId = editingProduct.id;
      } else {
        const { data: newId, error } = await (supabase as any).rpc('save_product_with_service', {
          p_product: productData,
          p_service: servicePayload,
        });
        if (error) throw error;
        savedProductId = newId as string;
      }

      if (actionRequiresAvailability) {
        toast.info('Save your Store Hours to generate booking slots', { id: 'slots-hint' });
      }
      setIsDialogOpen(false);
      resetForm();
      if (sellerProfile) fetchData(sellerProfile.id);
      showFeedback({
        title: editingProduct ? 'Product updated' : 'Product saved successfully',
        variant: 'success',
      });
      return true;
    } catch (error: any) {
      console.error('Error saving product:', error);
      const msg = String(error?.message || '');
      if (msg.includes('allowed categories')) {
        const catLabel = configs.find((c) => c.category === formData.category)?.displayName || formData.category;
        toast.error(`"${catLabel}" isn't enabled for this store yet. Pick a category from your store setup or contact support.`, { id: 'product-save-error' });
      } else {
        toast.error(friendlyError(error), { id: 'product-save-error' });
      }
      return false;
    }
    finally { setIsSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { data: activeBookings, error: bookingCheckErr } = await supabase.from('service_bookings').select('id').eq('product_id', deleteTarget.id).not('status', 'in', '(cancelled,completed,no_show)').limit(1);
      if (bookingCheckErr) throw bookingCheckErr;
      if (activeBookings && activeBookings.length > 0) { notify.block('Cannot delete: this product has active bookings. Cancel or complete them first.'); setDeleteTarget(null); return; }
      const { error } = await supabase.from('products').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      showFeedback({
        title: 'Product deleted',
        variant: 'success',
      });
      if (sellerProfile) fetchData(sellerProfile.id);
    } catch (error) { console.error('Error deleting product:', error); toast.error(friendlyError(error), { id: 'product-delete-error' }); }
    finally { setDeleteTarget(null); }
  };

  const toggleAvailability = async (product: Product) => {
    const status = (product as any).approval_status || 'draft';
    if (status !== 'approved') { toast.error('Submit for review first — only approved products can be toggled.', { id: 'product-toggle-blocked' }); return; }
    try {
      const { error } = await supabase.from('products').update({ is_available: !product.is_available }).eq('id', product.id);
      if (error) throw error;
      if (sellerProfile) fetchData(sellerProfile.id);
    } catch (error) { console.error('Error updating availability:', error); toast.error('Failed to update', { id: 'product-toggle-error' }); }
  };

  const isCurrentCategoryService = useMemo(() => {
    const ac = allActions.find(a => a.action_type === effectiveActionType);
    return ac?.requires_availability ?? false;
  }, [effectiveActionType, allActions]);
  const currentCategorySupportsAddons = activeSubcategory?.supports_addons ?? activeCategoryConfig?.supportsAddons ?? false;
  const currentCategorySupportsRecurring = activeSubcategory?.supports_recurring ?? activeCategoryConfig?.supportsRecurring ?? false;
  const currentCategorySupportsStaffAssignment = activeSubcategory?.supports_staff_assignment ?? activeCategoryConfig?.supportsStaffAssignment ?? false;

  /**
   * Validate fields owned by a single step. Returns errors map (empty if valid).
   * Also writes to fieldErrors so inputs can surface inline messages.
   */
  const validateStep = (stepKey: string): Record<string, string> => {
    const errors: Record<string, string> = {};
    const actionNeedsPrice = !['contact_seller', 'request_quote', 'make_offer'].includes(effectiveActionType);
    if (stepKey === 'basics') {
      if (!formData.image_url) errors.image_url = 'Product image is required';
      if (!formData.name.trim()) errors.name = 'Product name is required';
      if (!formData.category) errors.category = 'Category is required';
    } else if (stepKey === 'pricing') {
      const price = parseFloat(formData.price);
      if (actionNeedsPrice && (isNaN(price) || price <= 0)) errors.price = 'Please enter a valid price';
    } else if (stepKey === 'config') {
      if (effectiveActionType === 'contact_seller') {
        const phone = formData.contact_phone.trim() || (user?.phone || '');
        if (!phone) errors.contact_phone = 'Phone number is required for Contact Seller action';
        else if (!/^[\d+\-\s()]{7,15}$/.test(phone)) errors.contact_phone = 'Please enter a valid phone number';
      }
    } else if (stepKey === 'visibility') {
      Object.assign(errors, resolveStockSaveValues(formData).errors);
    } else if (stepKey === 'service') {
      if (isCurrentCategoryService) {
        const dur = parseInt(serviceFields.duration_minutes);
        if (!serviceFields.service_type) errors.service_type = 'Service type is required';
        if (!serviceFields.location_type) errors.location_type = 'Location is required';
        if (isNaN(dur) || dur < 5) errors.duration_minutes = 'Duration must be at least 5 minutes';
      }
    }
    setFieldErrors(prev => {
      // Clear stale errors for this step's fields, then merge new ones
      const stepKeys = ['name','image_url','category','price','contact_phone','stock_quantity','low_stock_threshold','service_type','location_type','duration_minutes'];
      const next = { ...prev };
      stepKeys.forEach(k => { delete next[k]; });
      return { ...next, ...errors };
    });
    return errors;
  };

  return {
    user, sellerProfile, primaryGroup, products, isLoading, isDialogOpen, setIsDialogOpen,
    editingProduct, isSaving, licenseBlocked, isBulkOpen, setIsBulkOpen,
    attributeBlocks, setAttributeBlocks, formData, setFormData, patchFormData, deleteTarget, setDeleteTarget,
    activeCategoryConfig, showVegToggle, showDurationField, allowedCategories, subcategories,
    configs, sellerProfiles, resetForm, beginNewProduct, openEditDialog, handleSave, confirmDelete,
    toggleAvailability, fetchData, serviceFields, setServiceFields, isCurrentCategoryService,
    currentCategorySupportsAddons, currentCategorySupportsRecurring, currentCategorySupportsStaffAssignment,
    draftRestored, clearDraftFn, fieldErrors, setFieldErrors, derivedActionType, effectiveActionType, validateStep,
  };
}
