// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { SetStoreLocationSheet } from '@/components/seller/SetStoreLocationSheet';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { CroppableImageUpload } from '@/components/ui/croppable-image-upload';
import { DAYS_OF_WEEK } from '@/types/database';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ArrowLeft, Loader2, PauseCircle, PlayCircle, Clock, Banknote, AlertTriangle, Building2, Globe, Truck, Eye, MapPin, Navigation, Palmtree, Camera, CreditCard, PartyPopper, Smartphone, Plus } from 'lucide-react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { cn } from '@/lib/utils';
import { LicenseUpload } from '@/components/seller/LicenseUpload';

import { useSellerSettings } from '@/hooks/useSellerSettings';
import { UpiVpaInput } from '@/components/payment/UpiVpaInput';
import { useActionTypeMap } from '@/hooks/useActionTypeMap';
import { SellerFestivalParticipation } from '@/components/seller/SellerFestivalParticipation';
import { RequestCategoryDialog } from '@/components/seller/RequestCategoryDialog';
import { useParentGroups } from '@/hooks/useParentGroups';

function LicenseUploadSection({ sellerId, primaryGroup }: { sellerId: string; primaryGroup: string }) {
  const [groupId, setGroupId] = useState<string | null>(null);
  const [requiresLicense, setRequiresLicense] = useState(false);

  useEffect(() => {
    const fetchGroup = async () => {
      const { data } = await supabase.from('parent_groups').select('id, requires_license').eq('slug', primaryGroup).single();
      if (data) { setGroupId(data.id); setRequiresLicense((data as any).requires_license || false); }
    };
    fetchGroup();
  }, [primaryGroup]);

  if (!groupId || !requiresLicense) return null;
  return <LicenseUpload sellerId={sellerId} groupId={groupId} />;
}

function StoreLocationSection({ sellerId, sellerProfile }: { sellerId: string; sellerProfile: any }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const hasCoords = !!(sellerProfile as any).latitude && !!(sellerProfile as any).longitude;

  const locationLabel = (sellerProfile as any).store_location_label;

  return (
    <div className="space-y-3">
      {hasCoords ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <Navigation size={14} className="text-success shrink-0" />
            <div className="min-w-0">
              <span className="text-foreground font-medium truncate block">
                {locationLabel || 'Location set'}
              </span>
              {locationLabel && (
                <span className="text-[10px] text-muted-foreground">Store location</span>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={() => setSheetOpen(true)}>
            Update Location
          </Button>
        </div>
      ) : (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
          <p className="text-sm font-medium text-destructive">No location set</p>
          <p className="text-xs text-muted-foreground mt-0.5">Your store won't be visible to buyers without a location.</p>
          <Button variant="destructive" size="sm" className="mt-2 h-8 text-xs" onClick={() => setSheetOpen(true)}>
            <MapPin size={12} className="mr-1" />
            Set Location Now
          </Button>
        </div>
      )}
      <SetStoreLocationSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        sellerId={sellerId}
      />
    </div>
  );
}

const TABS = [
  { key: 'store-info', label: 'Store Info', icon: Building2 },
  { key: 'photos', label: 'Photos', icon: Camera },
  { key: 'location', label: 'Location', icon: MapPin },
  { key: 'hours', label: 'Hours', icon: Clock },
  { key: 'payments', label: 'Payments', icon: CreditCard },
  { key: 'delivery', label: 'Delivery', icon: Truck },
  { key: 'festivals', label: 'Festivals', icon: PartyPopper },
  { key: 'payouts', label: 'Payouts', icon: Building2 },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function SellerSettingsPage() {
  const {
    user, sellerProfile, primaryGroup, isLoading, isSaving,
    formData, setFormData, currencySymbol,
    groupedConfigs, getGroupBySlug,
    handleCategoryChange, handleDayChange, togglePauseShop, handleSave,
  } = useSellerSettings();
  const { data: allActions = [] } = useActionTypeMap();
  const { parentGroupInfos } = useParentGroups();
  const [requestCategoryOpen, setRequestCategoryOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('store-info');

  const [hasBookableProducts, setHasBookableProducts] = useState(false);
  useEffect(() => {
    if (!sellerProfile?.id || allActions.length === 0) return;
    const checkProducts = async () => {
      const { data: products } = await supabase
        .from('products')
        .select('action_type')
        .eq('seller_id', sellerProfile.id);
      if (products && products.length > 0) {
        const hasBookable = products.some((p: any) => {
          const ac = allActions.find(a => a.action_type === p.action_type);
          return ac?.requires_availability === true;
        });
        setHasBookableProducts(hasBookable);
      }
    };
    checkProducts();
  }, [sellerProfile?.id, allActions]);

  if (isLoading) {
    return (
      <AppLayout showHeader={false} safeTop={false}>
        <div className="p-4 safe-top"><Skeleton className="h-8 w-32 mb-4" /><Skeleton className="h-48 w-full rounded-xl" /></div>
      </AppLayout>
    );
  }

  if (!sellerProfile) {
    return (
      <AppLayout showHeader={false} safeTop={false}>
        <div className="p-4 text-center py-12 safe-top">
          <p className="text-muted-foreground">Seller profile not found</p>
          <Link to="/become-seller"><Button className="mt-4">Become a Seller</Button></Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showHeader={false} showNav={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3 flex items-center gap-3">
          <Link to="/seller" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0"><ArrowLeft size={18} /></Link>
          <h1 className="text-xl font-bold">Store Settings</h1>
        </div>
      </SafeHeader>
      <div className="p-4 pb-44">
        <div className="space-y-4">
          {/* Rejection / Pending status banner */}
          {sellerProfile.verification_status !== 'approved' && (
            <Card className={sellerProfile.verification_status === 'rejected' ? 'border-destructive/30 bg-destructive/5' : 'border-warning/30 bg-warning/5'}>
              <CardContent className="p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={18} className={sellerProfile.verification_status === 'rejected' ? 'text-destructive' : 'text-warning'} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {sellerProfile.verification_status === 'rejected' ? 'Store Rejected' : 'Store Pending Review'}
                    </p>
                    {(sellerProfile as any).rejection_note && (
                      <p className="text-xs text-muted-foreground mt-1">Reason: {(sellerProfile as any).rejection_note}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {sellerProfile.verification_status === 'rejected'
                        ? 'You can update your details below and resubmit from the onboarding page.'
                        : 'Your store is being reviewed. You can still update settings below.'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pause/Resume */}
          <Card className={formData.is_available ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {formData.is_available ? <PlayCircle className="text-success" size={28} /> : <PauseCircle className="text-warning" size={28} />}
                  <div>
                    <p className="font-semibold">{formData.is_available ? 'Store is Open' : 'Store is Paused'}</p>
                    <p className="text-xs text-muted-foreground">{formData.is_available ? 'Customers can place orders' : 'Temporarily not accepting orders'}</p>
                  </div>
                </div>
                <Button variant={formData.is_available ? 'outline' : 'default'} size="sm" onClick={togglePauseShop}>{formData.is_available ? 'Pause Shop' : 'Resume Shop'}</Button>
              </div>
            </CardContent>
          </Card>

          {/* Preview */}
          {sellerProfile && <div className="mt-4"><Link to={`/seller/${sellerProfile.id}`}><Button variant="outline" className="w-full gap-2" size="sm"><Eye size={16} /> Preview My Store</Button></Link></div>}

          {/* Tab bar */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all shrink-0",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-secondary"
                  )}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="space-y-5">
            {/* ── Store Info ── */}
            {activeTab === 'store-info' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="business_name">Business Name *</Label>
                  <Input id="business_name" value={formData.business_name} onChange={(e) => setFormData({ ...formData, business_name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" placeholder="Tell customers about your business..." value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={3} />
                </div>
                {primaryGroup && (
                  <div className="bg-muted/50 rounded-xl p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ backgroundColor: `${getGroupBySlug(primaryGroup)?.color}20` }}><DynamicIcon name={getGroupBySlug(primaryGroup)?.icon || ''} size={24} style={{ color: getGroupBySlug(primaryGroup)?.color }} /></div>
                      <div>
                        <p className="text-xs text-muted-foreground">Your seller category</p>
                        <p className="font-semibold">{getGroupBySlug(primaryGroup)?.label}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1"><AlertTriangle size={12} /> To change category group, please contact admin</p>
                  </div>
                )}
                <div className="space-y-3">
                  <Label>Categories * {primaryGroup && <span className="text-muted-foreground font-normal">(within {getGroupBySlug(primaryGroup)?.label})</span>}</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {(primaryGroup ? groupedConfigs[primaryGroup] || [] : []).map((config) => (
                      <label key={config.category} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${formData.categories.includes(config.category as any) ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}>
                        <Checkbox checked={formData.categories.includes(config.category as any)} onCheckedChange={(checked) => handleCategoryChange(config.category as any, checked as boolean)} />
                        <DynamicIcon name={config.icon} size={18} style={{ color: config.color }} />
                        <span className="text-sm font-medium">{config.displayName}</span>
                      </label>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={() => setRequestCategoryOpen(true)}
                  >
                    <Plus size={14} />
                    Don't see your category? Request it
                  </Button>
                  <RequestCategoryDialog
                    open={requestCategoryOpen}
                    onOpenChange={setRequestCategoryOpen}
                    initialName=""
                    parentGroupInfos={parentGroupInfos.filter(g => !primaryGroup || g.value === primaryGroup)}
                    sellerId={sellerProfile?.id}
                  />
                </div>
              </>
            )}

            {/* ── Photos ── */}
            {activeTab === 'photos' && (
              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Cover Image</Label>
                  {user && <div className="max-h-48 max-w-full"><CroppableImageUpload value={formData.cover_image_url} onChange={(url) => setFormData({ ...formData, cover_image_url: url })} folder="sellers" userId={user.id} aspectRatio="video" placeholder="Upload cover photo" className="max-h-48" cropAspect={16 / 9} /></div>}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Profile Photo</Label>
                  {user && <div className="w-[140px]"><CroppableImageUpload value={formData.profile_image_url} onChange={(url) => setFormData({ ...formData, profile_image_url: url })} folder="sellers" userId={user.id} aspectRatio="square" placeholder="Upload profile photo" cropAspect={1} /></div>}
                </div>
              </div>
            )}

            {/* ── Location ── */}
            {activeTab === 'location' && (
              <StoreLocationSection sellerId={sellerProfile.id} sellerProfile={sellerProfile} />
            )}

            {/* ── Hours & Days ── */}
            {activeTab === 'hours' && (
              <>
                <div className="space-y-3">
                  <Label>Operating Days</Label>
                  <div className="flex flex-wrap gap-2">
                    {DAYS_OF_WEEK.map((day) => (
                      <label key={day} className={`flex items-center justify-center w-12 h-10 rounded-lg border cursor-pointer transition-colors ${formData.operating_days.includes(day) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                        <Checkbox checked={formData.operating_days.includes(day)} onCheckedChange={(checked) => handleDayChange(day, checked as boolean)} className="hidden" />
                        <span className="text-xs font-medium">{day}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Store will auto-close on non-operating days</p>
                </div>
                <div className="space-y-2">
                  <Label>Availability Hours</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label htmlFor="start" className="text-xs text-muted-foreground">Opens at</Label><Input id="start" type="time" value={formData.availability_start} onChange={(e) => setFormData({ ...formData, availability_start: e.target.value })} /></div>
                    <div><Label htmlFor="end" className="text-xs text-muted-foreground">Closes at</Label><Input id="end" type="time" value={formData.availability_end} onChange={(e) => setFormData({ ...formData, availability_end: e.target.value })} /></div>
                  </div>
                </div>
                {/* Vacation Mode */}
                <Card className={formData.vacation_mode ? 'border-accent/30 bg-accent/5' : 'border-border'}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Palmtree className={formData.vacation_mode ? 'text-accent' : 'text-muted-foreground'} size={22} />
                        <div>
                          <p className="font-semibold text-sm">Vacation Mode</p>
                          <p className="text-xs text-muted-foreground">Show "On a break" banner instead of hiding store</p>
                        </div>
                      </div>
                      <Switch checked={formData.vacation_mode} onCheckedChange={(checked) => setFormData({ ...formData, vacation_mode: checked, vacation_until: checked ? formData.vacation_until : '' })} />
                    </div>
                    {formData.vacation_mode && (
                      <div className="space-y-2 pt-2 border-t">
                        <Label htmlFor="vacation_until" className="text-xs">Back on (optional)</Label>
                        <Input id="vacation_until" type="date" value={formData.vacation_until} onChange={(e) => setFormData({ ...formData, vacation_until: e.target.value })} min={new Date().toISOString().split('T')[0]} />
                        <p className="text-[10px] text-muted-foreground">Buyers will see when you'll be back</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
                {/* Service Availability moved to Schedule tab on the dashboard */}
                {sellerProfile && hasBookableProducts && (
                  <a href="#/seller" className="flex items-center justify-between px-4 py-3 bg-card border rounded-xl hover:bg-accent/5">
                    <div>
                      <p className="text-sm font-semibold">Booking schedule & slots</p>
                      <p className="text-[11px] text-muted-foreground">Manage working hours, slots, and bookings in the Schedule tab</p>
                    </div>
                    <span className="text-primary text-xs font-medium">Open →</span>
                  </a>
                )}
              </>
            )}

            {/* ── Payments ── */}
            {activeTab === 'payments' && (
              <>
                <div className="space-y-3">
                  <Label>Payment Methods</Label>
                  {(formData.fulfillment_mode === 'self_pickup' || formData.fulfillment_mode === 'pickup_and_seller_delivery' || formData.fulfillment_mode === 'pickup_and_platform_delivery') && (
                    <div className="p-4 bg-muted rounded-lg space-y-3">
                      <p className="font-medium text-sm">Self Pickup</p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3"><Banknote className="text-success" size={18} /><p className="text-sm">Cash Payment</p></div>
                        <Switch checked={formData.pickup_payment_config.accepts_cod} onCheckedChange={(checked) => {
                          if (!checked && !formData.pickup_payment_config.accepts_online) return;
                          setFormData({ ...formData, pickup_payment_config: { ...formData.pickup_payment_config, accepts_cod: checked } });
                        }} />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3"><Smartphone className="text-info" size={18} /><p className="text-sm">Online Payment</p></div>
                        <Switch checked={formData.pickup_payment_config.accepts_online} onCheckedChange={(checked) => {
                          if (!checked && !formData.pickup_payment_config.accepts_cod) return;
                          setFormData({ ...formData, pickup_payment_config: { ...formData.pickup_payment_config, accepts_online: checked } });
                        }} />
                      </div>
                      {!formData.pickup_payment_config.accepts_cod && !formData.pickup_payment_config.accepts_online && (
                        <p className="text-xs text-destructive">At least one payment method is required</p>
                      )}
                    </div>
                  )}
                  {(formData.fulfillment_mode === 'seller_delivery' || formData.fulfillment_mode === 'platform_delivery' || formData.fulfillment_mode === 'pickup_and_seller_delivery' || formData.fulfillment_mode === 'pickup_and_platform_delivery') && (
                    <div className="p-4 bg-muted rounded-lg space-y-3">
                      <p className="font-medium text-sm">Delivery</p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3"><Banknote className="text-success" size={18} /><p className="text-sm">Cash on Delivery</p></div>
                        <Switch checked={formData.delivery_payment_config.accepts_cod} onCheckedChange={(checked) => {
                          if (!checked && !formData.delivery_payment_config.accepts_online) return;
                          setFormData({ ...formData, delivery_payment_config: { ...formData.delivery_payment_config, accepts_cod: checked } });
                        }} />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3"><Smartphone className="text-info" size={18} /><p className="text-sm">Online Payment</p></div>
                        <Switch checked={formData.delivery_payment_config.accepts_online} onCheckedChange={(checked) => {
                          if (!checked && !formData.delivery_payment_config.accepts_cod) return;
                          setFormData({ ...formData, delivery_payment_config: { ...formData.delivery_payment_config, accepts_online: checked } });
                        }} />
                      </div>
                      {!formData.delivery_payment_config.accepts_cod && !formData.delivery_payment_config.accepts_online && (
                        <p className="text-xs text-destructive">At least one payment method is required</p>
                      )}
                    </div>
                  )}
                  {(formData.pickup_payment_config.accepts_online || formData.delivery_payment_config.accepts_online) && (
                    <div className="p-4 bg-muted rounded-lg space-y-2">
                      <Label htmlFor="upi_id" className="text-xs">Your UPI ID (for direct UPI payments)</Label>
                      <UpiVpaInput
                        value={formData.upi_id}
                        onChange={(v) => setFormData({ ...formData, upi_id: v })}
                        sellerId={sellerProfile?.id}
                        businessName={formData.business_name}
                        initialStatus={(sellerProfile as any)?.upi_verification_status}
                        initialHolderName={(sellerProfile as any)?.upi_holder_name}
                        initialProvider={(sellerProfile as any)?.upi_provider}
                        initialVerifiedAt={(sellerProfile as any)?.upi_verified_at}
                        onStatusChange={(status, name) => setFormData({ ...formData, upi_validation_status: status, upi_holder_name: name } as any)}
                      />
                    </div>
                  )}
                </div>
                {/* Min Order */}
                <div className="space-y-3">
                  <Label>Minimum Order Amount</Label>
                  <div className="p-4 bg-muted rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <div><p className="font-medium text-sm">Set minimum order value</p><p className="text-xs text-muted-foreground">Buyers must meet this amount to place an order</p></div>
                      <Switch checked={formData.minimum_order_amount !== ''} onCheckedChange={(checked) => setFormData({ ...formData, minimum_order_amount: checked ? '100' : '' })} />
                    </div>
                    {formData.minimum_order_amount !== '' && (
                      <div className="space-y-2 pt-2 border-t"><Label htmlFor="min_order" className="text-xs">Minimum Amount ({currencySymbol})</Label><Input id="min_order" type="number" min="0" placeholder="e.g. 100" value={formData.minimum_order_amount} onChange={(e) => setFormData({ ...formData, minimum_order_amount: e.target.value })} /></div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ── Delivery ── */}
            {activeTab === 'delivery' && (
              <>
                <div className="space-y-3">
                  <Label>Fulfillment Mode</Label>
                  <div className="p-4 bg-muted rounded-lg space-y-3">
                    <RadioGroup value={formData.fulfillment_mode} onValueChange={(value) => setFormData({ ...formData, fulfillment_mode: value })} className="space-y-2">
                      <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-background/50 cursor-pointer"><RadioGroupItem value="self_pickup" /><div><p className="text-sm font-medium">Self Pickup Only</p><p className="text-xs text-muted-foreground">Buyer picks up from your location</p></div></label>
                      <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-background/50 cursor-pointer"><RadioGroupItem value="seller_delivery" /><div><p className="text-sm font-medium">I Deliver</p><p className="text-xs text-muted-foreground">You deliver to buyer's location</p></div></label>
                      <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-background/50 cursor-pointer"><RadioGroupItem value="pickup_and_seller_delivery" /><div><p className="text-sm font-medium">Pickup + I Deliver</p><p className="text-xs text-muted-foreground">Buyer can choose pickup or you deliver</p></div></label>
                      <label className="flex items-center gap-3 p-2 rounded-lg opacity-50 cursor-not-allowed"><RadioGroupItem value="platform_delivery" disabled /><div><p className="text-sm font-medium">Delivery Partner</p><p className="text-xs text-muted-foreground">Platform delivery partner — available in future plans</p></div></label>
                      <label className="flex items-center gap-3 p-2 rounded-lg opacity-50 cursor-not-allowed"><RadioGroupItem value="pickup_and_platform_delivery" disabled /><div><p className="text-sm font-medium">Pickup + Delivery Partner</p><p className="text-xs text-muted-foreground">Pickup or delivery partner — available in future plans</p></div></label>
                    </RadioGroup>
                    {formData.fulfillment_mode !== 'self_pickup' && (
                      <p className="text-xs text-primary/80 bg-primary/5 rounded-lg p-2">💡 Delivery fee is managed by the platform admin</p>
                    )}
                    {(formData.fulfillment_mode === 'platform_delivery' || formData.fulfillment_mode === 'pickup_and_platform_delivery') && (
                      <p className="text-xs text-muted-foreground bg-muted rounded-lg p-2">🚴 A delivery partner will be auto-assigned when the order is ready</p>
                    )}
                    {(formData.fulfillment_mode === 'seller_delivery' || formData.fulfillment_mode === 'pickup_and_seller_delivery') && (
                      <div className="space-y-2 pt-2 border-t"><Label htmlFor="delivery_note" className="text-xs">Delivery Instructions</Label><Input id="delivery_note" placeholder="e.g. Will deliver within 1 hour" value={formData.delivery_note} onChange={(e) => setFormData({ ...formData, delivery_note: e.target.value })} /></div>
                    )}
                  </div>
                </div>
                {/* Cross-Society */}
                <div className="space-y-3">
                  <Label>Cross-Society Sales</Label>
                  <div className="p-4 bg-muted rounded-lg space-y-4">
                    <div className="flex items-center justify-between">
                      <div><p className="font-medium text-sm">Sell beyond my community</p><p className="text-xs text-muted-foreground">Allow buyers from nearby societies to order</p></div>
                      <Switch checked={formData.sell_beyond_community} onCheckedChange={(checked) => setFormData({ ...formData, sell_beyond_community: checked })} />
                    </div>
                    {formData.sell_beyond_community && (
                      <div className="space-y-2 pt-2 border-t">
                        <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Delivery Radius</span><span className="text-sm font-medium text-primary">{formData.delivery_radius_km} km</span></div>
                        <Slider value={[formData.delivery_radius_km]} onValueChange={([v]) => setFormData({ ...formData, delivery_radius_km: v })} min={1} max={10} step={1} />
                        <p className="text-[10px] text-muted-foreground">Buyers within {formData.delivery_radius_km} km can order from you</p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ── Festivals ── */}
            {activeTab === 'festivals' && sellerProfile && (
              <SellerFestivalParticipation sellerId={sellerProfile.id} />
            )}

            {/* ── Payouts ── */}
            {activeTab === 'payouts' && (
              <>
                <div className="space-y-3">
                  <Label>Bank Account for Payouts</Label>
                  <p className="text-xs text-muted-foreground">Payouts will be processed to this bank account</p>
                  <div className="space-y-3 bg-muted rounded-lg p-4">
                    <div className="space-y-2"><Label htmlFor="bank_account_holder" className="text-xs">Account Holder Name</Label><Input id="bank_account_holder" placeholder="As per bank records" value={formData.bank_account_holder} onChange={(e) => setFormData({ ...formData, bank_account_holder: e.target.value })} /></div>
                    <div className="space-y-2"><Label htmlFor="bank_account_number" className="text-xs">Account Number</Label><Input id="bank_account_number" placeholder="Enter bank account number" value={formData.bank_account_number} onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value })} /></div>
                    <div className="space-y-2"><Label htmlFor="bank_ifsc_code" className="text-xs">IFSC Code</Label><Input id="bank_ifsc_code" placeholder="e.g., SBIN0001234" value={formData.bank_ifsc_code} onChange={(e) => setFormData({ ...formData, bank_ifsc_code: e.target.value.toUpperCase() })} /></div>
                  </div>
                </div>
                {sellerProfile && primaryGroup && <LicenseUploadSection sellerId={sellerProfile.id} primaryGroup={primaryGroup} />}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-card border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <Button className="w-full h-12" onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="animate-spin mr-2" size={18} /> : null} Save Changes
        </Button>
      </div>
    </AppLayout>
  );
}
