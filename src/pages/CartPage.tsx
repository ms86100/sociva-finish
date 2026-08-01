// @ts-nocheck
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Minus, Plus, Clock, Store, MapPin, Bell, ChevronRight, Trash2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Button } from '@/components/ui/button';
import { VegBadge } from '@/components/ui/veg-badge';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { PaymentMethodSelector } from '@/components/payment/PaymentMethodSelector';
import { RazorpayCheckout } from '@/components/payment/RazorpayCheckout';
import { UpiDeepLinkCheckout } from '@/components/payment/UpiDeepLinkCheckout';
import { CouponInput } from '@/components/cart/CouponInput';
import { FulfillmentSelector } from '@/components/delivery/FulfillmentSelector';
import { OrderProgressOverlay } from '@/components/checkout/OrderProgressOverlay';
import { PreorderDatePicker } from '@/components/checkout/PreorderDatePicker';
import { useCartPage } from '@/hooks/useCartPage';
import { BuyAgainRow } from '@/components/home/BuyAgainRow';
import { motion, AnimatePresence } from 'framer-motion';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';
import { LottieEmptyState } from '@/components/ui/LottieEmptyState';
import { AlertCircle } from 'lucide-react';
import { CartClearedAnimation } from '@/components/cart/CartClearedAnimation';
import { AddressPicker } from '@/components/profile/AddressPicker';
import { Switch } from '@/components/ui/switch';

export default function CartPage() {
  const c = useCartPage();
  const ml = useMarketplaceLabels();
  const navigate = useNavigate();
  const [showReviewSheet, setShowReviewSheet] = useState(false);
  const [justCleared, setJustCleared] = useState(false);

  const shouldBlockCheckoutShell =
    c.items.length === 0 &&
    (
      c.isLoading ||
      c.isFetching ||
      !c.hasHydrated ||
      !c.cartVerified ||
      c.pendingMutations > 0 ||
      c.isRecoveringCart
    );

  if (shouldBlockCheckoutShell) {
    return (
      <AppLayout showHeader={false} showCart={false}>
        <div className="p-4 safe-top">
          <button onClick={() => navigate(-1)} className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted mb-6"><ArrowLeft size={18} /></button>
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center animate-pulse"><span className="text-4xl">🛒</span></div>
            <p className="text-sm text-muted-foreground">Loading your cart…</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (c.items.length === 0 && !c.hasActivePaymentSession && c.pendingMutations === 0 && !c.isFetching && !c.isRecoveringCart && c.cartVerified) {
    return (
      <AppLayout showHeader={false} showCart={false}>
         <div className="p-4 safe-top">
          <button onClick={() => navigate(-1)} className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted mb-6"><ArrowLeft size={18} /></button>
          <AnimatePresence mode="wait">
            {justCleared ? (
              <CartClearedAnimation key="cleared" onComplete={() => setJustCleared(false)} />
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                className="text-center py-10"
              >
                <LottieEmptyState
                  emoji="🛒"
                  title="Your cart is empty"
                  description="Discover products from sellers in your community"
                >
                  <Link to="/search"><Button size="sm">Explore Marketplace</Button></Link>
                </LottieEmptyState>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </AppLayout>
    );
  }

  // Bug 9: Cart empty but pending payment session — show a clear escape hatch
  if (c.items.length === 0 && c.hasActivePaymentSession && c.pendingMutations === 0 && !c.isFetching && !c.isRecoveringCart) {
    return (
      <AppLayout showHeader={false} showCart={false}>
        <div className="p-4 safe-top">
          <button onClick={() => navigate(-1)} className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted mb-6"><ArrowLeft size={18} /></button>
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-warning/10 flex items-center justify-center"><span className="text-4xl">⏳</span></div>
            <h2 className="text-lg font-bold mb-1">Pending Payment</h2>
            <p className="text-sm text-muted-foreground mb-6">You have an incomplete payment. Complete it or cancel to start fresh.</p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={async () => {
                if (c.pendingOrderIds.length > 0) {
                  const { supabase: sb } = await import('@/integrations/supabase/client');
                  try { await sb.rpc('buyer_cancel_pending_orders', { _order_ids: c.pendingOrderIds }); } catch {}
                }
                c.clearPendingPayment();
              }}>Cancel Payment</Button>
              {c.paymentMode.isRazorpay && c.pendingOrderIds.length > 0 && (
                <Button onClick={() => c.retryPendingPayment()}>Retry Payment</Button>
              )}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  const communityText = ml.label('label_checkout_community_support')
    .replace('{count}', String(c.sellerGroups.length))
    .replace('{suffix}', c.sellerGroups.length !== 1 ? 'es' : '');

  return (
    <AppLayout showHeader={false} showNav={false} showCart={false}>
      <div className="pb-[26rem]">
        {/* Sticky Header */}
        <SafeHeader>
        <div className="px-4 pb-3.5 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0"><ArrowLeft size={18} /></button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold">Checkout</h1>
            <p className="text-xs text-muted-foreground">Shipment of {c.itemCount} item{c.itemCount !== 1 ? 's' : ''}</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="ghost" size="sm" className="text-destructive text-xs h-8 min-w-[44px] px-2">Clear</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Clear cart?</AlertDialogTitle><AlertDialogDescription>This will remove all items from your cart. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={async () => { c.setAppliedCoupon(null); if (c.hasActivePaymentSession && c.pendingOrderIds.length > 0) { try { const { rpc } = await import('@/integrations/supabase/client').then(m => ({ rpc: m.supabase.rpc })); await rpc('buyer_cancel_pending_orders', { _order_ids: c.pendingOrderIds }); } catch {} } setJustCleared(true); c.clearCart(); c.clearPendingPayment(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Clear All</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        </SafeHeader>

        {/* Delivery Time — #4: show estimate for all fulfillment types */}
        {c.maxPrepTime > 0 && (
          <div className="mx-4 mt-3 flex items-center gap-3 bg-primary/5 border border-primary/15 rounded-xl p-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Clock size={18} className="text-primary" /></div>
            <div>
              {c.fulfillmentType === 'delivery' ? (
                <><p className="text-sm font-semibold">Estimated delivery: ~{c.maxPrepTime + 15} minutes</p><p className="text-xs text-muted-foreground">Includes preparation + delivery time</p></>
              ) : (
                <><p className="text-sm font-semibold">Ready in ~{c.maxPrepTime} minutes</p><p className="text-xs text-muted-foreground">Estimated preparation time</p></>
              )}
            </div>
          </div>
        )}

        {/* Urgent Warning */}
        {c.hasUrgentItem && (
          <div className="mx-4 mt-3 bg-warning/10 border border-warning/30 rounded-xl p-3 flex items-start gap-3">
            <Bell className="text-warning shrink-0 mt-0.5" size={16} />
            <div className="text-xs"><p className="font-medium text-warning-foreground">Time-sensitive order</p><p className="text-muted-foreground mt-0.5">Seller must respond within 3 min or auto-cancelled</p></div>
          </div>
        )}

        {c.hasActivePaymentSession && (
          <div className="mx-4 mt-3 bg-primary/5 border border-primary/20 rounded-xl p-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-primary shrink-0 mt-0.5" size={16} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Pending payment in progress</p>
                <p className="text-xs text-muted-foreground mt-0.5">Complete the pending payment for {c.sessionSellerName || 'this seller'} or cancel it before placing a fresh order.</p>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" onClick={() => c.retryPendingPayment()}>Continue Payment</Button>
                  <Button size="sm" variant="outline" onClick={() => c.clearPendingPayment()}>Cancel Pending Payment</Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Min order warnings */}
        {c.sellerGroups.map((group) => {
          const minOrder = (group.items[0]?.product?.seller as any)?.minimum_order_amount;
          const belowMinimum = minOrder && group.subtotal < minOrder;
          if (!belowMinimum) return null;
          return (
            <div key={`warn-${group.sellerId}`} className="mx-4 mt-3">
              <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 flex items-start gap-3">
                <Store className="text-warning shrink-0 mt-0.5" size={16} />
                <div className="text-xs"><p className="font-medium text-warning-foreground">{group.sellerName}: Minimum order {c.formatPrice(minOrder)}</p><p className="text-muted-foreground mt-0.5">Add {c.formatPrice(minOrder - group.subtotal)} more to place this order</p></div>
              </div>
            </div>
          );
        })}

        {/* #5: Multi-seller cart explanation — prominent */}
        {c.sellerGroups.length > 1 && (
          <div className="mx-4 mt-3 flex items-start gap-3 bg-muted border border-border rounded-xl p-3">
            <AlertCircle size={16} className="text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Your cart has items from {c.sellerGroups.length} sellers</p>
              <p className="text-xs text-muted-foreground mt-0.5">Separate orders will be created for each. Each seller will receive and fulfill their order independently.</p>
            </div>
          </div>
        )}

        {/* Cart Items by Seller */}
        <div className="mt-4 space-y-3 px-4">
          {c.sellerGroups.map((group) => (
            <div key={group.sellerId} className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
                <Store size={14} className="text-primary" />
                <span className="text-sm font-semibold flex-1 truncate">{group.sellerName}</span>
                {/* #6: Seller contact shortcut */}
                <Link to={`/seller/${group.sellerId}`} className="text-[10px] text-primary font-medium shrink-0">View Store</Link>
                <span className="text-xs text-muted-foreground">{group.items.length} item{group.items.length > 1 ? 's' : ''}</span>
              </div>
              {c.profile?.society_id && (group.items[0]?.product?.seller as any)?.society_id && (group.items[0]?.product?.seller as any)?.society_id !== c.profile.society_id && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground bg-muted"><MapPin size={11} /><span>Seller from another community</span></div>
              )}
              <AnimatePresence initial={false}>
                {group.items.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -40, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                    className="flex items-center gap-3 px-3 py-3 border-b border-border last:border-0"
                  >
                    <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0 bg-muted">
                      {item.product?.image_url ? <img src={item.product.image_url} alt={item.product.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-lg">🛍️</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      {item.product ? (<>
                        <div className="flex items-center gap-1.5">
                          <VegBadge isVeg={item.product.is_veg ?? true} size="sm" />
                          <h4 className="text-sm font-medium truncate">{item.product.name}</h4>
                          {(item.product as any)?.accepts_preorders && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-accent/15 text-accent text-[10px] font-semibold"><Clock size={9} />Pre-order</span>
                          )}
                        </div>
                        <p className="text-sm font-bold mt-0.5">{c.formatPrice(item.product.price * item.quantity)}</p>
                        <p className="text-[11px] text-muted-foreground">{c.formatPrice(item.product.price)} × {item.quantity}</p>
                      </>) : (<p className="text-sm text-muted-foreground italic">Item unavailable</p>)}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {item.product && (
                        <div className="inline-flex items-center bg-accent rounded-lg overflow-hidden">
                          <button className="h-8 w-8 flex items-center justify-center active:scale-95 transition-transform" onClick={() => { c.updateQuantity(item.product_id, item.quantity - 1); }}><Minus size={14} className="text-accent-foreground" /></button>
                          <AnimatePresence mode="popLayout"><motion.span key={item.quantity} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.15 }} className="w-6 text-center text-sm font-bold text-accent-foreground tabular-nums">{item.quantity}</motion.span></AnimatePresence>
                          <button className="h-8 w-8 flex items-center justify-center active:scale-95 transition-transform" onClick={() => { c.updateQuantity(item.product_id, item.quantity + 1); }}><Plus size={14} className="text-accent-foreground" /></button>
                        </div>
                      )}
                      <button className="h-8 w-8 flex items-center justify-center text-muted-foreground" onClick={() => { c.removeItem(item.product_id); }}><Trash2 size={15} /></button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {/* #12: Add more from this seller */}
              <Link
                to={`/seller/${group.sellerId}`}
                className="flex items-center justify-center gap-1.5 px-3 py-2 border-t border-border text-xs font-semibold text-primary hover:bg-primary/5 transition-colors"
              >
                <Plus size={12} /> Add more from {group.sellerName}
              </Link>
            </div>
          ))}
        </div>

        {/* Notes */}
        <div className="mt-4 px-4">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Instructions</label>
          <Textarea placeholder="e.g., Less spicy, no onions..." value={c.notes} onChange={(e) => c.setNotes(e.target.value)} rows={2} className="text-sm" />
        </div>

        {/* Payment Method */}
        <div className="mt-5 px-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Payment Method</h3>
          <PaymentMethodSelector acceptsCod={c.acceptsCod} acceptsUpi={c.acceptsUpi} selectedMethod={c.paymentMethod} onSelect={c.setPaymentMethod} />
        </div>

        {/* Fulfillment */}
        <div className="mt-5 px-4">
          <FulfillmentSelector value={c.fulfillmentType} onChange={c.setFulfillmentType} deliveryFee={c.settings.baseDeliveryFee} freeDeliveryThreshold={c.settings.freeDeliveryThreshold} orderValue={c.totalAmount} sellerFulfillmentMode={c.sellerGroups.length === 1 ? c.firstSellerFulfillmentMode : undefined} />
          {c.hasFulfillmentConflict && (
            <p className="text-xs text-warning mt-2 bg-warning/10 rounded-lg px-3 py-2">⚠️ Some sellers don't support this fulfillment mode. Separate handling may apply.</p>
          )}
        </div>

        {/* Pre-order scheduling (mandatory) */}
        {c.hasPreorderItems && (
          <div className="mt-5 px-4">
            <PreorderDatePicker
              leadTimeHours={c.maxLeadTimeHours}
              selectedDate={c.scheduledDate}
              selectedTime={c.scheduledTime}
              onDateChange={c.setScheduledDate}
              onTimeChange={c.setScheduledTime}
              cutoffTime={c.preorderCutoffTime}
            />
            <p className="text-[11px] text-destructive mt-1 font-medium">* Scheduling is required for pre-order items</p>
          </div>
        )}

        {/* Optional scheduling for non-pre-order carts */}
        {!c.hasPreorderItems && (
          <div className="mt-5 px-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Schedule for later?</p>
                <p className="text-[11px] text-muted-foreground">Choose a preferred delivery date & time</p>
              </div>
              <Switch checked={c.wantsScheduledDelivery} onCheckedChange={c.setWantsScheduledDelivery} />
            </div>
            {c.wantsScheduledDelivery && (
              <div className="mt-3">
                <PreorderDatePicker
                  leadTimeHours={0}
                  selectedDate={c.scheduledDate}
                  selectedTime={c.scheduledTime}
                  onDateChange={c.setScheduledDate}
                  onTimeChange={c.setScheduledTime}
                  cutoffTime={null}
                />
              </div>
            )}
          </div>
        )}

        {/* Coupon */}
        {c.sellerGroups.length === 1 ? (
          <div className="mt-5 px-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Apply Coupon</h3>
            <CouponInput key={c.sellerGroups[0].sellerId} sellerId={c.sellerGroups[0].sellerId} totalAmount={c.totalAmount} onApply={c.setAppliedCoupon} onRemove={() => c.setAppliedCoupon(null)} appliedCoupon={c.appliedCoupon} />
          </div>
        ) : c.sellerGroups.length > 1 ? (
          <div className="mt-5 px-4"><p className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">Coupons are not available for multi-seller carts.</p></div>
        ) : null}

        {/* Loyalty Points */}
        {c.loyalty.balance > 0 && (
          <div className="mt-5 px-4">
            <div className="flex items-center justify-between bg-primary/5 border border-primary/15 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">🎁</span>
                <div>
                  <p className="text-sm font-semibold">Use Loyalty Points</p>
                  <p className="text-[11px] text-muted-foreground">{c.loyalty.balance} points available (= {c.formatPrice(c.loyalty.balance)} off)</p>
                </div>
              </div>
              <Switch
                checked={c.loyalty.appliedPoints > 0}
                onCheckedChange={() => c.loyalty.togglePoints(c.totalAmount - c.effectiveCouponDiscount)}
              />
            </div>
            {c.effectiveLoyaltyDiscount > 0 && (
              <p className="text-xs text-primary font-medium mt-1.5 ml-1">
                🎉 {c.effectiveLoyaltyDiscount} points will save you {c.formatPrice(c.effectiveLoyaltyDiscount)}
              </p>
            )}
          </div>
        )}

        {/* Bill Details */}
        <div className="mt-5 mx-4 bg-muted rounded-xl p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Bill Details</h3>
          <div className="space-y-2 text-sm">
            {c.sellerGroups.map((group) => (<div key={group.sellerId} className="flex justify-between"><span className="text-muted-foreground truncate mr-2">{group.sellerName}</span><span className="font-medium">{c.formatPrice(group.subtotal)}</span></div>))}
            {c.appliedCoupon && (<div className="flex justify-between text-primary"><span>Coupon ({c.appliedCoupon.code})</span><span>-{c.formatPrice(Math.min(c.effectiveCouponDiscount, c.totalAmount))}</span></div>)}
            {c.effectiveLoyaltyDiscount > 0 && (<div className="flex justify-between text-primary"><span>Loyalty Points</span><span>-{c.formatPrice(c.effectiveLoyaltyDiscount)}</span></div>)}
            <div className="flex justify-between"><span className="text-muted-foreground">Delivery Fee</span><span className={`font-medium ${c.effectiveDeliveryFee === 0 ? 'text-primary' : ''}`}>{c.fulfillmentType === 'delivery' ? (c.effectiveDeliveryFee === 0 ? 'FREE' : c.formatPrice(c.effectiveDeliveryFee)) : 'Self Pickup'}</span></div>
            <div className="border-t border-border pt-2 mt-1 flex justify-between font-bold"><span>To Pay</span><span>{c.formatPrice(c.finalAmount)}</span></div>
          </div>
        </div>

        {/* Address */}
        <div className="mt-4 mx-4 bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <MapPin size={16} className="text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            {c.fulfillmentType === 'self_pickup' ? (
              <><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pickup from</p><p className="text-sm font-medium mt-0.5">{c.sellerGroups[0]?.sellerName || ''}</p><p className="text-xs text-muted-foreground">{c.society?.name || 'Your Society'}</p></>
            ) : c.selectedDeliveryAddress ? (
              <>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Deliver to</p>
                <p className="text-sm font-medium mt-0.5">{c.selectedDeliveryAddress.label}</p>
                <p className="text-xs text-muted-foreground">{[c.selectedDeliveryAddress.flat_number && `Flat ${c.selectedDeliveryAddress.flat_number}`, c.selectedDeliveryAddress.block && `Block ${c.selectedDeliveryAddress.block}`, c.selectedDeliveryAddress.building_name].filter(Boolean).join(', ')}</p>
                {!c.selectedDeliveryAddress.latitude && (
                  <p className="text-[10px] text-warning flex items-center gap-1 mt-1"><AlertTriangle size={10} /> No location pin — update address for delivery</p>
                )}
              </>
            ) : (
              <>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Deliver to</p>
                <p className="text-sm text-muted-foreground mt-0.5">{c.addresses.length === 0 ? 'No saved addresses' : 'Select a delivery address'}</p>
              </>
            )}
          </div>
          {c.fulfillmentType !== 'self_pickup' && (
            c.addresses.length > 0 ? (
              <AddressPicker selectedId={c.selectedDeliveryAddress?.id} onSelect={c.setSelectedDeliveryAddress} />
            ) : (
              <Link to="/profile/edit" className="text-xs text-primary font-semibold shrink-0">Add</Link>
            )
          )}
        </div>

        {/* Multi-seller note moved to top — see #5 above */}

        {/* Refund Promise */}
        <div className="mx-4 mt-4 flex items-center gap-3 bg-primary/5 border border-primary/15 rounded-xl p-3">
          <ShieldCheck size={18} className="text-primary shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground leading-relaxed">{c.settings.refundPromiseText}</p>
            <p className="text-[10px] text-muted-foreground mt-1">You can cancel for free before the seller accepts. UPI refunds process within 24 hours.</p>
          </div>
        </div>

        {/* Neighborhood Guarantee */}
        {/* Browse more shortcut */}
        <div className="mx-4 mt-3 text-center">
          <Link to="/search" className="text-xs font-semibold text-primary hover:underline">+ Browse more items</Link>
        </div>

        <div className="mx-4 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <span className="text-sm">{ml.label('label_neighborhood_guarantee_emoji')}</span>
          <p className="text-[10px] text-muted-foreground">
            {(() => {
              const badge = ml.label('label_neighborhood_guarantee_badge');
              const guarantee = ml.label('label_neighborhood_guarantee');
              const parts = badge.split(guarantee);
              if (parts.length < 2) return badge;
              return <>{parts[0]}<span className="font-semibold text-foreground">{guarantee}</span>{parts[1]}</>;
            })()}
          </p>
        </div>
      </div>

      {/* Sticky Footer */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-background border-t border-border pb-[env(safe-area-inset-bottom)]">
        {c.noPaymentMethodAvailable && (
          <div className="mx-4 mt-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            <p className="text-xs text-destructive font-medium">No payment method available for this cart. Try ordering from each seller separately.</p>
          </div>
        )}
        {c.sellerGroups.length > 0 && (
          <p className="text-[11px] text-primary font-medium text-center pt-2.5 px-4 flex items-center justify-center gap-1.5">
            <span className="text-base">{ml.label('label_checkout_community_emoji')}</span>
            {communityText}
          </p>
        )}
        {/* Checkout reinforcement micro-copy */}
        {c.fulfillmentType === 'delivery' && c.settings.freeDeliveryThreshold > 0 && (
          c.totalAmount >= c.settings.freeDeliveryThreshold ? (
            <p className="text-[10px] text-accent font-semibold text-center pt-1 px-4">🎉 Free delivery unlocked!</p>
          ) : (
            <p className="text-[10px] text-muted-foreground text-center pt-1 px-4">Add {c.formatPrice(c.settings.freeDeliveryThreshold - c.totalAmount)} more for free delivery</p>
          )
        )}
        <p className="text-[10px] text-muted-foreground text-center pt-1 px-4">Payments are processed by third-party providers and are not covered by Apple. <Link to="/terms" className="underline">Refund & Cancellation Policy</Link></p>
        <div className="px-4 py-3">
          {c.fulfillmentType === 'delivery' && !c.selectedDeliveryAddress && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mb-2 border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => navigate('/profile/addresses', { state: { returnTo: '/cart' } })}
            >
              <MapPin size={14} className="mr-1.5" />
              Add a delivery address to continue
            </Button>
          )}
          {c.preorderMissingSchedule && (
              <p className="text-xs text-destructive font-medium text-center mb-2">Please select a delivery date & time for pre-order items</p>
            )}
            <div className="flex items-center gap-3">
              <div className="flex-1"><p className="text-xs text-muted-foreground">Total</p><motion.p className="text-lg font-bold tabular-nums" key={c.finalAmount} initial={{ scale: 0.9, opacity: 0.5 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.2 }}>{c.formatPrice(c.finalAmount)}</motion.p></div>
              <Button className="px-8 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold" size="lg" onClick={() => c.setShowConfirmDialog(true)} disabled={c.isPlacingOrder || c.hasBelowMinimumOrder || c.noPaymentMethodAvailable || c.hasFulfillmentConflict || (c.fulfillmentType === 'delivery' && !c.selectedDeliveryAddress) || c.preorderMissingSchedule}>{c.isPlacingOrder ? 'Placing...' : 'Place Order'}<ChevronRight size={18} className="ml-1" /></Button>
            </div>
        </div>
      </div>

      {/* Confirm Dialog */}
      <AlertDialog open={c.showConfirmDialog} onOpenChange={c.setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Your Order</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {/* Prominent fulfillment badge */}
                <div className={`flex items-center gap-2 p-2.5 rounded-lg border-2 ${c.fulfillmentType === 'delivery' ? 'border-primary bg-primary/5' : 'border-accent bg-accent/10'}`}>
                  <span className="text-lg">{c.fulfillmentType === 'delivery' ? '🚚' : '📦'}</span>
                  <span className="font-semibold text-foreground">{c.fulfillmentType === 'delivery' ? 'Delivery' : 'Self Pickup'}</span>
                </div>
                <div className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="font-medium">{c.itemCount} item{c.itemCount !== 1 ? 's' : ''}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Payment</span><span className="font-medium">{c.paymentMethod === 'cod' ? 'Cash on Delivery' : (c.paymentMode.isRazorpay ? 'Online Payment' : 'UPI')}</span></div>
                {/* #9: Prominent delivery address in confirm dialog */}
                {c.fulfillmentType === 'self_pickup' ? (
                  <div className="flex justify-between"><span className="text-muted-foreground">Pickup from</span><span className="font-medium text-right">{c.sellerGroups[0]?.sellerName || 'Seller'}</span></div>
                ) : c.selectedDeliveryAddress ? (
                  <div className="bg-muted rounded-lg p-2.5">
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Deliver to</p>
                    <p className="font-medium">{c.selectedDeliveryAddress.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{[c.selectedDeliveryAddress.flat_number && `Flat ${c.selectedDeliveryAddress.flat_number}`, c.selectedDeliveryAddress.block && `Block ${c.selectedDeliveryAddress.block}`, c.selectedDeliveryAddress.building_name].filter(Boolean).join(', ')}</p>
                  </div>
                ) : (
                  <div className="flex justify-between"><span className="text-muted-foreground">Deliver to</span><span className="font-medium text-right text-warning">Not set</span></div>
                )}
                {c.sellerGroups.length > 1 && <p className="text-xs text-muted-foreground">{c.sellerGroups.length} separate orders will be created.</p>}
                <div className="flex justify-between border-t border-border pt-2 font-bold"><span>Total</span><span>{c.formatPrice(c.finalAmount || c.sessionAmount)}</span></div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => { c.setShowConfirmDialog(false); setShowReviewSheet(true); }}>Review Cart</Button>
            <AlertDialogAction onClick={c.handlePlaceOrder}>Confirm Order</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Review Cart Sheet */}
      <Sheet open={showReviewSheet} onOpenChange={setShowReviewSheet}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="text-left">
            <SheetTitle>Order Summary</SheetTitle>
            <SheetDescription>Review your items before confirming</SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            {/* Items by seller */}
            {c.sellerGroups.map((group) => (
              <div key={group.sellerId} className="border border-border rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-muted flex items-center gap-2">
                  <Store size={14} className="text-primary" />
                  <span className="text-sm font-semibold">{group.sellerName}</span>
                </div>
                <div className="divide-y divide-border">
                  {group.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.product?.name || 'Item'}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {c.formatPrice(item.product?.price || 0)} × {item.quantity}
                        </p>
                      </div>
                      <span className="text-sm font-bold tabular-nums ml-3">
                        {c.formatPrice((item.product?.price || 0) * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="px-3 py-2 bg-muted/50 flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-semibold">{c.formatPrice(group.subtotal)}</span>
                </div>
              </div>
            ))}

            {/* Pricing breakdown */}
            <div className="bg-muted rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items Total</span>
                <span className="font-medium">{c.formatPrice(c.totalAmount)}</span>
              </div>
              {c.appliedCoupon && (
                <div className="flex justify-between text-primary">
                  <span>Coupon ({c.appliedCoupon.code})</span>
                  <span>-{c.formatPrice(Math.min(c.effectiveCouponDiscount, c.totalAmount))}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Delivery</span>
                <span className={`font-medium ${c.effectiveDeliveryFee === 0 ? 'text-primary' : ''}`}>
                  {c.fulfillmentType === 'delivery' ? (c.effectiveDeliveryFee === 0 ? 'FREE' : c.formatPrice(c.effectiveDeliveryFee)) : 'Self Pickup'}
                </span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between font-bold text-base">
                <span>Total</span>
                <span>{c.formatPrice(c.finalAmount)}</span>
              </div>
            </div>

            {/* Fulfillment & Payment */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-lg">{c.fulfillmentType === 'delivery' ? '🚚' : '📦'}</span>
                <span className="text-sm font-medium">{c.fulfillmentType === 'delivery' ? 'Delivery' : 'Self Pickup'}</span>
              </div>
              {c.fulfillmentType === 'delivery' && c.selectedDeliveryAddress && (
                <div className="px-1">
                  <p className="text-xs text-muted-foreground">
                    {[c.selectedDeliveryAddress.label, c.selectedDeliveryAddress.flat_number && `Flat ${c.selectedDeliveryAddress.flat_number}`, c.selectedDeliveryAddress.building_name].filter(Boolean).join(' • ')}
                  </p>
                </div>
              )}
              <div className="flex items-center gap-2 px-1">
                <span className="text-lg">💳</span>
                <span className="text-sm font-medium">
                  {c.paymentMethod === 'cod' ? 'Cash on Delivery' : (c.paymentMode?.isRazorpay ? 'Online Payment' : 'UPI')}
                </span>
              </div>
            </div>

            {/* Confirm button */}
            <Button
              className="w-full rounded-xl font-bold"
              size="lg"
              onClick={() => { setShowReviewSheet(false); c.setShowConfirmDialog(true); }}
            >
              Looks Good, Confirm
              <ChevronRight size={18} className="ml-1" />
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!c.priceChangeInfo} onOpenChange={(open) => { if (!open) c.dismissPriceChangeInfo(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Prices were updated</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>The seller updated one or more item prices before checkout. Your cart has already been refreshed with the latest prices.</p>
                {!!c.priceChangeInfo?.items?.length && (
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Changed items</p>
                    <ul className="space-y-1 text-sm">
                      {c.priceChangeInfo.items.map((item: string) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="font-medium">New total: {c.formatPrice(c.finalAmount)}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => c.dismissPriceChangeInfo()}>Review Cart</AlertDialogCancel>
            <AlertDialogAction onClick={() => c.continueWithUpdatedPrices()}>Continue with Updated Total</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <OrderProgressOverlay isVisible={c.isPlacingOrder && c.paymentMethod !== 'cod'} step={c.orderStep} />

      <Sheet open={!!c.paymentFailureInfo} onOpenChange={(open) => { if (!open) c.dismissPaymentFailure(); }}>
        <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 text-destructive"><AlertTriangle size={20} />Payment Not Completed</SheetTitle>
            <SheetDescription>Payment of {c.formatPrice(c.paymentFailureInfo?.amount || 0)} to {c.paymentFailureInfo?.sellerName || 'Seller'} was not completed. Your order has been cancelled but your cart items are saved.</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-3">
            <Button className="w-full" onClick={() => c.retryPaymentAfterFailure()}>Try Again</Button>
            <Button variant="outline" className="w-full" onClick={() => c.dismissPaymentFailure()}>Cancel & Return to Cart</Button>
          </div>
        </SheetContent>
      </Sheet>

      {c.pendingOrderIds.length > 0 && c.paymentMode.isRazorpay && (
        <RazorpayCheckout isOpen={c.showRazorpayCheckout} onClose={() => {}} orderId={c.pendingOrderIds[0]} orderIds={c.pendingOrderIds} amount={c.finalAmount || c.sessionAmount} sellerId={c.sellerGroups[0]?.sellerId || ''} sellerName={c.sellerGroups[0]?.sellerName || c.sessionSellerName} customerName={c.profile?.name || ''} customerEmail={c.user?.email || ''} customerPhone={c.profile?.phone || ''} onPaymentSuccess={c.handleRazorpaySuccess} onPaymentFailed={c.handleRazorpayFailed} onDismiss={c.handleRazorpayDismiss} />
      )}

      {/* CRITICAL: Render UPI sheet whenever pendingOrderIds exist — independent of cart state.
          This prevents the sheet from unmounting when cart items refetch as empty during app-switch. */}
      {c.pendingOrderIds.length > 0 && (
        <UpiDeepLinkCheckout isOpen={c.showUpiDeepLink} onClose={() => c.setShowUpiDeepLink(false)} orderId={c.pendingOrderIds[0]} amount={(c.sellerGroups.length > 0 ? c.finalAmount : c.sessionAmount) || c.finalAmount} sellerUpiId={(c.sellerGroups[0]?.items[0]?.product?.seller as any)?.upi_id || c.sessionSellerUpiId} sellerName={c.sellerGroups[0]?.sellerName || c.sessionSellerName} onPaymentConfirmed={c.handleUpiDeepLinkSuccess} onPaymentFailed={c.handleUpiDeepLinkFailed} />
      )}
    </AppLayout>
  );
}
