// @ts-nocheck
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { motion, AnimatePresence } from 'framer-motion';

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
  const sp = useSellerProducts();
  const { formatPrice, currencySymbol } = useCurrency();
  const [currentStep, setCurrentStep] = useState(0);

  // Filter steps: hide "service" if not a service category
  const activeSteps = useMemo(() => {
    return STEPS.filter(s => s.key !== 'service' || sp.isCurrentCategoryService);
  }, [sp.isCurrentCategoryService]);

  const isLastStep = currentStep >= activeSteps.length - 1;
  const step = activeSteps[currentStep];

  // Load product data for editing
  useEffect(() => {
    if (isEditing && sp.products.length > 0 && !sp.editingProduct) {
      const product = sp.products.find(p => p.id === productId);
      if (product) sp.openEditDialog(product);
    }
  }, [isEditing, productId, sp.products.length]);

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
  };

  const handleSaveAndGoBack = () => {
    // Clear any previous error marker
    delete (window as any).__productFormFirstError;
    sp.handleSave();
    // After save, check if there was a validation error and navigate to that step
    setTimeout(() => {
      const firstErrorField = (window as any).__productFormFirstError;
      if (firstErrorField) {
        const targetStepKey = fieldToStepMap[firstErrorField];
        if (targetStepKey) {
          const stepIdx = activeSteps.findIndex(s => s.key === targetStepKey);
          if (stepIdx >= 0) setCurrentStep(stepIdx);
        }
        delete (window as any).__productFormFirstError;
      }
    }, 50);
  };

  // Navigate back after successful save
  const prevDialogOpen = useRef(sp.isDialogOpen);
  useEffect(() => {
    if (prevDialogOpen.current && !sp.isDialogOpen && !sp.isSaving) {
      navigate('/seller/products');
    }
    prevDialogOpen.current = sp.isDialogOpen;
  }, [sp.isDialogOpen, sp.isSaving]);

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
      <AppLayout showHeader={false}>
        <div className="p-4 safe-top">
          <Skeleton className="h-8 w-48 mb-6" />
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full rounded-2xl mb-4" />)}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showHeader={false}>
      <div className="max-w-5xl mx-auto p-4 pb-28 safe-top">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={handleBack}
            className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0 hover:bg-muted/80 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold">{isEditing ? 'Edit Product' : 'Add New Product'}</h1>
            {sp.sellerProfile && (
              <p className="text-xs text-muted-foreground">{sp.sellerProfile.business_name}</p>
            )}
          </div>
          <span className="text-xs text-muted-foreground font-medium">
            Step {currentStep + 1} of {activeSteps.length}
          </span>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1">
          {activeSteps.map((s, idx) => {
            const Icon = s.icon;
            const isActive = idx === currentStep;
            const isDone = idx < currentStep;
            return (
              <button
                key={s.key}
                onClick={() => setCurrentStep(idx)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all shrink-0',
                  isActive && 'bg-primary text-primary-foreground shadow-sm',
                  isDone && 'bg-primary/10 text-primary',
                  !isActive && !isDone && 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                {isDone ? <Check size={12} /> : <Icon size={12} />}
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
                <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
                  <div className="flex items-center gap-3 px-5 py-4 border-b bg-muted/30">
                    <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <step.icon size={16} className="text-primary" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold">{step.label}</h3>
                      <p className="text-xs text-muted-foreground">{step.description}</p>
                    </div>
                  </div>
                  <div className="p-5 space-y-4">
                    {step.key === 'basics' && <StepBasics sp={sp} />}
                    {step.key === 'pricing' && <StepPricing sp={sp} currencySymbol={currencySymbol} />}
                    {step.key === 'config' && <StepConfig sp={sp} />}
                    {step.key === 'visibility' && <StepVisibility sp={sp} />}
                    {step.key === 'attributes' && <StepAttributes sp={sp} />}
                    {step.key === 'service' && <StepService sp={sp} />}
                  </div>

                  {/* Inline step navigation */}
                  <div className="flex items-center justify-between px-5 py-4 border-t bg-muted/20">
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

        {/* Sticky bottom nav bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t p-4 z-50">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
            <Button
              variant="outline"
              onClick={handleBack}
              className="rounded-xl"
            >
              <ArrowLeft size={14} className="mr-1.5" />
              {currentStep === 0 ? 'Cancel' : 'Back'}
            </Button>

            <div className="flex items-center gap-1.5">
              {activeSteps.map((_, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'w-2 h-2 rounded-full transition-all',
                    idx === currentStep ? 'bg-primary w-6' : idx < currentStep ? 'bg-primary/40' : 'bg-muted-foreground/20'
                  )}
                />
              ))}
            </div>

            <Button
              onClick={handleNext}
              disabled={sp.isSaving}
              className="rounded-xl px-6 font-semibold"
            >
              {sp.isSaving && <Loader2 className="animate-spin mr-2" size={16} />}
              {isLastStep ? (isEditing ? 'Save Changes' : 'Add Product') : 'Next'}
              {!isLastStep && <ArrowRight size={14} className="ml-1.5" />}
            </Button>
          </div>
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
        <Label className="text-sm font-semibold">Buyer Interaction</Label>
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
            <Label className="text-sm font-semibold">{sp.activeCategoryConfig?.formHints.durationLabel || 'Prep Time (min)'}</Label>
            <Input type="number" placeholder="e.g. 30" value={sp.formData.prep_time_minutes} onChange={(e) => sp.setFormData({ ...sp.formData, prep_time_minutes: e.target.value })} className="mt-1.5" />
            <p className="text-[10px] text-muted-foreground mt-1">Time to prepare once ordered</p>
          </div>
        )}
        <div>
          <Label className="text-sm font-semibold">Order Lead Time (hours)</Label>
          <Input type="number" min="0" placeholder="e.g. 2" value={sp.formData.lead_time_hours} onChange={(e) => sp.setFormData({ ...sp.formData, lead_time_hours: e.target.value })} className="mt-1.5" />
          <p className="text-[10px] text-muted-foreground mt-1">Minimum advance notice buyers need</p>
        </div>
      </div>

      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
        <div>
          <span className="text-sm font-medium block">Accept Pre-orders</span>
          <span className="text-xs text-muted-foreground">Allow buyers to order for future dates</span>
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
          <Switch checked={sp.formData.stock_quantity !== ''} onCheckedChange={(checked) => sp.setFormData({ ...sp.formData, stock_quantity: checked ? '10' : '' })} />
        </div>
        {sp.formData.stock_quantity !== '' && (
          <div className="grid grid-cols-2 gap-3 pt-3 border-t">
            <div>
              <Label className="text-xs">Current Stock</Label>
              <Input type="number" min="0" value={sp.formData.stock_quantity} onChange={(e) => sp.setFormData({ ...sp.formData, stock_quantity: e.target.value })} className="mt-1" />
              <p className="text-[10px] text-muted-foreground mt-1">Units available right now</p>
            </div>
            <div>
              <Label className="text-xs">Low Stock Alert</Label>
              <Input type="number" min="1" value={sp.formData.low_stock_threshold} onChange={(e) => sp.setFormData({ ...sp.formData, low_stock_threshold: e.target.value })} className="mt-1" />
              <p className="text-[10px] text-muted-foreground mt-1">Alert below this level</p>
            </div>
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
