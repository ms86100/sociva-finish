import { isFoodParentGroup, productMatchesFoodFacets, TASTE_MOODS, type TasteMood } from './food-facets';
import { computeStoreStatus } from './store-availability';
import { ACTION_MODE_IMAGES, SERVICE_MODE_IMAGES, DURATION_IMAGES } from './filter-images';

export interface CommerceFacetState {
  // Food facets
  cuisine?: string | null;
  meal?: string | null;
  course?: string | null;
  veg?: boolean;
  // General facets
  openNow?: boolean;
  actionType?: 'add_to_cart' | 'book' | 'request_quote' | 'contact_seller' | string | null;
  serviceMode?: 'home_visit' | 'at_store' | 'online' | string | null;
  durationMax?: number | null;
  priceMax?: number | null;
  subCategory?: string | null;
}

export function emptyCommerceFacetState(): CommerceFacetState {
  return {
    cuisine: null,
    meal: null,
    course: null,
    veg: false,
    openNow: false,
    actionType: null,
    serviceMode: null,
    durationMax: null,
    priceMax: null,
    subCategory: null,
  };
}

export function hasActiveCommerceFacets(state: CommerceFacetState): boolean {
  return !!(
    state.cuisine ||
    state.meal ||
    state.course ||
    state.veg ||
    state.openNow ||
    state.actionType ||
    state.serviceMode ||
    state.durationMax ||
    state.priceMax ||
    state.subCategory
  );
}

export function countActiveCommerceFacets(state: CommerceFacetState): number {
  let count = 0;
  if (state.cuisine) count++;
  if (state.meal) count++;
  if (state.course) count++;
  if (state.veg) count++;
  if (state.openNow) count++;
  if (state.actionType) count++;
  if (state.serviceMode) count++;
  if (state.durationMax) count++;
  if (state.priceMax) count++;
  if (state.subCategory) count++;
  return count;
}

export interface DynamicFacetChip {
  id: string;
  label: string;
  emoji?: string;
  icon?: string;
  imageUrl?: string;
  count: number;
  type: 'food_mood' | 'action_type' | 'service_mode' | 'duration' | 'price' | 'subcategory';
  value: any;
  isActive: boolean;
}

/**
 * Normalizes service mode string from product attributes.
 */
export function normalizeServiceMode(
  text?: string | null,
  scope?: string | null
): 'home_visit' | 'at_store' | 'online' | null {
  const combined = `${text || ''} ${scope || ''}`.toLowerCase();
  if (!combined.trim()) return null;

  if (combined.includes('online')) return 'online';
  if (
    combined.includes('home visit') ||
    combined.includes('doorstep') ||
    combined.includes('pickup & drop') ||
    combined.includes('pickup and delivery') ||
    combined.includes('delivery')
  ) {
    return 'home_visit';
  }
  if (
    combined.includes('clinic') ||
    combined.includes('store') ||
    combined.includes('studio') ||
    combined.includes('at center') ||
    combined.includes('clubhouse')
  ) {
    return 'at_store';
  }
  return null;
}

/**
 * Matches a product against the active commerce facet state.
 */
export function productMatchesCommerceFacets(
  product: {
    id?: string;
    category?: string | null;
    tags?: string[] | null;
    cuisine_type?: string | null;
    name?: string;
    price?: number | string | null;
    is_veg?: boolean | null;
    action_type?: string | null;
    service_duration_minutes?: number | null;
    delivery_time_text?: string | null;
    service_scope?: string | null;
    seller_availability_start?: string | null;
    seller_availability_end?: string | null;
    seller_operating_days?: string[] | null;
    seller_is_available?: boolean | null;
  },
  state: CommerceFacetState
): boolean {
  if (state.subCategory && product.category !== state.subCategory) {
    return false;
  }

  if (state.veg && product.is_veg !== true) {
    return false;
  }

  if (state.openNow) {
    const status = computeStoreStatus(
      product.seller_availability_start ?? null,
      product.seller_availability_end ?? null,
      product.seller_operating_days ?? null,
      product.seller_is_available ?? true
    );
    if (status.status !== 'open') return false;
  }

  if (state.actionType) {
    const productAction = product.action_type || 'add_to_cart';
    if (productAction !== state.actionType) return false;
  }

  if (state.serviceMode) {
    const mode = normalizeServiceMode(product.delivery_time_text, product.service_scope);
    if (mode !== state.serviceMode) return false;
  }

  if (state.durationMax) {
    const duration = product.service_duration_minutes;
    if (!duration || duration > state.durationMax) return false;
  }

  if (state.priceMax) {
    const rawPrice = Number(product.price);
    if (isNaN(rawPrice) || rawPrice <= 0 || rawPrice > state.priceMax) return false;
  }

  // Food facets (cuisine, meal, course)
  if (state.cuisine || state.meal || state.course) {
    return productMatchesFoodFacets(product, {
      cuisine: (state.cuisine as any) || null,
      meal: (state.meal as any) || null,
      course: (state.course as any) || null,
    });
  }

  return true;
}

function appendPriceChips(
  products: Array<{ price?: number | string | null }>,
  current: CommerceFacetState,
  chips: DynamicFacetChip[],
) {
  const validPrices = products
    .map((p) => Number(p.price))
    .filter((pr) => !isNaN(pr) && pr > 0);

  if (validPrices.length < 2) return;

  const maxP = Math.max(...validPrices);
  const minP = Math.min(...validPrices);

  if (minP <= 300 && maxP > 300) {
    chips.push({
      id: 'price:300',
      label: 'Under ₹300',
      emoji: '🏷️',
      count: validPrices.filter((p) => p <= 300).length,
      type: 'price',
      value: 300,
      isActive: current.priceMax === 300,
    });
  }
  if (minP <= 600 && maxP > 600) {
    chips.push({
      id: 'price:600',
      label: 'Under ₹600',
      emoji: '🏷️',
      count: validPrices.filter((p) => p <= 600).length,
      type: 'price',
      value: 600,
      isActive: current.priceMax === 600,
    });
  }
  if (maxP >= 1500) {
    chips.push({
      id: 'price:1500',
      label: 'Under ₹1,500',
      emoji: '🏷️',
      count: validPrices.filter((p) => p <= 1500).length,
      type: 'price',
      value: 1500,
      isActive: current.priceMax === 1500,
    });
  }
}

/**
 * Derives available dynamic facet chips strictly from non-empty inventory.
 */
export function extractAvailableCommerceFacets(
  products: Array<{
    name?: string;
    category?: string | null;
    parentGroup?: string | null;
    tags?: string[] | null;
    cuisine_type?: string | null;
    price?: number | string | null;
    action_type?: string | null;
    service_duration_minutes?: number | null;
    delivery_time_text?: string | null;
    service_scope?: string | null;
    is_veg?: boolean | null;
  }>,
  options?: {
    parentGroup?: string | null;
    currentState?: CommerceFacetState;
  }
): DynamicFacetChip[] {
  if (!products || products.length === 0) return [];

  const parentGroup = options?.parentGroup || null;
  const isFood = isFoodParentGroup(parentGroup);
  const current = options?.currentState || emptyCommerceFacetState();
  const chips: DynamicFacetChip[] = [];

  const pushFoodMoods = () => {
    for (const mood of TASTE_MOODS) {
      const count = products.filter((p) =>
        productMatchesFoodFacets(p, {
          cuisine: mood.facet === 'cuisine' ? mood.value : null,
          meal: mood.facet === 'meal' ? mood.value : null,
          course: mood.facet === 'course' ? mood.value : null,
        } as any)
      ).length;
      if (count > 0) {
        chips.push({
          id: `mood:${mood.id}`,
          label: mood.label,
          emoji: mood.emoji,
          imageUrl: (mood as any).imageUrl,
          count,
          type: 'food_mood',
          value: { facet: mood.facet, value: mood.value },
          isActive: current[mood.facet] === mood.value,
        });
      }
    }
  };

  // Food groups: moods first. Mixed/home "all" still surfaces food moods when food exists.
  const foodish = isFood || products.some((p) => isFoodParentGroup(p.parentGroup) || isFoodParentGroup(p.category));
  if (isFood || foodish) {
    pushFoodMoods();
  }

  if (isFood) {
    appendPriceChips(products, current, chips);
    return chips;
  }

  // 2. Action Types present in inventory
  const actionCounts = new Map<string, number>();
  for (const p of products) {
    const act = p.action_type || 'add_to_cart';
    actionCounts.set(act, (actionCounts.get(act) || 0) + 1);
  }

  const actionLabels: Record<string, { label: string; emoji: string }> = {
    book: { label: 'Book Slot', emoji: '📅' },
    request_quote: { label: 'Request Quote', emoji: '💬' },
    contact_seller: { label: 'Direct Contact', emoji: '📞' },
    add_to_cart: { label: 'Direct Buy', emoji: '🛍️' },
  };

  for (const [action, count] of actionCounts.entries()) {
    if (count > 0 && actionLabels[action]) {
      chips.push({
        id: `action:${action}`,
        label: actionLabels[action].label,
        emoji: actionLabels[action].emoji,
        imageUrl: ACTION_MODE_IMAGES[action],
        count,
        type: 'action_type',
        value: action,
        isActive: current.actionType === action,
      });
    }
  }

  // 3. Service Delivery Modes (Home visit vs At store/clinic vs Online)
  const modeCounts = {
    home_visit: 0,
    at_store: 0,
    online: 0,
  };

  for (const p of products) {
    const mode = normalizeServiceMode(p.delivery_time_text, p.service_scope);
    if (mode && modeCounts[mode] !== undefined) {
      modeCounts[mode]++;
    }
  }

  const modeLabels: Record<string, { label: string; emoji: string }> = {
    home_visit: { label: 'Home Visit / Doorstep', emoji: '🏠' },
    at_store: { label: 'At Clinic / Studio', emoji: '🏥' },
    online: { label: 'Online / Remote', emoji: '💻' },
  };

  for (const [mode, count] of Object.entries(modeCounts)) {
    if (count > 0) {
      chips.push({
        id: `mode:${mode}`,
        label: modeLabels[mode].label,
        emoji: modeLabels[mode].emoji,
        imageUrl: SERVICE_MODE_IMAGES[mode],
        count,
        type: 'service_mode',
        value: mode,
        isActive: current.serviceMode === mode,
      });
    }
  }

  // 4. Quick Duration chips for services (e.g. <= 30 min, <= 60 min)
  const has30m = products.some((p) => (p.service_duration_minutes || 0) > 0 && (p.service_duration_minutes || 0) <= 30);
  const has60m = products.some((p) => (p.service_duration_minutes || 0) > 0 && (p.service_duration_minutes || 0) <= 60);

  if (has30m) {
    const count = products.filter((p) => (p.service_duration_minutes || 0) > 0 && (p.service_duration_minutes || 0) <= 30).length;
    chips.push({
      id: 'dur:30',
      label: '≤ 30 min',
      emoji: '⚡',
      imageUrl: DURATION_IMAGES['30'],
      count,
      type: 'duration',
      value: 30,
      isActive: current.durationMax === 30,
    });
  }
  if (has60m && !has30m) {
    const count = products.filter((p) => (p.service_duration_minutes || 0) > 0 && (p.service_duration_minutes || 0) <= 60).length;
    chips.push({
      id: 'dur:60',
      label: '≤ 60 min',
      emoji: '⏱️',
      imageUrl: DURATION_IMAGES['60'],
      count,
      type: 'duration',
      value: 60,
      isActive: current.durationMax === 60,
    });
  }

  appendPriceChips(products, current, chips);

  return chips;
}
