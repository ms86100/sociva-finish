// @ts-nocheck
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

import { Button } from '@/components/ui/button';
import { useActionTypeMap, useCategoryAllowedActions, getCheckoutModeDescription } from '@/hooks/useActionTypeMap';
import { ActionTypeSelector } from '@/components/seller/ActionTypeSelector';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LeadTimeField } from '@/components/seller/LeadTimeField';
import { leadTimeFromHours, leadTimeToHours, parseLeadTimeInput } from '@/lib/lead-time';
import { parsePrepTimeMinutes } from '@/lib/prep-time-minutes';
import {
  PREORDERS_TOGGLE_HELP,
  PREORDERS_TOGGLE_LABEL,
  PREP_TIME_HELP,
  PREP_TIME_LABEL,
  PREP_TIME_PLACEHOLDER,
} from '@/lib/product-timing-copy';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { VegBadge } from '@/components/ui/veg-badge';
import { ProductImageUpload } from '@/components/ui/product-image-upload';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Trash2, Loader2, Package, Percent, CheckCircle2, Info, Pencil } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { friendlyError } from '@/lib/utils';
import { AttributeBlockBuilder } from '@/components/seller/AttributeBlockBuilder';
import { useBlockLibrary, filterByCategory, type BlockData } from '@/hooks/useAttributeBlocks';
import { useCurrency } from '@/hooks/useCurrency';
import { ServiceFieldsSection, INITIAL_SERVICE_FIELDS, type ServiceFieldsData } from '@/components/seller/ServiceFieldsSection';
import { ProductFormPreviewPanel, ProductFormPreviewMobile } from '@/components/seller/ProductFormPreview';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { resolveStockSaveValues } from '@/lib/product-stock-form';

interface DraftProduct {
  id?: string;
  name: string;
  price: number;
  mrp?: number | null;
  discount_percentage?: number | null;
  description: string;
  category: string;
  is_veg: boolean;
  image_url: string;
  prep_time_minutes?: number | null;
  stock_quantity?: number | null;
  low_stock_threshold?: number | null;
  action_type?: string;
  subcategory_id?: string | null;
  lead_time_hours?: number | null;
  accepts_preorders?: boolean;
  approval_status?: string;
}

interface DraftProductManagerProps {
  sellerId: string;
  categories: string[];
  products: DraftProduct[];
  onProductsChange: (products: DraftProduct[]) => void;
  beforePick?: () => void | Promise<void>;
  defaultActionType?: string;
  /** Prefill first draft product name from listing intent */
  seedProductName?: string;
  /** Prefill subcategory from onboarding taxonomy suggestion */
  seedSubcategoryId?: string | null;
}

// Action-type-driven check: does this product's action_type require availability?
function doesActionRequireAvailability(actionType: string | undefined, allActions: { action_type: string; requires_availability: boolean }[]): boolean {
  if (!actionType) return false;
  const config = allActions.find(a => a.action_type === actionType);
  return config?.requires_availability ?? false;
}

export function DraftProductManager({
  sellerId,
  categories,
  products,
  onProductsChange,
  beforePick,
  defaultActionType,
  seedProductName,
  seedSubcategoryId,
}: DraftProductManagerProps) {
  const { user } = useAuth();
  const { data: allActions = [] } = useActionTypeMap();
  const { data: blockLibrary = [] } = useBlockLibrary();
  const DRAFT_KEY = `draft-product-form-${sellerId}`;

  // Fallback: if the parent didn't pass a defaultActionType, fetch the seller's
  // saved choice from the DB so the dropdown still locks to a single mode.
  const [fetchedDefaultActionType, setFetchedDefaultActionType] = useState<string | null>(null);
  useEffect(() => {
    if (defaultActionType || !sellerId) return;
    let cancelled = false;
    supabase
      .from('seller_profiles')
      .select('default_action_type')
      .eq('id', sellerId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && (data as any)?.default_action_type) {
          setFetchedDefaultActionType((data as any).default_action_type);
        }
      });
    return () => { cancelled = true; };
  }, [sellerId, defaultActionType]);
  const effectiveDefaultActionType = defaultActionType || fetchedDefaultActionType || null;

  // Restore persisted draft from localStorage on mount
  const restoredDraft = useMemo(() => {
    try {
      // Try localStorage first, fall back to sessionStorage for migration
      const raw = localStorage.getItem(DRAFT_KEY) || sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        // Clean up legacy sessionStorage
        sessionStorage.removeItem(DRAFT_KEY);
        const parsed = JSON.parse(raw);
        // Validate editingIndex bounds
        if (parsed?.editingIndex != null && parsed.editingIndex >= products.length) {
          parsed.editingIndex = null; // out of bounds → treat as new
        }
        // Validate category
        if (parsed?.newProduct?.category && categories.length > 0 && !categories.includes(parsed.newProduct.category)) {
          parsed.newProduct.category = categories[0] || '';
        }
        return parsed;
      }
    } catch { /* ignore */ }
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isAdding, setIsAdding] = useState(restoredDraft?.isAdding ?? false);
  const [editingIndex, setEditingIndex] = useState<number | null>(restoredDraft?.editingIndex ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [attributeBlocks, setAttributeBlocks] = useState<BlockData[]>(restoredDraft?.attributeBlocks ?? []);
  const [serviceFields, setServiceFields] = useState<ServiceFieldsData>(restoredDraft?.serviceFields ?? INITIAL_SERVICE_FIELDS);
  
  const { configs } = useCategoryConfigs();
  const { formatPrice, currencySymbol } = useCurrency();
  const [newProduct, setNewProduct] = useState<DraftProduct>(restoredDraft?.newProduct ?? {
    name: seedProductName || '',
    price: 0,
    mrp: null,
    discount_percentage: null,
    description: '',
    category: categories[0] || '',
    is_veg: true,
    image_url: '',
    prep_time_minutes: null,
    action_type: effectiveDefaultActionType || 'add_to_cart',
    subcategory_id: seedSubcategoryId || null,
  });
  const [trackStock, setTrackStock] = useState(() => restoredDraft?.trackStock ?? (restoredDraft?.newProduct?.stock_quantity != null));
  const [trackLowStockAlert, setTrackLowStockAlert] = useState(() => (
    restoredDraft?.trackLowStockAlert ?? (restoredDraft?.newProduct?.low_stock_threshold != null)
  ));
  const [stockQuantityInput, setStockQuantityInput] = useState(() => {
    if (restoredDraft?.stockQuantityInput != null) return restoredDraft.stockQuantityInput;
    const qty = restoredDraft?.newProduct?.stock_quantity;
    return qty != null ? String(qty) : '';
  });
  const [lowStockThresholdInput, setLowStockThresholdInput] = useState(() => {
    if (restoredDraft?.lowStockThresholdInput != null) return restoredDraft.lowStockThresholdInput;
    const threshold = restoredDraft?.newProduct?.low_stock_threshold;
    return threshold != null ? String(threshold) : '';
  });
  const [prepTimeInput, setPrepTimeInput] = useState(() => {
    if (restoredDraft?.prepTimeInput != null) return restoredDraft.prepTimeInput;
    const prep = restoredDraft?.newProduct?.prep_time_minutes;
    return prep != null && prep > 0 ? String(prep) : '';
  });

  // Keep category in sync if categories arrive after mount (common on draft resume)
  useEffect(() => {
    if (!newProduct.category && categories[0]) {
      setNewProduct((prev) => ({ ...prev, category: categories[0] }));
    }
  }, [categories, newProduct.category]);

  // Seed name + subcategory once from intent when starting a fresh add form
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (!seedProductName?.trim() && !seedSubcategoryId) return;
    if (restoredDraft?.newProduct?.name) return;
    if (products.length > 0 && !isAdding) return;
    seededRef.current = true;
    setNewProduct((prev) => ({
      ...prev,
      name: prev.name.trim() ? prev.name : (seedProductName?.trim() || prev.name),
      subcategory_id: prev.subcategory_id || seedSubcategoryId || null,
      action_type: prev.action_type || effectiveDefaultActionType || 'add_to_cart',
      category: prev.category || categories[0] || '',
    }));
    if (!isAdding && products.length === 0) setIsAdding(true);
  }, [seedProductName, seedSubcategoryId, restoredDraft, products.length, isAdding, effectiveDefaultActionType, categories]);

  // Auto-persist product form draft to localStorage with debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!isAdding) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          isAdding, editingIndex, newProduct, attributeBlocks, serviceFields,
          trackStock, trackLowStockAlert, stockQuantityInput, lowStockThresholdInput, prepTimeInput,
        }));
      } catch { /* quota exceeded — non-critical */ }
    }, 500);
    return () => clearTimeout(debounceRef.current);
  }, [isAdding, editingIndex, newProduct, attributeBlocks, serviceFields, trackStock, trackLowStockAlert, stockQuantityInput, lowStockThresholdInput, prepTimeInput, DRAFT_KEY]);

  // Get form hints for the selected category
  const activeConfig = useMemo(() => {
    return configs.find(c => c.category === newProduct.category) || null;
  }, [configs, newProduct.category]);

  const showVegToggle = activeConfig?.formHints.showVegToggle ?? false;
  const showDurationField = activeConfig?.formHints.showDurationField ?? false;
  const isService = useMemo(() => doesActionRequireAvailability(newProduct.action_type || effectiveDefaultActionType, allActions), [newProduct.action_type, effectiveDefaultActionType, allActions]);

  const supportsAddons = (activeConfig as any)?.supportsAddons ?? false;
  const supportsRecurring = (activeConfig as any)?.supportsRecurring ?? false;
  const supportsStaffAssignment = (activeConfig as any)?.supportsStaffAssignment ?? false;

  const requiresPrice = useMemo(() => {
    if (!activeConfig) return true;
    return activeConfig.behavior.supportsCart || !activeConfig.behavior.enquiryOnly;
  }, [activeConfig]);

  // Auto-compute discount when MRP or price changes
  const computedDiscount = useMemo(() => {
    if (newProduct.mrp && newProduct.mrp > 0 && newProduct.price > 0 && newProduct.mrp > newProduct.price) {
      return Math.round(((newProduct.mrp - newProduct.price) / newProduct.mrp) * 100);
    }
    return null;
  }, [newProduct.mrp, newProduct.price]);

  // Adapter: map DraftProduct → ProductFormData for preview components
  const previewFormData = useMemo(() => ({
    name: newProduct.name,
    description: newProduct.description,
    price: newProduct.price ? String(newProduct.price) : '',
    mrp: newProduct.mrp ? String(newProduct.mrp) : '',
    prep_time_minutes: newProduct.prep_time_minutes ? String(newProduct.prep_time_minutes) : '',
    category: (newProduct.category || '') as any,
    is_veg: newProduct.is_veg,
    is_available: true,
    is_bestseller: false,
    is_recommended: false,
    is_urgent: false,
    image_url: newProduct.image_url || null,
    action_type: (newProduct.action_type || 'add_to_cart') as any,
    contact_phone: '',
    stock_quantity: '',
    low_stock_threshold: '5',
    subcategory_id: '',
    lead_time_hours: '',
    accepts_preorders: false,
  }), [newProduct]);

  const handleAddProduct = async () => {
    const errors: Record<string, string> = {};
    if (!newProduct.name.trim()) errors.name = 'Product name is required';
    if (requiresPrice && newProduct.price <= 0) errors.price = 'Price must be greater than 0';
    if (newProduct.mrp && newProduct.mrp > 0 && newProduct.price > newProduct.mrp) errors.price = 'Price cannot exceed MRP';
    if (!newProduct.image_url.trim()) errors.image_url = 'Product image is required';

    const stockResolved = resolveStockSaveValues({
      tracks_stock: trackStock,
      stock_quantity: stockQuantityInput,
      tracks_low_stock_alert: trackLowStockAlert,
      low_stock_threshold: lowStockThresholdInput,
    });
    Object.assign(errors, stockResolved.errors);

    if (showDurationField && !isService && prepTimeInput.trim()) {
      const prepParsed = parsePrepTimeMinutes(prepTimeInput);
      if (prepParsed.error) errors.prep_time_minutes = prepParsed.error;
    }

    if (newProduct.accepts_preorders) {
      const lt = leadTimeFromHours(newProduct.lead_time_hours);
      const leadParsed = parseLeadTimeInput(lt.value, lt.unit);
      if (!leadParsed.hours) {
        errors.lead_time_hours = leadParsed.error || 'Set a pre-order lead time when Accept Pre-Orders is on.';
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const count = Object.keys(errors).length;
      toast.error(Object.values(errors)[0] || `Please fix ${count} field${count > 1 ? 's' : ''} highlighted below`, { id: 'product-validation' });
      const firstKey = Object.keys(errors)[0];
      document.getElementById(`prod-${firstKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setFieldErrors({});

    setIsSaving(true);
    const isEditing = editingIndex !== null;
    const existingId = isEditing ? products[editingIndex]?.id : undefined;

    try {
      const resolvedApprovalStatus = (() => {
        if (!isEditing || !existingId) return 'draft';
        const existing = products[editingIndex!];
        const currentStatus = (existing as any).approval_status || 'draft';
        if (['approved', 'rejected'].includes(currentStatus)) return 'pending';
        return currentStatus;
      })();

      const prepParsed = showDurationField && !isService && prepTimeInput.trim()
        ? parsePrepTimeMinutes(prepTimeInput)
        : { minutes: null as number | null };

      const productPayload = {
        seller_id: sellerId,
        name: newProduct.name.trim(),
        price: newProduct.price || 0,
        mrp: newProduct.mrp && newProduct.mrp > 0 ? newProduct.mrp : null,
        description: newProduct.description.trim() || null,
        category: newProduct.category,
        is_veg: newProduct.is_veg,
        image_url: newProduct.image_url.trim() || null,
        is_available: true,
        approval_status: resolvedApprovalStatus,
        prep_time_minutes: prepParsed.minutes,
        specifications: attributeBlocks.length > 0 ? { blocks: attributeBlocks } : null,
        stock_quantity: stockResolved.stockQty,
        low_stock_threshold: stockResolved.lowStockThreshold,
        action_type: (() => {
          const resolvedActionType = effectiveDefaultActionType || newProduct.action_type || 'add_to_cart';
          if (effectiveDefaultActionType && newProduct.action_type && newProduct.action_type !== effectiveDefaultActionType) {
            console.warn(`[Onboarding] action_type mismatch: form=${newProduct.action_type}, default=${effectiveDefaultActionType}. Using default.`);
          }
          return resolvedActionType;
        })(),
        subcategory_id: newProduct.subcategory_id || null,
        lead_time_hours: newProduct.lead_time_hours ?? null,
        accepts_preorders: newProduct.accepts_preorders || false,
        ...(isEditing ? { rejection_note: null } : {}),
      };

      let savedProductId: string;

      if (isEditing && existingId) {
        // Update existing product
        const { data, error } = await supabase
          .from('products')
          .update(productPayload as any)
          .eq('id', existingId)
          .select()
          .single();
        if (error) throw error;
        savedProductId = data.id;
      } else {
        // Insert new product
        const { data, error } = await supabase
          .from('products')
          .insert(productPayload as any)
          .select()
          .single();
        if (error) throw error;
        savedProductId = data.id;
      }

      // Save service listing if service category — mandatory; roll back product on failure
      if (isService && savedProductId) {
        const { error: slError } = await supabase.from('service_listings').upsert({
          product_id: savedProductId,
          service_type: serviceFields.service_type,
          location_type: serviceFields.location_type,
          duration_minutes: parseInt(serviceFields.duration_minutes) || 60,
          buffer_minutes: parseInt(serviceFields.buffer_minutes) || 0,
          max_bookings_per_slot: parseInt(serviceFields.max_bookings_per_slot) || 1,
          cancellation_notice_hours: parseInt(serviceFields.cancellation_notice_hours) || 24,
          rescheduling_notice_hours: parseInt(serviceFields.rescheduling_notice_hours) || 12,
        } as any, { onConflict: 'product_id' });

        if (slError) {
          console.error('Service listing upsert failed:', slError);
          if (!isEditing) {
            await supabase.from('products').delete().eq('id', savedProductId);
          }
          throw new Error(friendlyError(slError) || 'Could not save service settings. Please try again.');
        }

        toast.info('Save your Store Hours to generate booking slots', { id: 'slots-hint' });
      }

      if (isEditing) {
        const updated = [...products];
        updated[editingIndex] = { ...newProduct, id: savedProductId, discount_percentage: computedDiscount };
        onProductsChange(updated);
        showFeedback({
        title: 'Product updated',
        variant: 'success',
      });
      } else {
        onProductsChange([...products, { ...newProduct, id: savedProductId, discount_percentage: computedDiscount }]);
        showFeedback({
        title: 'Product added',
        variant: 'success',
      });
      }

      resetForm();
    } catch (error: any) {
      console.error('Error saving product:', error);
      toast.error(friendlyError(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveProduct = async (index: number) => {
    const product = products[index];
    if (product.id) {
      const { error } = await supabase.from('products').delete().eq('id', product.id);
      if (error) {
        console.error('Error deleting product:', error);
        toast.error(friendlyError(error) || 'Failed to delete product');
        return;
      }
    }
    const updated = products.filter((_, i) => i !== index);
    onProductsChange(updated);
  };

  const handleEditProduct = async (index: number) => {
    const product = products[index];
    setNewProduct({ ...product });
    setTrackStock(product.stock_quantity != null);
    setTrackLowStockAlert(product.low_stock_threshold != null);
    setStockQuantityInput(product.stock_quantity != null ? String(product.stock_quantity) : '');
    setLowStockThresholdInput(product.low_stock_threshold != null ? String(product.low_stock_threshold) : '');
    setPrepTimeInput(product.prep_time_minutes != null && product.prep_time_minutes > 0 ? String(product.prep_time_minutes) : '');
    setEditingIndex(index);
    setIsAdding(true);

    // Load saved attribute blocks from DB
    if (product.id) {
      try {
        const { data } = await supabase
          .from('products')
          .select('specifications')
          .eq('id', product.id)
          .single();
        const specs = data?.specifications as any;
        let blocks: BlockData[] = specs?.blocks && Array.isArray(specs.blocks) ? specs.blocks : [];
        if (blocks.length === 0 && product.category) {
          const defaultBlocks = filterByCategory(blockLibrary, product.category);
          blocks = defaultBlocks.map(b => ({ type: b.block_type, data: {} }));
        }
        setAttributeBlocks(blocks);
      } catch {
        setAttributeBlocks([]);
      }

      // Load service fields if product's action_type requires availability
      if (doesActionRequireAvailability((product as any).action_type, allActions)) {
        try {
          const { data: sl } = await supabase
            .from('service_listings')
            .select('*')
            .eq('product_id', product.id)
            .maybeSingle();
          if (sl) {
            setServiceFields({
              service_type: sl.service_type || 'one_time',
              location_type: sl.location_type || 'onsite',
              duration_minutes: String(sl.duration_minutes || 60),
              buffer_minutes: String(sl.buffer_minutes || 0),
              max_bookings_per_slot: String(sl.max_bookings_per_slot || 1),
              cancellation_notice_hours: String(sl.cancellation_notice_hours || 24),
              rescheduling_notice_hours: String(sl.rescheduling_notice_hours || 12),
              preparation_instructions: (sl as any).preparation_instructions || '',
            });
          }
        } catch {
          // keep defaults
        }
      }
    }
  };

  const resetForm = () => {
    setNewProduct({
      name: '',
      price: 0,
      mrp: null,
      discount_percentage: null,
      description: '',
      category: categories[0] || '',
      is_veg: true,
      image_url: '',
      prep_time_minutes: null,
      stock_quantity: null,
      low_stock_threshold: null,
      action_type: effectiveDefaultActionType || 'add_to_cart',
      subcategory_id: seedSubcategoryId || null,
    });
    setTrackStock(false);
    setTrackLowStockAlert(false);
    setStockQuantityInput('');
    setLowStockThresholdInput('');
    setPrepTimeInput('');
    setIsAdding(false);
    setFieldErrors({});
    setEditingIndex(null);
    setAttributeBlocks([]);
    setServiceFields(INITIAL_SERVICE_FIELDS);
    localStorage.removeItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
  };

  const beginAddProduct = () => {
    resetForm();
    setIsAdding(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base">Your Products / Services</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {products.length === 0
              ? 'Add at least one item to continue'
              : `${products.length} item${products.length !== 1 ? 's' : ''} added`}
          </p>
        </div>
        <span className="text-sm font-medium text-muted-foreground">
          {products.length} item{products.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Friendly empty state */}
      {products.length === 0 && !isAdding && (
        <div className="flex flex-col items-center justify-center py-8 px-4 rounded-xl border-2 border-dashed border-muted-foreground/20 bg-muted/30 text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <Package size={28} className="text-primary" />
          </div>
          <p className="font-medium text-sm mb-1">Your catalog is empty</p>
          <p className="text-xs text-muted-foreground max-w-[240px]">
            Add your first product — even one item is enough to get started!
          </p>
        </div>
      )}

      {/* Success encouragement after first product */}
      {products.length > 0 && products.length <= 2 && !isAdding && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 border border-success/20">
          <CheckCircle2 size={16} className="text-success flex-shrink-0" />
          <p className="text-xs text-success">
            {products.length === 1
              ? "Great start! Add more items or continue to review."
              : "You're on your way! Add more or continue when ready."}
          </p>
        </div>
      )}

      {/* Existing Products */}
      {products.map((product, index) => {
        const prodConfig = configs.find(c => c.category === product.category);
        const showVeg = prodConfig?.formHints.showVegToggle ?? false;
        return (
          <Card key={product.id || index} className="bg-muted/30">
            <CardContent className="p-3">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    <Package size={20} className="text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {showVeg && <VegBadge isVeg={product.is_veg} size="sm" />}
                    <span className="font-medium text-sm truncate">{product.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-sm font-bold text-primary">
                      {product.price > 0 ? formatPrice(product.price) : 'Price on request'}
                    </p>
                    {product.mrp && product.mrp > product.price && (
                      <>
                        <span className="text-xs text-muted-foreground line-through">{formatPrice(product.mrp)}</span>
                        <span className="text-[10px] font-bold text-success bg-success/10 px-1.5 py-0.5 rounded">
                          {product.discount_percentage}% OFF
                        </span>
                      </>
                    )}
                  </div>
                  {product.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{product.description}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground" onClick={() => handleEditProduct(index)}>
                    <Pencil size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(index)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Add New Product Form */}
      {isAdding ? (
        <>
        <div className="flex gap-6 items-start">
          <Card className="border-primary/30 flex-1 min-w-0">
            <CardContent className="p-4 space-y-3">
              <h4 className="font-medium text-sm">{editingIndex !== null ? 'Edit Product / Service' : 'New Product / Service'}</h4>
              <div className="space-y-2">
                <Label htmlFor="prod-name" className="text-xs">Name *</Label>
                <Input
                  id="prod-name"
                  placeholder={activeConfig?.formHints.namePlaceholder || "e.g., Product Name"}
                  value={newProduct.name}
                  onChange={(e) => {
                    setNewProduct({ ...newProduct, name: e.target.value });
                    if (fieldErrors.name) setFieldErrors(prev => { const { name, ...rest } = prev; return rest; });
                  }}
                  className={fieldErrors.name ? 'border-destructive' : ''}
                />
                {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
              </div>

              {/* Price + MRP Row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="prod-price" className="text-xs">
                    {activeConfig?.formHints.priceLabel || 'Selling Price'} ({currencySymbol}) {requiresPrice ? '*' : ''}
                  </Label>
                  <Input
                    id="prod-price"
                    type="number"
                    min={0}
                    placeholder={requiresPrice ? '150' : '0 = On request'}
                    value={newProduct.price || ''}
                    onChange={(e) => {
                      setNewProduct({ ...newProduct, price: Number(e.target.value) });
                      if (fieldErrors.price) setFieldErrors(prev => { const { price, ...rest } = prev; return rest; });
                    }}
                    className={fieldErrors.price ? 'border-destructive' : ''}
                  />
                  {fieldErrors.price && <p className="text-xs text-destructive">{fieldErrors.price}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prod-mrp" className="text-xs">MRP ({currencySymbol}) <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    id="prod-mrp"
                    type="number"
                    min={0}
                    placeholder="e.g., 200"
                    value={newProduct.mrp || ''}
                    onChange={(e) => setNewProduct({ ...newProduct, mrp: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
              </div>

              {/* Auto-computed discount display */}
              {computedDiscount !== null && computedDiscount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 border border-success/20">
                  <Percent size={14} className="text-success" />
                  <span className="text-sm font-semibold text-success">{computedDiscount}% OFF</span>
                  <span className="text-xs text-muted-foreground">({formatPrice(newProduct.mrp! - newProduct.price)} savings)</span>
                </div>
              )}

              {categories.length > 1 && (
                <div className="space-y-2">
                  <Label className="text-xs">Category</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={newProduct.category}
                    onChange={(e) => { setNewProduct({ ...newProduct, category: e.target.value }); setAttributeBlocks([]); }}
                  >
                    {categories.map((c) => {
                      const catConfig = configs.find(cfg => cfg.category === c);
                      return (
                        <option key={c} value={c}>
                          {catConfig ? catConfig.displayName : c.replace(/_/g, ' ')}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Buyer Interaction: read-only when seller already chose during store configuration */}
              {effectiveDefaultActionType ? (() => {
                const cfg = allActions.find(a => a.action_type === effectiveDefaultActionType);
                return (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Buyer Interaction</Label>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border">
                      <span className="text-sm font-medium flex-1">{cfg?.cta_label || effectiveDefaultActionType}</span>
                      <span className="text-[10px] text-muted-foreground">Set during store configuration</span>
                    </div>
                  </div>
                );
              })() : (
                <ActionTypeSelector
                  category={newProduct.category}
                  value={newProduct.action_type || 'add_to_cart'}
                  onChange={(v) => setNewProduct({ ...newProduct, action_type: v })}
                  configs={configs}
                />
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="prod-desc" className="text-xs">Description</Label>
                  <span className={`text-xs ${newProduct.description.length > 280 ? 'text-destructive' : 'text-muted-foreground'}`}>{newProduct.description.length}/300</span>
                </div>
                <Textarea
                  id="prod-desc"
                  placeholder={activeConfig?.formHints.descriptionPlaceholder || "Short description..."}
                  rows={2}
                  maxLength={300}
                  value={newProduct.description}
                  onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value.slice(0, 300) })}
                />
              </div>

              {/* Product Image */}
              <div className="space-y-2" id="prod-image_url">
                <Label className="text-xs">Product Image <span className="text-destructive">*</span></Label>
                {user ? (
                  <div className={fieldErrors.image_url ? 'rounded-md ring-2 ring-destructive' : ''}>
                    <ProductImageUpload
                      value={newProduct.image_url || null}
                      onChange={(url) => {
                        setNewProduct({ ...newProduct, image_url: url || '' });
                        if (fieldErrors.image_url) setFieldErrors(prev => { const { image_url, ...rest } = prev; return rest; });
                      }}
                      userId={user.id}
                      productName={newProduct.name}
                      categoryName={newProduct.category}
                      description={newProduct.description}
                      beforePick={beforePick}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Sign in to upload images</p>
                )}
                {fieldErrors.image_url && <p className="text-xs text-destructive">{fieldErrors.image_url}</p>}
              </div>

              {showVegToggle && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={newProduct.is_veg}
                    onCheckedChange={(checked) => setNewProduct({ ...newProduct, is_veg: checked as boolean })}
                  />
                  <span className="text-sm">Vegetarian</span>
                </label>
              )}

              {/* Attribute Block Builder */}
              <AttributeBlockBuilder
                category={newProduct.category || null}
                value={attributeBlocks}
                onChange={setAttributeBlocks}
              />

              {/* Service Configuration Section */}
              {isService && (
                <>
                  <ServiceFieldsSection data={serviceFields} onChange={setServiceFields} />

                  {/* Feature Flags */}
                  <div className="space-y-1 px-3 py-2 bg-muted/50 rounded-lg">
                    <p className="text-xs font-semibold text-primary">Enabled for this category</p>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Info size={10} />
                      <span>Service Add-ons {supportsAddons ? 'enabled' : 'not enabled'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Info size={10} />
                      <span>Recurring Bookings {supportsRecurring ? 'enabled' : 'not enabled'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Info size={10} />
                      <span>Staff Assignment {supportsStaffAssignment ? 'enabled' : 'not enabled'}</span>
                    </div>
                  </div>

                  {/* Slots are generated automatically from Store Hours */}
                  <div className="flex items-start gap-1.5 px-2 py-1.5 rounded bg-muted/50">
                    <p className="text-[10px] text-muted-foreground leading-relaxed">💡 Booking slots are generated automatically from your Store Hours when you save.</p>
                  </div>
                </>
              )}

              {showDurationField && !isService && (
                <div className="space-y-2">
                  <Label htmlFor="prod-prep" className="text-xs">
                    {activeConfig?.formHints.durationLabel || PREP_TIME_LABEL}
                  </Label>
                  <Input
                    id="prod-prep"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    min={1}
                    placeholder={PREP_TIME_PLACEHOLDER}
                    value={prepTimeInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '' || /^\d+$/.test(v)) {
                        setPrepTimeInput(v);
                        if (fieldErrors.prep_time_minutes) {
                          setFieldErrors((prev) => {
                            const { prep_time_minutes, ...rest } = prev;
                            return rest;
                          });
                        }
                      }
                    }}
                    className={fieldErrors.prep_time_minutes ? 'border-destructive' : ''}
                  />
                  {fieldErrors.prep_time_minutes ? (
                    <p className="text-[10px] text-destructive">{fieldErrors.prep_time_minutes}</p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">{PREP_TIME_HELP}</p>
                  )}
                </div>
              )}

              {/* Stock Management */}
              <div className="p-3 bg-muted/50 rounded-lg space-y-3">
                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">📦 Stock Management</p>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium">Track Stock</span>
                  <Checkbox
                    checked={trackStock}
                    onCheckedChange={(checked) => {
                      const enabled = !!checked;
                      setTrackStock(enabled);
                      if (enabled) {
                        setStockQuantityInput((prev) => prev || '10');
                      } else {
                        setStockQuantityInput('');
                        setTrackLowStockAlert(false);
                        setLowStockThresholdInput('');
                      }
                    }}
                  />
                </label>
                {trackStock && (
                  <div className="space-y-3 pt-2 border-t border-border">
                    <div className="space-y-1">
                      <Label className="text-xs">Current Stock</Label>
                      <Input
                        id="prod-stock_quantity"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={stockQuantityInput}
                        onChange={(e) => setStockQuantityInput(e.target.value.replace(/[^\d]/g, ''))}
                      />
                      {fieldErrors.stock_quantity && (
                        <p className="text-xs text-destructive">{fieldErrors.stock_quantity}</p>
                      )}
                    </div>
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-sm font-medium">Low Stock Alert</span>
                      <Checkbox
                        checked={trackLowStockAlert}
                        onCheckedChange={(checked) => {
                          const enabled = !!checked;
                          setTrackLowStockAlert(enabled);
                          setLowStockThresholdInput((prev) => (enabled ? (prev || '5') : ''));
                        }}
                      />
                    </label>
                    {trackLowStockAlert && (
                      <div className="space-y-1">
                        <Label className="text-xs">Alert below this level</Label>
                        <Input
                          id="prod-low_stock_threshold"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={lowStockThresholdInput}
                          onChange={(e) => setLowStockThresholdInput(e.target.value.replace(/[^\d]/g, ''))}
                        />
                        {fieldErrors.low_stock_threshold && (
                          <p className="text-xs text-destructive">{fieldErrors.low_stock_threshold}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Lead Time & Pre-orders */}
              {!isService && (
                <div className="p-3 bg-muted/50 rounded-lg space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">⏱ Preparation & Ordering</p>
                  <LeadTimeField
                    value={leadTimeFromHours(newProduct.lead_time_hours).value}
                    unit={leadTimeFromHours(newProduct.lead_time_hours).unit}
                    preordersEnabled={!!newProduct.accepts_preorders}
                    error={fieldErrors.lead_time_hours}
                    onValueChange={(v) => {
                      const parsed = parseFloat(v);
                      const unit = leadTimeFromHours(newProduct.lead_time_hours).unit;
                      setNewProduct({
                        ...newProduct,
                        lead_time_hours: leadTimeToHours(parsed, unit),
                      });
                    }}
                    onUnitChange={(unit) => {
                      const parsed = parseFloat(leadTimeFromHours(newProduct.lead_time_hours).value || '0');
                      setNewProduct({
                        ...newProduct,
                        lead_time_hours: leadTimeToHours(parsed, unit),
                      });
                    }}
                  />
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <div className="min-w-0">
                      <span className="text-sm font-medium block">{PREORDERS_TOGGLE_LABEL}</span>
                      <span className="text-[10px] text-muted-foreground">{PREORDERS_TOGGLE_HELP}</span>
                    </div>
                    <Checkbox
                      checked={!!newProduct.accepts_preorders}
                      onCheckedChange={(checked) => setNewProduct({ ...newProduct, accepts_preorders: !!checked })}
                    />
                  </label>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="flex-1" onClick={resetForm}>Cancel</Button>
                <Button size="sm" className="flex-1" onClick={handleAddProduct} disabled={isSaving}>
                  {isSaving && <Loader2 size={14} className="animate-spin mr-1" />}
                  {editingIndex !== null ? 'Update Product' : 'Save Product'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Desktop sticky preview */}
          <ProductFormPreviewPanel formData={previewFormData} sellerProfile={null} attributeBlocks={attributeBlocks} />
        </div>

        {/* Mobile floating preview */}
        <ProductFormPreviewMobile formData={previewFormData} sellerProfile={null} attributeBlocks={attributeBlocks} />
        </>
      ) : (
        <Button variant="outline" className="w-full border-dashed" onClick={beginAddProduct}>
          <Plus size={16} className="mr-2" />
          Add Product / Service
        </Button>
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this product. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (deleteTarget !== null) { handleRemoveProduct(deleteTarget); setDeleteTarget(null); } }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
