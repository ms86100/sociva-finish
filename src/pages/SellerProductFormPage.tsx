// @ts-nocheck
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LeadTimeField } from '@/components/seller/LeadTimeField';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { VegBadge } from '@/components/ui/veg-badge';
import { ProductImageUpload } from '@/components/ui/product-image-upload';
import { ProductCategory, ProductActionType } from '@/types/Database';
import { ArrowLeft, ArrowRight, Loader2, Star, Award, Bell, Package, Tag, Settings2, Eye, Layers, Wrench, Check, Info } from 'lucide-react';
import { ACTION_CONFIG } from '@/lib/marketplace-constants';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { AttributeBlockBuilder } from '@/components/seller/AttributeBlockBuilder';
import { useBlockLibrary, filterByCategory } from '@/hooks/useAttributeBlocks';
import { useSellerProducts } from '@/hooks/useSellerProducts';
import { ProductFormPreviewPanel, ProductFormPreviewMobile } from '@/components/seller/ProductFormPreview';
import { ServiceFieldsSection } from '@/components/seller/ServiceFieldsSection';
import { useCurrency } from '@/hooks/useCurrency';
import { cn } from '@/lib/utils';
import { sanitizePrepTimeMinutesInput } from '@/lib/prep-time-minutes';
import {
  PREORDERS_TOGGLE_HELP,
  PREORDERS_TOGGLE_LABEL,
  PREP_TIME_HELP,
  PREP_TIME_LABEL,
  PREP_TIME_PLACEHOLDER,
} from '@/lib/product-timing-copy';
import { motion, AnimatePresence } from 'framer-motion';
import { FoodFacetChips } from '@/components/seller/FoodFacetChips';
import { isFoodParentGroup, parseFoodFacets, serializeFoodFacets } from '@/lib/food-facets';

// ── Step definitions ──
const STEPS = [
  { key: 'basics', label: 'Basics', icon: Package, description: 'Name, image & category' },
  { key: 'pricing', label: 'Pricing', icon: Tag, description: 'Price & MRP' },
  { key: 'config', label: 'Configuration', icon: Settings2, description: 'Type, timing & options' },
  { key: 'visibility', label: 'Visibility & Stock', icon: Eye, description: 'Badges, alerts & inventory' },
  { key: 'attributes', label: 'Attributes', icon: Layers, description: 'Size, flavor, etc.' },
  { key: 'service', label: 'Service Config', icon: Wrench, description: 'Booking & scheduling' },
] as const;

type StepKey = typeof STEPS[number]['key'];

export default function SellerProductFormPage() {
  const navigate = useNavigate();
  const { productId } = useParams<{ productId?: string }>();
  const isEditing = !!productId;
  const sp = useSellerProducts({ formIntent: isEditing ? 'edit' : 'new' });
  const { formatPrice, currencySymbol } = useCurrency();
  const [currentStep, setCurrentStep] = useState(0);

  // Filter steps: hide "service" if not a service category
  const activeSteps = useMemo(() => {
    return STEPS.filter(s => s.key !== 'service' || sp.isCurrentCategoryService);
  }, [sp.isCurrentCategoryService]);

  const isLastStep = currentStep >= activeSteps.length - 1;
  const step = activeSteps[currentStep];

  const preparedNewFormRef = useRef(false);

  // Load product data for editing, or start a clean form for new products
  useEffect(() => {
    if (isEditing) {
      if (sp.products.length > 0 && !sp.editingProduct) {
        const product = sp.products.find(p => p.id === productId);
        if (product) sp.openEditDialog(product);
      }
      return;
    }
    if (!sp.draftRestored || preparedNewFormRef.current) return;
    preparedNewFormRef.current = true;
    sp.beginNewProduct();
  }, [isEditing, productId, sp.products.length, sp.draftRestored, sp.editingProduct]);

  // Set default category for new products
  useEffect(() => {
    if (!isEditing && sp.allowedCategories.length > 0 && !sp.formData.category) {
      sp.setFormData({ ...sp.formData, category: sp.allowedCategories[0].category as ProductCategory });
    }
  }, [isEditing, sp.allowedCategories.length]);

  // Field-to-step mapping for error navigation
  const fieldToStepMap: Record<string, string> = {
    name: 'basics', image_url: 'basics', category: 'basics',
    price: 'pricing', contact_phone: 'config',
    stock_quantity: 'visibility', low_stock_threshold: 'visibility',
  };

  const handleSaveAndGoBack = async () => {
    delete (window as any).__productFormFirstError;
    const saved = await sp.handleSave();
    if (saved) {
      navigate('/seller/products', { replace: true, state: { productSaved: true } });
      return;
    }
    // Validation failed — jump to the step with the first error field
    const firstErrorField = (window as any).__productFormFirstError;
    if (firstErrorField) {
      const targetStepKey = fieldToStepMap[firstErrorField];
      if (targetStepKey) {
        const stepIdx = activeSteps.findIndex(s => s.key === targetStepKey);
        if (stepIdx >= 0) setCurrentStep(stepIdx);
      }
      delete (window as any).__productFormFirstError;
    }
  };

  const handleNext = () => {
    // Validate the current step before advancing or submitting
    const errs = sp.validateStep(step.key);
    if (Object.keys(errs).length > 0) {
      // Scroll to the first errored field if it has an anchor id
      const firstKey = Object.keys(errs)[0];
      const el = document.getElementById(`edit-prod-${firstKey}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (isLastStep) {
      handleSaveAndGoBack();
    } else {
      setCurrentStep(prev => Math.min(prev + 1, activeSteps.length - 1));
    }
  };

  const handleBack = () => {
    if (currentStep === 0) {
      sp.resetForm();
      navigate('/seller/products');
    } else {
      setCurrentStep(prev => prev - 1);
    }
  };

  if (sp.isLoading) {
    return (
      <AppLayout showHeader={false} showNav={false} showCart={false}>
        <div className="p-4 safe-top">
          <Skeleton className="h-8 w-48 mb-6" />
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full rounded-2xl mb-4" />)}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showHeader={false} showNav={false} showCart={false}>
      <div className="max-w-5xl mx-auto px-3 sm:px-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px)+1rem)] sm:pb-8 pt-3 sm:pt-4 safe-top">
        {/* Header */}
        <div className="flex items-center gap-2 sm:gap-3 mb-4">
          <button
            onClick={handleBack}
            className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0 hover:bg-muted/80 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-lg font-bold truncate">{isEditing ? 'Edit Product' : 'Add Product'}</h1>
            {sp.sellerProfile && (
              <p className="text-[11px] text-muted-foreground truncate">{sp.sellerProfile.business_name}</p>
            )}
          </div>
          <span className="text-[10px] sm:text-xs text-muted-foreground font-medium shrink-0">
            {currentStep + 1}/{activeSteps.length}
          </span>
        </div>

        {/* Step indicator — compact on phone */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
          {activeSteps.map((s, idx) => {
            const Icon = s.icon;
            const isActive = idx === currentStep;
            const isDone = idx < currentStep;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setCurrentStep(idx)}
                className={cn(
                  'flex items-center justify-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl text-[10px] sm:text-xs font-medium transition-all shrink-0 min-w-[2rem] sm:min-w-0',
                  isActive && 'bg-primary text-primary-foreground shadow-sm',
                  isDone && 'bg-primary/10 text-primary',
                  !isActive && !isDone && 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
                aria-label={s.label}
              >
                {isDone ? (
                  <Check size={12} />
                ) : (
                  <>
                    <Icon size={12} className="hidden sm:block" />
                    <span className="sm:hidden tabular-nums">{idx + 1}</span>
                  </>
                )}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Main layout: Step content + Preview */}
        <div className="flex gap-6">
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={step.key}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <div className="bg-card rounded-2xl border shadow-sm">
                  <div className="flex items-center gap-3 px-4 sm:px-5 py-3 sm:py-4 border-b bg-muted/30">
                    <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <step.icon size={16} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold">{step.label}</h3>
                      <p className="text-[11px] sm:text-xs text-muted-foreground">{step.description}</p>
                    </div>
                  </div>
                  <div className="p-4 sm:p-5 space-y-4">
                    {step.key === 'basics' && <StepBasics sp={sp} />}
                    {step.key === 'pricing' && <StepPricing sp={sp} currencySymbol={currencySymbol} />}
                    {step.key === 'config' && <StepConfig sp={sp} />}
                    {step.key === 'visibility' && <StepVisibility sp={sp} />}
                    {step.key === 'attributes' && <StepAttributes sp={sp} />}
                    {step.key === 'service' && <StepService sp={sp} />}
                  </div>

                  {/* Mobile step navigation — in-card so tab bar never covers Cancel/Next */}
                  <div className="flex sm:hidden items-center justify-between gap-3 px-4 py-3 border-t bg-muted/20">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBack}
                      className="rounded-xl shrink-0"
                    >
                      <ArrowLeft size={14} className="mr-1" />
                      {currentStep === 0 ? 'Cancel' : 'Back'}
                    </Button>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                      {currentStep + 1} / {activeSteps.length}
                    </span>
                    <Button
                      size="sm"
                      onClick={handleNext}
                      disabled={sp.isSaving}
                      className="rounded-xl px-4 font-semibold shrink-0"
                    >
                      {sp.isSaving && <Loader2 className="animate-spin mr-1.5" size={14} />}
                      {isLastStep ? (isEditing ? 'Save' : 'Add') : 'Next'}
                      {!isLastStep && <ArrowRight size={14} className="ml-1" />}
                    </Button>
                  </div>

                  {/* Desktop / tablet step navigation inside card */}
                  <div className="hidden sm:flex items-center justify-between px-5 py-4 border-t bg-muted/20">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleBack}
                      className="rounded-xl"
                    >
                      <ArrowLeft size={14} className="mr-1.5" />
                      {currentStep === 0 ? 'Cancel' : 'Back'}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {currentStep + 1} / {activeSteps.length}
                    </span>
                    <Button
                      size="sm"
                      onClick={handleNext}
                      disabled={sp.isSaving}
                      className="rounded-xl px-5"
                    >
                      {sp.isSaving && <Loader2 className="animate-spin mr-1.5" size={14} />}
                      {isLastStep ? (isEditing ? 'Save' : 'Add Product') : 'Next'}
                      {!isLastStep && <ArrowRight size={14} className="ml-1.5" />}
                    </Button>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Mobile Preview — always visible */}
            <div className="mt-4 lg:hidden">
              <ProductFormPreviewMobile formData={sp.formData} sellerProfile={sp.sellerProfile} attributeBlocks={sp.attributeBlocks} />
            </div>
          </div>

          {/* Desktop Preview — always visible */}
          <ProductFormPreviewPanel formData={sp.formData} sellerProfile={sp.sellerProfile} attributeBlocks={sp.attributeBlocks} />
        </div>
      </div>
    </AppLayout>
  );
}

// ── Step Components ──

function StepBasics({ sp }: { sp: ReturnType<typeof useSellerProducts> }) {
  return (
    <>
      <div id="edit-prod-image_url">
        <Label className="text-sm font-semibold">Product Image *</Label>
        {sp.user && (
          <div className={`mt-1.5 ${sp.fieldErrors.image_url ? 'rounded-md ring-2 ring-destructive' : ''}`}>
            <ProductImageUpload
              value={sp.formData.image_url}
              onChange={(url) => {
                sp.setFormData({ ...sp.formData, image_url: url });
                if (sp.fieldErrors.image_url) sp.setFieldErrors((prev) => { const { image_url, ...rest } = prev; return rest; });
              }}
              userId={sp.user.id}
              productName={sp.formData.name}
              categoryName={sp.activeCategoryConfig?.displayName || sp.formData.category || undefined}
              description={sp.formData.description || undefined}
            />
          </div>
        )}
        {sp.fieldErrors.image_url && <p className="text-xs text-destructive mt-1">{sp.fieldErrors.image_url}</p>}
      </div>

      <div id="edit-prod-name">
        <Label className="text-sm font-semibold">Product Name *</Label>
        <Input
          placeholder={sp.activeCategoryConfig?.formHints.namePlaceholder || "e.g., Product Name"}
          value={sp.formData.name}
          onChange={(e) => {
            sp.setFormData({ ...sp.formData, name: e.target.value });
            if (sp.fieldErrors.name) sp.setFieldErrors((prev) => { const { name, ...rest } = prev; return rest; });
          }}
          onBlur={(e) => sp.applyListingPlacementFromName(e.target.value)}
          className={`mt-1.5 ${sp.fieldErrors.name ? 'border-destructive' : ''}`}
        />
        {sp.fieldErrors.name && <p className="text-xs text-destructive mt-1">{sp.fieldErrors.name}</p>}
      </div>

      <div>
        <Label className="text-sm font-semibold">Description</Label>
        <Textarea
          placeholder={sp.activeCategoryConfig?.formHints.descriptionPlaceholder || "Describe your product..."}
          value={sp.formData.description}
          onChange={(e) => sp.setFormData({ ...sp.formData, description: e.target.value })}
          rows={3}
          maxLength={300}
          className="mt-1.5"
        />
        <p className="text-[10px] text-muted-foreground text-right mt-1">{(sp.formData.description || '').length}/300</p>
      </div>

      {sp.allowedCategories.length > 1 ? (
        <div>
          <Label className="text-sm font-semibold">Category *</Label>
          <Select
            value={sp.formData.category}
            onValueChange={(value) => {
              sp.setFormData({ ...sp.formData, category: value as ProductCategory, subcategory_id: '' });
              sp.setAttributeBlocks([]);
            }}
          >
            <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              {sp.allowedCategories.map((config) => (
                <SelectItem key={config.category} value={config.category}>
                  <span className="flex items-center gap-1.5"><DynamicIcon name={config.icon} size={14} /> {config.displayName}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : sp.allowedCategories.length === 1 ? (
        <div>
          <Label className="text-sm font-semibold">Category</Label>
          <div className="flex items-center gap-2 p-2.5 bg-muted rounded-xl text-sm mt-1.5">
            <DynamicIcon name={sp.allowedCategories[0].icon} size={16} />
            <span>{sp.allowedCategories[0].displayName}</span>
          </div>
        </div>
      ) : null}

      {sp.subcategories.length > 0 && (
        <div>
          <Label className="text-sm font-semibold">Subcategory</Label>
          <Select value={sp.formData.subcategory_id || 'none'} onValueChange={(v) => sp.setFormData({ ...sp.formData, subcategory_id: v === 'none' ? '' : v })}>
            <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select subcategory (optional)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {sp.subcategories.map(sub => (
                <SelectItem key={sub.id} value={sub.id}>
                  <span className="inline-flex items-center gap-1.5"><DynamicIcon name={sub.icon || 'FolderOpen'} size={14} /> {sub.display_name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {(isFoodParentGroup(sp.activeCategoryConfig?.parentGroup) || sp.activeCategoryConfig?.layoutType === 'food') && (
        <FoodFacetChips
          value={parseFoodFacets(sp.formData.tags, sp.formData.cuisine_type)}
          onChange={(next) => {
            const persisted = serializeFoodFacets(next, sp.formData.tags);
            sp.setFormData({
              ...sp.formData,
              tags: persisted.tags,
              cuisine_type: persisted.cuisine_type,
            });
          }}
        />
      )}

      <p className="text-xs text-muted-foreground sm:hidden pt-1">
        Tap <span className="font-medium text-foreground">Next</span> below to set price and other details.
      </p>
    </>
  );
}

function StepPricing({ sp, currencySymbol }: { sp: ReturnType<typeof useSellerProducts>; currencySymbol: string }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div id="edit-prod-price">
          <Label className="text-sm font-semibold">{sp.activeCategoryConfig?.formHints.priceLabel || 'Price'} ({currencySymbol}) *</Label>
          <Input
            type="number"
            placeholder="0"
            value={sp.formData.price}
            onChange={(e) => {
              sp.setFormData({ ...sp.formData, price: e.target.value });
              if (sp.fieldErrors.price) sp.setFieldErrors((prev) => { const { price, ...rest } = prev; return rest; });
            }}
            className={`mt-1.5 ${sp.fieldErrors.price ? 'border-destructive' : ''}`}
          />
          {sp.fieldErrors.price && <p className="text-xs text-destructive mt-1">{sp.fieldErrors.price}</p>}
        </div>
        <div>
          <Label className="text-sm font-semibold">MRP ({currencySymbol})</Label>
          <Input
            type="number"
            placeholder="Original price"
            value={sp.formData.mrp}
            onChange={(e) => sp.setFormData({ ...sp.formData, mrp: e.target.value })}
            className="mt-1.5"
          />
        </div>
      </div>
      {sp.formData.mrp && sp.formData.price && parseFloat(sp.formData.mrp) > parseFloat(sp.formData.price) && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            🎉 {Math.round(((parseFloat(sp.formData.mrp) - parseFloat(sp.formData.price)) / parseFloat(sp.formData.mrp)) * 100)}% OFF for buyers
          </p>
        </div>
      )}
    </>
  );
}

function StepConfig({ sp }: { sp: ReturnType<typeof useSellerProducts> }) {
  const storeDefault = (sp.sellerProfile as any)?.default_action_type as string | undefined;
  const actionType = sp.effectiveActionType || sp.derivedActionType;
  const actionCfg = ACTION_CONFIG[actionType];
  const ActionIcon = actionCfg?.icon;
  const helperText = storeDefault
    ? 'Set during store configuration — all your products use this flow'
    : 'Determined by your category — all products in this category use the same flow';

  return (
    <>
      {/* Read-only buyer interaction — chosen during store configuration */}
      <div>
        <Label className="text-sm font-semibold">How customers buy this</Label>
        <div className="mt-1.5 flex items-center gap-3 p-3 bg-muted/50 rounded-xl border">
          {ActionIcon && <ActionIcon size={18} className="text-primary shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{actionCfg?.label || actionType}</p>
            <p className="text-[10px] text-muted-foreground">{helperText}</p>
          </div>
        </div>
      </div>

      {sp.formData.action_type === 'contact_seller' && (
        <div id="edit-prod-contact_phone">
          <Label className="text-sm font-semibold">Contact Phone *</Label>
          <Input
            placeholder="e.g., +91 98765 43210"
            value={sp.formData.contact_phone}
            onChange={(e) => {
              sp.setFormData({ ...sp.formData, contact_phone: e.target.value });
              if (sp.fieldErrors.contact_phone) sp.setFieldErrors((prev) => { const { contact_phone, ...rest } = prev; return rest; });
            }}
            className={`mt-1.5 ${sp.fieldErrors.contact_phone ? 'border-destructive' : ''}`}
          />
          {sp.fieldErrors.contact_phone && <p className="text-xs text-destructive mt-1">{sp.fieldErrors.contact_phone}</p>}
        </div>
      )}

      {sp.showVegToggle && (
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
          <div className="flex items-center gap-2">
            <VegBadge isVeg={sp.formData.is_veg} />
            <span className="text-sm font-medium">{sp.formData.is_veg ? 'Vegetarian' : 'Non-Vegetarian'}</span>
          </div>
          <Switch checked={sp.formData.is_veg} onCheckedChange={(checked) => sp.setFormData({ ...sp.formData, is_veg: checked })} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {sp.showDurationField && (
          <div>
            <Label className="text-sm font-semibold">
              {sp.activeCategoryConfig?.formHints.durationLabel || PREP_TIME_LABEL}
            </Label>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder={PREP_TIME_PLACEHOLDER}
              value={sp.formData.prep_time_minutes}
              onChange={(e) => {
                const v = sanitizePrepTimeMinutesInput(e.target.value);
                sp.setFormData({ ...sp.formData, prep_time_minutes: v });
                if (sp.fieldErrors.prep_time_minutes) {
                  sp.setFieldErrors((prev) => {
                    const { prep_time_minutes, ...rest } = prev;
                    return rest;
                  });
                }
              }}
              className={cn('mt-1.5', sp.fieldErrors.prep_time_minutes && 'border-destructive')}
            />
            {sp.fieldErrors.prep_time_minutes ? (
              <p className="text-xs text-destructive mt-1">{sp.fieldErrors.prep_time_minutes}</p>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-1">{PREP_TIME_HELP}</p>
            )}
          </div>
        )}
        <LeadTimeField
          value={sp.formData.lead_time_value}
          unit={sp.formData.lead_time_unit}
          onValueChange={(v) => sp.setFormData({ ...sp.formData, lead_time_value: v })}
          onUnitChange={(u) => sp.setFormData({ ...sp.formData, lead_time_unit: u })}
          error={sp.fieldErrors.lead_time_value}
          preordersEnabled={sp.formData.accepts_preorders}
        />
      </div>

      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
        <div>
          <span className="text-sm font-medium block">{PREORDERS_TOGGLE_LABEL}</span>
          <span className="text-xs text-muted-foreground">{PREORDERS_TOGGLE_HELP}</span>
        </div>
        <Switch checked={sp.formData.accepts_preorders} onCheckedChange={(checked) => sp.setFormData({ ...sp.formData, accepts_preorders: checked })} />
      </div>
    </>
  );
}

function StepVisibility({ sp }: { sp: ReturnType<typeof useSellerProducts> }) {
  return (
    <>
      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
        <div className="flex items-center gap-2">
          <Star size={16} className="text-amber-500" />
          <div>
            <span className="text-sm font-medium block">Bestseller</span>
            <span className="text-xs text-muted-foreground">Highlight as a bestselling item</span>
          </div>
        </div>
        <Switch checked={sp.formData.is_bestseller} onCheckedChange={(checked) => sp.setFormData({ ...sp.formData, is_bestseller: checked })} />
      </div>

      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
        <div className="flex items-center gap-2">
          <Award size={16} className="text-emerald-500" />
          <div>
            <span className="text-sm font-medium block">Recommended</span>
            <span className="text-xs text-muted-foreground">Show as a recommended product</span>
          </div>
        </div>
        <Switch checked={sp.formData.is_recommended} onCheckedChange={(checked) => sp.setFormData({ ...sp.formData, is_recommended: checked })} />
      </div>

      <div className="flex items-center justify-between p-3 border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 rounded-xl">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-amber-500" />
          <div>
            <span className="text-sm font-medium block">Urgent Order Alert</span>
            <span className="text-xs text-muted-foreground">5-min timer, auto-cancel if not responded</span>
          </div>
        </div>
        <Switch checked={sp.formData.is_urgent} onCheckedChange={(checked) => sp.setFormData({ ...sp.formData, is_urgent: checked })} />
      </div>

      <div className="p-4 bg-muted/50 rounded-xl space-y-3">
        <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">📦 Stock Management</p>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium block">Track Stock Quantity</span>
            <span className="text-xs text-muted-foreground">Auto-marks unavailable when stock hits zero</span>
          </div>
          <Switch
            checked={sp.formData.tracks_stock}
            onCheckedChange={(checked) => sp.patchFormData((prev) => ({
              tracks_stock: !!checked,
              stock_quantity: checked ? (prev.stock_quantity || '10') : '',
              ...(!checked ? { tracks_low_stock_alert: false, low_stock_threshold: '' } : {}),
            }))}
          />
        </div>
        {sp.formData.tracks_stock && (
          <div className="pt-3 border-t">
            <Label className="text-xs">Current Stock</Label>
            <Input
              id="edit-prod-stock_quantity"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={sp.formData.stock_quantity}
              onChange={(e) => sp.patchFormData({ stock_quantity: e.target.value.replace(/[^\d]/g, '') })}
              className="mt-1"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Units available right now</p>
            {sp.fieldErrors.stock_quantity && (
              <p className="text-xs text-destructive mt-1">{sp.fieldErrors.stock_quantity}</p>
            )}
          </div>
        )}
        {sp.formData.tracks_stock && (
          <div className="flex items-center justify-between pt-3 border-t">
            <div>
              <span className="text-sm font-medium block">Low Stock Alert</span>
              <span className="text-xs text-muted-foreground">Notify when stock drops below a level</span>
            </div>
            <Switch
              checked={sp.formData.tracks_low_stock_alert}
              onCheckedChange={(checked) => sp.patchFormData((prev) => ({
                tracks_low_stock_alert: !!checked,
                low_stock_threshold: checked ? (prev.low_stock_threshold || '5') : '',
              }))}
            />
          </div>
        )}
        {sp.formData.tracks_stock && sp.formData.tracks_low_stock_alert && (
          <div className="pt-1">
            <Label className="text-xs">Alert below this level</Label>
            <Input
              id="edit-prod-low_stock_threshold"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={sp.formData.low_stock_threshold}
              onChange={(e) => sp.patchFormData({ low_stock_threshold: e.target.value.replace(/[^\d]/g, '') })}
              className="mt-1"
            />
            {sp.fieldErrors.low_stock_threshold && (
              <p className="text-xs text-destructive mt-1">{sp.fieldErrors.low_stock_threshold}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
        <span className="text-sm font-medium">Available for order</span>
        <Switch checked={sp.formData.is_available} onCheckedChange={(checked) => sp.setFormData({ ...sp.formData, is_available: checked })} />
      </div>
    </>
  );
}

function StepAttributes({ sp }: { sp: ReturnType<typeof useSellerProducts> }) {
  const { data: library = [] } = useBlockLibrary();
  const category = sp.formData.category || null;
  const availableBlocks = filterByCategory(library, category);
  
  if (!category) {
    return (
      <div className="text-center py-8">
        <Layers size={32} className="mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">Select a category first to see available attributes</p>
      </div>
    );
  }
  
  if (availableBlocks.length === 0 && sp.attributeBlocks.length === 0) {
    return (
      <div className="text-center py-8">
        <Layers size={32} className="mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">No extra attributes available for this category</p>
        <p className="text-xs text-muted-foreground mt-1">You can proceed to the next step</p>
      </div>
    );
  }

  return (
    <AttributeBlockBuilder
      category={category}
      value={sp.attributeBlocks}
      onChange={sp.setAttributeBlocks}
      wizardMode
    />
  );
}

function StepService({ sp }: { sp: ReturnType<typeof useSellerProducts> }) {
  return <ServiceFieldsSection data={sp.serviceFields} onChange={sp.setServiceFields} errors={sp.fieldErrors} />;
}
