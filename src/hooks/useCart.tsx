// @ts-nocheck
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, ReactNode, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { buyerCanOrderFromSeller } from '@/lib/sellerDiscoverability';
import { PRECISE_LOCATION_TITLE } from '@/lib/buyerLocation';
import { CartItem, Product } from '@/types/Database';
import { toast } from 'sonner';
import { handleApiError } from '@/lib/query-utils';
import { computeStoreStatus, formatStoreClosedMessage, type StoreStatus } from '@/lib/store-availability';
import { feedbackAddItem, feedbackAddItemFailed, feedbackRemoveItem, feedbackRemoveItemFailed, feedbackQuantityChanged, feedbackQuantityFailed } from '@/lib/feedbackEngine';
import { notify } from '@/lib/notify';
import { CartPopupProvider, useCartPopup } from '@/components/CartPopupProvider';

const hasOwn = (obj: unknown, key: string) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);

/**
 * Routes that need the full cart-items JOIN (with product+seller).
 * Other routes only need the count badge from `useCartCount`.
 */
const CART_ACTIVE_PATH_PATTERNS: RegExp[] = [
  /^\/$/,                    // Home
  /^\/cart/,
  /^\/search/,
  /^\/seller\/[^/]+$/,       // Seller detail (NOT /seller dashboard)
  /^\/product\//,
  /^\/category(\/|$)/,
  /^\/categories$/,
  /^\/discovery\//,
  /^\/festival-collection\//,
  /^\/favorites/,
];

function useIsCartActiveRoute(): boolean {
  const location = useLocation();
  const [homeDeferredReady, setHomeDeferredReady] = useState(false);
  const pathname = location.pathname;
  const isHome = pathname === '/' || pathname === '';

  const matches = useMemo(
    () => CART_ACTIVE_PATH_PATTERNS.some((re) => re.test(pathname)),
    [pathname]
  );

  // Home needs cart for add-to-cart steppers, but the full JOIN must not race
  // marketplace RPCs on cold start — wait ~1.2s after landing on /.
  useEffect(() => {
    if (!isHome) {
      setHomeDeferredReady(true);
      return;
    }
    setHomeDeferredReady(false);
    const t = window.setTimeout(() => setHomeDeferredReady(true), 1200);
    return () => window.clearTimeout(t);
  }, [isHome, pathname]);

  if (isHome) return homeDeferredReady;
  return matches;
}

/**
 * CART INTEGRITY CONTRACT
 * -----------------------
 * The cart badge (useCartCount / BottomNav) and the cart page (useCart / CartPage)
 * MUST always agree. The following multi-layer defenses ensure that the cart page
 * can NEVER show "Your cart is empty" while the badge shows a non-zero count:
 *
 * Layer 1 — queryFn self-heal: If fetchCartItems returns [], we do a cheap COUNT
 *           check. If rows exist, we retry once with a delay. This catches transient
 *           PostgREST/network glitches at the data layer.
 *
 * Layer 2 — reconcile guard: After mutations, reconcile() double-checks before
 *           accepting an empty result. If the count query disagrees, it invalidates
 *           instead of clobbering the cache.
 *
 * Layer 3 — mismatch recovery: A useEffect detects when items=[] but the count
 *           cache says >0. It triggers up to 3 aggressive refetches with staggered
 *           delays (0ms, 500ms, 1500ms). isRecoveringCart stays true throughout.
 *
 * Layer 4 — CartPage veto: The empty-state UI is gated on BOTH items.length===0
 *           AND !isRecoveringCart AND !isFetching AND pendingMutations===0.
 *           This is the last line of defense — even if all other layers fail,
 *           the user sees "Loading your cart…" instead of a false empty state.
 */

function parseStoreAvailabilityError(error: unknown): string | null {
  const msg = String((error as any)?.message || '');
  const statusMatch = msg.match(/STORE_CLOSED:([a-z_]+)/i);
  if (statusMatch?.[1]) {
    const status = statusMatch[1].toLowerCase() as StoreStatus;
    return formatStoreClosedMessage({ status, nextOpenAt: null, minutesUntilOpen: null }) || 'This store is currently closed.';
  }
  if (msg.includes('PRODUCT_NOT_ORDERABLE')) return 'This item is no longer available.';
  if (msg.includes('SELLER_NOT_FOUND')) return 'Seller is unavailable right now.';
  return null;
}

function getInlineSellerAvailability(product: Product) {
  const p = product as any;
  const seller = p?.seller as any;
  const hasProductAvailabilityFields =
    hasOwn(p, 'seller_availability_start') || hasOwn(p, 'seller_availability_end') ||
    hasOwn(p, 'seller_operating_days') || hasOwn(p, 'seller_is_available');
  const hasSellerAvailabilityFields = !!seller && (
    hasOwn(seller, 'availability_start') || hasOwn(seller, 'availability_end') ||
    hasOwn(seller, 'operating_days') || hasOwn(seller, 'is_available'));
  return {
    hasInlineAvailability: hasProductAvailabilityFields || hasSellerAvailabilityFields,
    availabilityStart: p.seller_availability_start ?? seller?.availability_start ?? null,
    availabilityEnd: p.seller_availability_end ?? seller?.availability_end ?? null,
    operatingDays: p.seller_operating_days ?? seller?.operating_days ?? null,
    isAvailable: p.seller_is_available ?? seller?.is_available ?? true,
  };
}

interface SellerGroup {
  sellerId: string;
  sellerName: string;
  items: (CartItem & { product: Product })[];
  subtotal: number;
}

interface CartContextType {
  items: (CartItem & { product: Product })[];
  itemCount: number;
  totalAmount: number;
  sellerGroups: SellerGroup[];
  isLoading: boolean;
  isFetching: boolean;
  hasHydrated: boolean;
  isRecoveringCart: boolean;
  /** Number of cart mutations currently in-flight */
  pendingMutations: number;
  /** True once the cart state has been positively confirmed (items arrived or server verified empty) */
  cartVerified: boolean;
  addItem: (product: Product, quantity?: number, silent?: boolean, extras?: any[]) => Promise<boolean>;
  replaceCart: (inserts: { product_id: string; quantity: number }[]) => Promise<void>;
  updateQuantity: (productId: string, quantity: number) => Promise<void>;
  removeItem: (productId: string) => Promise<void>;
  clearCart: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_QUERY_KEY = ['cart-items'] as const;

// ── Shared authoritative fetch ──
async function fetchCartItems(userId: string) {
  const { data, error } = await supabase
    .from('cart_items')
    .select(`*, product:products(*, seller:seller_profiles(id, business_name, user_id, is_available, availability_start, availability_end, operating_days, profile_image_url, cover_image_url, primary_group, accepts_cod, accepts_upi, upi_id, upi_verification_status, fulfillment_mode, minimum_order_amount, daily_order_limit, pickup_payment_config, delivery_payment_config))`)
    .eq('user_id', userId);
  if (error) throw error;
  const items = (data as any as (CartItem & { product: Product })[]) || [];
  // Keep unavailable products visible so a refresh can warn instead of silently dropping them.
  const filtered = items.filter(item => item.product != null);

  // Layer 1 self-heal removed (perf): empty cart is overwhelmingly the common case
  // and the COUNT round-trip on every empty result doubles cart-fetch traffic.
  // Layers 2-4 (reconcile, mismatch recovery, CartPage veto) still cover the
  // rare PostgREST glitch case.

  return filtered;
}

async function fetchCartItemCount(userId: string) {
  const { data, error } = await supabase
    .from('cart_items')
    .select('quantity, product:products!inner(id)')
    .eq('user_id', userId);
  if (error) throw error;
  return (data || []).reduce((sum, row) => sum + (row.quantity || 0), 0);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, isSessionRestored } = useAuth();
  const { browsingLocation } = useBrowsingLocation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Popups — call at top level (valid hook location)
  const { showAddPopup, showRemovePopup } = useCartPopup();
  // Perf: stable userId string prevents query key churn from object reference changes
  const userId = user?.id ?? null;

  // Global mutation counter — prevents stale reads from overwriting optimistic state
  const mutationSeqRef = useRef(0);
  const [pendingMutations, setPendingMutations] = useState(0);
  const [recoveryAttempts, setRecoveryAttempts] = useState(0);
  const MAX_RECOVERY_ATTEMPTS = 3;
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Perf: only fetch the heavy cart-items JOIN on routes that actually display
  // cart contents. Other pages only need the count badge from `useCartCount`,
  // which is lightweight.
  const cartRouteActive = useIsCartActiveRoute();

  const { data: items = [], isLoading, isFetching, isFetched } = useQuery({
    queryKey: [...CART_QUERY_KEY, userId],
    queryFn: async () => {
      if (!userId) return [];
      return fetchCartItems(userId);
    },
    enabled: isSessionRestored && !!userId && cartRouteActive,
    staleTime: 2 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    
    refetchOnWindowFocus: false,
  });

  const { data: fallbackItemCount = 0 } = useQuery({
    queryKey: ['cart-count', userId],
    queryFn: async () => {
      if (!userId) return 0;
      return fetchCartItemCount(userId);
    },
    enabled: isSessionRestored && !!userId,
    staleTime: 2 * 60 * 1000,
  });

  // ── Mutation helpers ──
  const cartKey = useCallback(() => [...CART_QUERY_KEY, userId], [userId]);
  const countKey = useCallback(() => ['cart-count', userId], [userId]);

  /** Cancel in-flight cart queries so stale responses can't overwrite optimistic state */
  const cancelCartQueries = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey: CART_QUERY_KEY, exact: false });
    await queryClient.cancelQueries({ queryKey: ['cart-count'], exact: false });
  }, [queryClient]);

  /** Snapshot current cart state for rollback */
  const snapshot = useCallback(() => ({
    items: queryClient.getQueryData(cartKey()) as (CartItem & { product: Product })[] | undefined,
    count: queryClient.getQueryData(countKey()) as number | undefined,
  }), [queryClient, cartKey, countKey]);

  /** Restore snapshot on error */
  const rollback = useCallback((snap: ReturnType<typeof snapshot>) => {
    if (snap.items !== undefined) queryClient.setQueryData(cartKey(), snap.items);
    if (snap.count !== undefined) queryClient.setQueryData(countKey(), snap.count);
  }, [queryClient, cartKey, countKey]);

  const [cartVerified, setCartVerified] = useState(false);

  /** After a successful mutation, do an authoritative fetch and seed both caches */
  const reconcile = useCallback(async () => {
    if (!user) return;
    const seq = ++mutationSeqRef.current;
    try {
      const freshItems = await fetchCartItems(user.id);
      // Only apply if no newer mutation has started
      if (mutationSeqRef.current !== seq) return;

      // RULE 1: NEVER trust empty without server count verification
      if (freshItems.length === 0) {
        try {
          const verifyCount = await fetchCartItemCount(user.id);
          if (verifyCount > 0) {
            // Server has items — don't trust the empty result, force refetch
            queryClient.refetchQueries({ queryKey: cartKey(), exact: true });
            queryClient.refetchQueries({ queryKey: countKey(), exact: true });
            return;
          }
          // Genuinely empty — safe to write (server count confirms 0)
          queryClient.setQueryData(cartKey(), []);
          queryClient.setQueryData(countKey(), 0);
          setCartVerified(true);
        } catch {
          // Count check failed — be safe, invalidate (don't overwrite with empty)
          queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY, exact: false });
        }
        return;
      }

      queryClient.setQueryData(cartKey(), freshItems);
      queryClient.setQueryData(countKey(), freshItems.reduce((s, i) => s + i.quantity, 0));
      setCartVerified(true);
    } catch {
      // If reconcile fails, just invalidate — react-query will retry
      queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY, exact: false });
    }
  }, [user, queryClient, cartKey, countKey]);

  const setOptimistic = useCallback((updater: (prev: (CartItem & { product: Product })[]) => (CartItem & { product: Product })[]) => {
    queryClient.setQueryData(cartKey(), (old: any) => updater(old || []));
  }, [queryClient, cartKey]);

  const itemCount = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);
  const totalAmount = useMemo(() => items.reduce((sum, item) => sum + (item.product?.price || 0) * item.quantity, 0), [items]);
  // Layer 3: Detect mismatch — items array is empty but count cache says otherwise
  const hasCartCountMismatch = !!user && isFetched && !isFetching && pendingMutations === 0
    && items.length === 0 && fallbackItemCount > 0;
  const isRecoveringCart = hasCartCountMismatch && recoveryAttempts < MAX_RECOVERY_ATTEMPTS;

  const sellerGroups: SellerGroup[] = useMemo(() =>
    Object.values(
      items.reduce<Record<string, SellerGroup>>((groups, item) => {
        const sellerId = item.product?.seller_id || 'unknown';
        if (!groups[sellerId]) {
          groups[sellerId] = { sellerId, sellerName: (item.product as any)?.seller?.business_name || '', items: [], subtotal: 0 };
        }
        groups[sellerId].items.push(item);
        groups[sellerId].subtotal += (item.product?.price || 0) * item.quantity;
        return groups;
      }, {})
    ), [items]);

  // Per-product mutex to prevent race conditions on rapid taps
  const addItemLocksRef = useRef<Set<string>>(new Set());

  const addItem = useCallback(async (product: Product, quantity = 1, silent = false, extras: any[] = []): Promise<boolean> => {
    if (!user) { notify.block('Please sign in to add items to cart'); return false; }
    if (addItemLocksRef.current.has(product.id)) return false;
    addItemLocksRef.current.add(product.id);
    let mutationStarted = false;

    try {
      let pActionType = (product as any).action_type;
      let pCategory = product.category as string | undefined;
      if (!pActionType || !pCategory) {
        const { data: actionLookup } = await supabase
          .from('products')
          .select('action_type, category')
          .eq('id', product.id)
          .maybeSingle();
        pActionType = pActionType || actionLookup?.action_type;
        pCategory = pCategory || (actionLookup?.category as string | undefined);
      }
      if (pActionType && !['add_to_cart', 'buy_now'].includes(pActionType)) {
        toast.error('This item cannot be added to cart', { id: 'cart-not-allowed' });
        return false;
      }

      // Match DB trigger validate_cart_item_category — fail before optimistic UI.
      if (pCategory) {
        const { data: catRow } = await supabase
          .from('category_config')
          .select('supports_cart')
          .eq('category', pCategory)
          .maybeSingle();
        if (catRow && catRow.supports_cart !== true) {
          toast.error('This item uses a booking/enquiry flow — it cannot be added to cart.', { id: 'cart-category-block' });
          return false;
        }
      }

      const eligibility = await buyerCanOrderFromSeller(
        product.seller_id,
        browsingLocation?.lat,
        browsingLocation?.lng,
      );
      if (!eligibility.ok) {
        toast.error(eligibility.reason === 'buyer_location' ? PRECISE_LOCATION_TITLE : eligibility.message, { id: 'cart-not-discoverable' });
        return false;
      }

      const inlineAvailability = getInlineSellerAvailability(product);
      let availability = computeStoreStatus(inlineAvailability.availabilityStart, inlineAvailability.availabilityEnd, inlineAvailability.operatingDays, inlineAvailability.isAvailable);
      if (!inlineAvailability.hasInlineAvailability) {
        if (!product.seller_id) { toast.error('Unable to verify store availability right now. Please try again.', { id: 'cart-availability' }); return false; }
        const { data: sellerSnapshot, error: sellerError } = await supabase.from('seller_profiles').select('availability_start, availability_end, operating_days, is_available').eq('id', product.seller_id).maybeSingle();
        if (sellerError || !sellerSnapshot) { toast.error('Unable to verify store availability right now. Please try again.', { id: 'cart-availability' }); return false; }
        availability = computeStoreStatus(sellerSnapshot.availability_start, sellerSnapshot.availability_end, sellerSnapshot.operating_days, sellerSnapshot.is_available ?? true);
      }
      if (availability.status !== 'open') { const msg = formatStoreClosedMessage(availability); toast.error(msg || 'This store is currently closed. Please try again later.', { id: 'cart-store-closed' }); return false; }

      // Stock validation — enforce stock ceiling
      let maxQty = 99;
      const pStock = (product as any).stock_quantity;
      if (pStock != null) {
        maxQty = pStock;
      } else {
        const { data: stockCheck } = await supabase.from('products').select('stock_quantity').eq('id', product.id).maybeSingle();
        if (stockCheck?.stock_quantity != null) maxQty = stockCheck.stock_quantity;
      }
      // Read current items from cache (avoids stale closure — items is not in deps)
      const currentItems = queryClient.getQueryData(cartKey()) as (CartItem & { product: Product })[] | undefined;
      const existingQty = (currentItems || []).find(i => i.product_id === product.id)?.quantity || 0;
      if (maxQty <= 0) {
        toast.error('This item is out of stock', { id: 'stock-limit' });
        return false;
      }
      if (existingQty >= maxQty) {
        // + should already be disabled in UI — no toast
        return false;
      }
      quantity = Math.min(quantity, maxQty - existingQty);

      // Committed to mutation — track it
      mutationStarted = true;
      setPendingMutations(c => c + 1);

      // Cancel + snapshot + optimistic
      await cancelCartQueries();
      const snap = snapshot();
      const extrasPayload = Array.isArray(extras) ? extras : [];

      setOptimistic(prev => {
        const existing = prev.find(item => item.product_id === product.id);
        if (existing) return prev.map(item => item.product_id === product.id ? { ...item, quantity: Math.min(item.quantity + quantity, maxQty), ...(extrasPayload.length ? { selected_extras: extrasPayload } : {}) } : item);
        return [...prev, { id: `temp-${crypto.randomUUID()}`, user_id: user.id, product_id: product.id, quantity, created_at: new Date().toISOString(), product, society_id: null, selected_extras: extrasPayload } as CartItem & { product: Product }];
      });
      queryClient.setQueryData(countKey(), (old: number | undefined) => (old || 0) + quantity);

      try {
        const { data: existing } = await supabase.from('cart_items').select('quantity').eq('user_id', user.id).eq('product_id', product.id).maybeSingle();
        if (existing) {
          const { error } = await supabase.from('cart_items').update({
            quantity: Math.min(existing.quantity + quantity, maxQty),
            ...(extrasPayload.length ? { selected_extras: extrasPayload } : {}),
          }).eq('user_id', user.id).eq('product_id', product.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('cart_items').insert({
            user_id: user.id,
            product_id: product.id,
            quantity,
            ...(extrasPayload.length ? { selected_extras: extrasPayload } : {}),
          });
          if (error) throw error;
        }
        if (!silent) {
          showAddPopup(
            product.name || 'Item',
            product.image_url || undefined,
            product.price,
            () => {
              navigate('/cart', { replace: false });
            }
          );
        }
        await reconcile();
        return true;
      } catch (error: any) {
        rollback(snap);
        console.error('Cart addItem DB error:', error);
        const availabilityError = parseStoreAvailabilityError(error);
        if (availabilityError) {
          toast.error(availabilityError, { id: 'cart-availability-error' });
        } else {
          const dbMsg = error?.message || error?.details || '';
          if (dbMsg.includes('does not support cart')) {
            toast.error('This item uses a booking/enquiry flow — it cannot be added to cart.', { id: 'cart-category-block' });
          } else if (dbMsg.includes('Product not found')) {
            toast.error('This product is no longer available.', { id: 'cart-product-gone' });
          } else {
            feedbackAddItemFailed(product.name || 'Item');
          }
        }
        return false;
      }
    } finally {
      addItemLocksRef.current.delete(product.id);
      if (mutationStarted) setPendingMutations(c => Math.max(0, c - 1));
    }
  }, [user, browsingLocation?.lat, browsingLocation?.lng, setOptimistic, cancelCartQueries, snapshot, rollback, reconcile, queryClient, countKey, showAddPopup, navigate]);

  const removeItem = useCallback(async (productId: string) => {
    if (!user) return;
    setPendingMutations(c => c + 1);
    await cancelCartQueries();
    const snap = snapshot();
    const removedItem = (snap.items || []).find(item => item.product_id === productId);
    const removedQty = removedItem?.quantity || 0;

    setOptimistic(old => old.filter(item => item.product_id !== productId));
    queryClient.setQueryData(countKey(), (old: number | undefined) => Math.max(0, (old || 0) - removedQty));

    try {
      const { error } = await supabase.from('cart_items').delete().eq('user_id', user.id).eq('product_id', productId);
      if (error) throw error;
      showRemovePopup(
        removedItem?.product?.name || 'Item',
        () => navigate('/'),
      );
      await reconcile();
    } catch (error) {
      rollback(snap);
      feedbackRemoveItemFailed();
    } finally {
      setPendingMutations(c => Math.max(0, c - 1));
    }
  }, [user, setOptimistic, cancelCartQueries, snapshot, rollback, reconcile, queryClient, countKey, showRemovePopup]);

  const updateQuantity = useCallback(async (productId: string, quantity: number) => {
    if (!user) return;
    if (quantity <= 0) { await removeItem(productId); return; }

    // Stock validation — fetch ceiling
    let maxQty = 99;
    const { data: stockCheck } = await supabase.from('products').select('stock_quantity').eq('id', productId).maybeSingle();
    if (stockCheck?.stock_quantity != null) maxQty = stockCheck.stock_quantity;
    if (quantity > maxQty) {
      // At stock ceiling — UI disables +; do not toast or show "Quantity updated"
      return;
    }
    const cappedQuantity = quantity;
    setPendingMutations(c => c + 1);
    await cancelCartQueries();
    const snap = snapshot();
    const oldItem = (snap.items || []).find(item => item.product_id === productId);
    const qtyDelta = cappedQuantity - (oldItem?.quantity || 0);

    setOptimistic(old => old.map(item => item.product_id === productId ? { ...item, quantity: cappedQuantity } : item));
    if (qtyDelta !== 0) queryClient.setQueryData(countKey(), (old: number | undefined) => Math.max(0, (old || 0) + qtyDelta));

    try {
      const { error } = await supabase.from('cart_items').update({ quantity: cappedQuantity }).eq('user_id', user.id).eq('product_id', productId);
      if (error) throw error;
      feedbackQuantityChanged();
      await reconcile();
    } catch (error) {
      rollback(snap);
      const availabilityError = parseStoreAvailabilityError(error);
      if (availabilityError) toast.error(availabilityError, { id: 'cart-qty-availability' });
      else feedbackQuantityFailed();
    } finally {
      setPendingMutations(c => Math.max(0, c - 1));
    }
  }, [user, setOptimistic, removeItem, cancelCartQueries, snapshot, rollback, reconcile, queryClient, countKey]);

  const clearCart = useCallback(async () => {
    if (!user) return;
    setPendingMutations(c => c + 1);
    await cancelCartQueries();
    const snap = snapshot();
    setOptimistic(() => []);
    queryClient.setQueryData(countKey(), 0);
    try {
      const { error } = await supabase.from('cart_items').delete().eq('user_id', user.id);
      if (error) throw error;
    } catch (error) {
      rollback(snap);
      console.error('Error clearing cart:', error);
    } finally {
      setPendingMutations(c => Math.max(0, c - 1));
    }
  }, [user, setOptimistic, cancelCartQueries, snapshot, rollback, queryClient, countKey]);

  // Bug 3 fix: Snapshot cart before delete so we can restore on insert failure
  const replaceCart = useCallback(async (inserts: { product_id: string; quantity: number }[]) => {
    if (!user || inserts.length === 0) return;
    setPendingMutations(c => c + 1);
    await cancelCartQueries();
    const snap = snapshot();
    const totalQty = inserts.reduce((s, i) => s + i.quantity, 0);
    queryClient.setQueryData(countKey(), totalQty);

    try {
      // Snapshot existing cart items for rollback
      const { data: existingItems } = await supabase
        .from('cart_items')
        .select('product_id, quantity')
        .eq('user_id', user.id);

      const { error: clearErr } = await supabase.from('cart_items').delete().eq('user_id', user.id);
      if (clearErr) {
        rollback(snap);
        throw clearErr;
      }

      const { error } = await supabase
        .from('cart_items')
        .insert(inserts.map(i => ({ user_id: user.id, product_id: i.product_id, quantity: i.quantity })));

      if (error) {
        // Restore original cart items
        if (existingItems && existingItems.length > 0) {
          await supabase.from('cart_items').insert(
            existingItems.map(i => ({ user_id: user.id, product_id: i.product_id, quantity: i.quantity }))
          );
        }
        rollback(snap);
        throw error;
      }
      await reconcile();
      // Signal reorder completion for downstream payment state reset
      window.dispatchEvent(new CustomEvent('cart-replaced'));
    } catch (error) {
      await reconcile();
      throw error;
    } finally {
      setPendingMutations(c => Math.max(0, c - 1));
    }
  }, [user, queryClient, cancelCartQueries, countKey, reconcile, snapshot, rollback]);

  const hasHydrated = isFetched;

  // Reset recovery counter when items arrive or count drops to 0
  useEffect(() => {
    if (!user || items.length > 0 || fallbackItemCount === 0) {
      if (recoveryTimerRef.current) { clearTimeout(recoveryTimerRef.current); recoveryTimerRef.current = null; }
      setRecoveryAttempts(0);
    }
  }, [user, items.length, fallbackItemCount]);

  // Layer 3: Aggressive staggered recovery refetches
  useEffect(() => {
    if (!hasCartCountMismatch || recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) return;
    // Staggered delays: immediate, 500ms, 1500ms
    const delays = [0, 500, 1500];
    const delay = delays[recoveryAttempts] ?? 1500;
    recoveryTimerRef.current = setTimeout(() => {
      recoveryTimerRef.current = null;
      setRecoveryAttempts(prev => prev + 1);
      // Force refetch (not just invalidate) for immediate execution
      queryClient.refetchQueries({ queryKey: cartKey(), exact: true });
      // Also refetch count to keep them in sync
      queryClient.refetchQueries({ queryKey: countKey(), exact: true });
    }, delay);
    return () => { if (recoveryTimerRef.current) { clearTimeout(recoveryTimerRef.current); recoveryTimerRef.current = null; } };
  }, [hasCartCountMismatch, recoveryAttempts, queryClient, cartKey, countKey]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current); };
  }, []);

  // Keep cart-count cache in sync with items (eliminates split-brain)
  // RULE 2: Never downgrade count to 0 from item sync — only server verification can do that
  useEffect(() => {
    if (hasHydrated && user && !hasCartCountMismatch) {
      if (itemCount === 0 && fallbackItemCount > 0) return; // Don't blindly zero the count
      queryClient.setQueryData(['cart-count', user.id], itemCount);
    }
  }, [hasHydrated, user, itemCount, queryClient, hasCartCountMismatch, fallbackItemCount]);

  // Mark cart as verified when items arrive or when genuinely empty with count=0
  useEffect(() => {
    if (!hasHydrated) return;
    if (items.length > 0) { setCartVerified(true); return; }
    if (items.length === 0 && fallbackItemCount === 0 && isFetched && !isFetching) {
      setCartVerified(true);
    }
  }, [hasHydrated, items.length, fallbackItemCount, isFetched, isFetching]);

  const contextValue = useMemo<CartContextType>(() => ({
    items, itemCount, totalAmount, sellerGroups, isLoading, isFetching, hasHydrated, isRecoveringCart, pendingMutations, addItem, replaceCart, updateQuantity, removeItem, clearCart, cartVerified,
    // RULE 3: refresh is non-destructive — safe invalidation only, no reconcile
    refresh: async () => {
      if (user) {
        await queryClient.invalidateQueries({ queryKey: cartKey() });
        await queryClient.invalidateQueries({ queryKey: countKey() });
      }
    },
  }), [items, itemCount, totalAmount, sellerGroups, isLoading, isFetching, hasHydrated, isRecoveringCart, pendingMutations, addItem, replaceCart, updateQuantity, removeItem, clearCart, cartVerified, user, queryClient, cartKey, countKey]);

  return <CartContext.Provider value={contextValue}>{children}</CartContext.Provider>;
}

const EMPTY_CART_FALLBACK: any = {
  items: [],
  itemCount: 0,
  totalAmount: 0,
  isLoading: false,
  addToCart: async () => {},
  updateQuantity: async () => {},
  removeFromCart: async () => {},
  clearCart: async () => {},
  refresh: async () => {},
};

export function useCart() {
  const context = useContext(CartContext);
  // Return a safe no-op fallback when used outside a CartProvider so that
  // globally-mounted components (e.g. FloatingCartBar in AppLayout) don't
  // crash on routes where CartProvider isn't mounted.
  if (context === undefined) return EMPTY_CART_FALLBACK;
  return context;
}
