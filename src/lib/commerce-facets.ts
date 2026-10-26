import {
  FOOD_COURSES,
  FOOD_CUISINES,
  FOOD_MEALS,
  isFoodParentGroup,
  productMatchesFoodFacets,
  TASTE_MOODS,
} from './food-facets';
import { computeStoreStatus } from './store-availability';
import { ACTION_MODE_IMAGES, SERVICE_MODE_IMAGES, DURATION_IMAGES } from './filter-images';
import { listingPhotoForFacet } from './chip-listing-photo';
import { curatedMealArt, resolveFoodChipArt } from './food-chip-art';
import type { FoodMealId } from './food-facets';
import { resolveListingAction, type CategoryActionConfig } from './commerce-mode';

export interface CommerceFacetState {
  // Food facets
  cuisine?: string | null;
  meal?: string | null;
  course?: string | null;
  veg?: boolean;
  nonVeg?: boolean;
  // General facets
  openNow?: boolean;
  actionType?: 'add_to_cart' | 'book' | 'request_quote' | 'contact_seller' | string | null;
  serviceMode?: 'home_visit' | 'at_store' | 'online' | string | null;
  durationMax?: number | null;
  priceMax?: number | null;
  subCategory?: string | null;
  /** Stored products.spice_level, lowercased. Shown only when the catalogue actually varies. */
  spiceLevel?: string | null;
  /** Stored products.serving_size. Shown only when pack sizes actually vary. */
  packSize?: string | null;
  /** A tag that exists on the product. Never inferred from the product name. */
  catalogueTag?: string | null;
}

/** A single action chip is not a choice. Home and category browse hide it. */
export function omitSoleActionChips<T extends { type: string }>(chips: readonly T[]): T[] {
  const actionCount = chips.reduce((n, chip) => n + (chip.type === 'action_type' ? 1 : 0), 0);
  if (actionCount > 1) return [...chips];
  return chips.filter((chip) => chip.type !== 'action_type');
}

const BOOK_PLACE_LABELS: Record<string, string> = {
  home_visit: 'At your home',
  at_store: 'At their place',
  online: 'Online',
};

const CONTACT_PURPOSE_LABELS: Record<string, string> = {
  request_service: 'Ask',
  request_quote: 'Get a quote',
  make_offer: 'Make an offer',
};

/**
 * Book offers where and how long. Contact offers ask, quote, or offer,
 * and only when more than one of those exists. Neither page repeats its own action.
 */
export function purposeChipsForMode(
  mode: 'shop' | 'book' | 'services',
  chips: readonly DynamicFacetChip[],
  products: ReadonlyArray<{
    action_type?: string | null;
    category?: string | null;
  }>,
  options?: {
    categoryConfigs?: readonly CategoryActionConfig[] | null;
    actionType?: string | null;
  },
): DynamicFacetChip[] {
  if (mode === 'book') {
    const place = chips
      .filter((chip) => chip.type === 'service_mode' || chip.type === 'duration')
      .map((chip) => {
        if (chip.type === 'duration') return { ...chip, label: 'Short session' };
        const label = BOOK_PLACE_LABELS[String(chip.value)];
        return label ? { ...chip, label } : chip;
      });
    return [...place, ...attributeChips(chips)];
  }
  if (mode === 'services') {
    const counts = new Map<string, number>();
    for (const product of products) {
      const action = resolveListingAction(product.action_type, product.category, options?.categoryConfigs);
      if (CONTACT_PURPOSE_LABELS[action]) {
        counts.set(action, (counts.get(action) || 0) + 1);
      }
    }
    const purpose = counts.size < 2
      ? []
      : (Object.keys(CONTACT_PURPOSE_LABELS) as string[])
          .filter((action) => (counts.get(action) || 0) > 0)
          .map((action) => ({
            id: `action:${action}`,
            label: CONTACT_PURPOSE_LABELS[action],
            count: counts.get(action) || 0,
            type: 'action_type' as const,
            value: action,
            isActive: options?.actionType === action,
          }));
    return [...purpose, ...attributeChips(chips)];
  }
  return omitSoleActionChips(chips);
}

export function emptyCommerceFacetState(): CommerceFacetState {
  return {
    cuisine: null,
    meal: null,
    course: null,
    veg: false,
    nonVeg: false,
    openNow: false,
    actionType: null,
    serviceMode: null,
    durationMax: null,
    priceMax: null,
    subCategory: null,
    spiceLevel: null,
    packSize: null,
    catalogueTag: null,
  };
}

export function hasActiveCommerceFacets(state: CommerceFacetState): boolean {
  return !!(
    state.cuisine ||
    state.meal ||
    state.course ||
    state.veg ||
    state.nonVeg ||
    state.openNow ||
    state.actionType ||
    state.serviceMode ||
    state.durationMax ||
    state.priceMax ||
    state.subCategory ||
    state.spiceLevel ||
    state.packSize ||
    state.catalogueTag
  );
}

export function countActiveCommerceFacets(state: CommerceFacetState): number {
  let count = 0;
  if (state.cuisine) count++;
  if (state.meal) count++;
  if (state.course) count++;
  if (state.veg) count++;
  if (state.nonVeg) count++;
  if (state.openNow) count++;
  if (state.actionType) count++;
  if (state.serviceMode) count++;
  if (state.durationMax) count++;
  if (state.priceMax) count++;
  if (state.subCategory) count++;
  if (state.spiceLevel) count++;
  if (state.packSize) count++;
  if (state.catalogueTag) count++;
  return count;
}

export interface DynamicFacetChip {
  id: string;
  label: string;
  emoji?: string;
  icon?: string;
  imageUrl?: string;
  count: number;
  type: 'food_mood' | 'action_type' | 'service_mode' | 'duration' | 'price' | 'subcategory' | 'spice' | 'pack' | 'catalogue';
  value: any;
  isActive: boolean;
}

export type CommerceFacetProduct = {
  id?: string;
  category?: string | null;
  tags?: string[] | null;
  cuisine_type?: string | null;
  name?: string;
  price?: number | string | null;
  is_veg?: boolean | null;
  spice_level?: string | null;
  serving_size?: string | null;
  action_type?: string | null;
  service_duration_minutes?: number | null;
  delivery_time_text?: string | null;
  service_scope?: string | null;
  seller_availability_start?: string | null;
  seller_availability_end?: string | null;
  seller_operating_days?: string[] | null;
  seller_is_available?: boolean | null;
};

const PACK_UNIT =
  /\b(g|kg|ml|l|gm|gms|grams?|oz|lb|plate|plates|bowl|bowls|pack|packs|pouch|jar|loaf|piece|pieces|pc|pcs|serving|servings|serves)\b/i;

/** Bare serving counts ("1") or sizes with a unit ("200 g", "1 plate"). Not SKU noise. */
export function packLooksLikeSize(raw: string | null | undefined): boolean {
  const t = String(raw || '').trim();
  if (!t || t.length > 32) return false;
  if (!/\d/.test(t)) return false;
  if (/^\d{1,2}$/.test(t)) return true;
  if (/^\d+([.,]\d+)?\s*(g|kg|ml|l|gm|gms)$/i.test(t)) return true;
  if (PACK_UNIT.test(t)) return true;
  return false;
}

/** Buyer label for a stored serving_size. "1" becomes Serves 1. "200 g" stays 200 g. */
export function packSizeBuyerLabel(raw: string): string {
  const t = raw.trim();
  if (/^\d{1,2}$/.test(t)) return `Serves ${t}`;
  return t;
}

export function shouldShowTasteChip(count: number, active: boolean): boolean {
  return active || count > 0;
}

export interface TasteSheetCounts {
  veg: number;
  nonVeg: number;
  meals: Record<string, number>;
  cuisines: Record<string, number>;
  courses: Record<string, number>;
}

function remainingPool(
  inventory: readonly CommerceFacetProduct[],
  state: CommerceFacetState,
  omit: Partial<CommerceFacetState>,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): CommerceFacetProduct[] {
  const next: CommerceFacetState = { ...state, ...omit };
  return inventory.filter((product) => productMatchesCommerceFacets(product, next, categoryConfigs));
}

/**
 * Meal chips are switchers counted on the full list.
 * Cuisine, course, and diet count what is left after the other active filters.
 */
export function tasteSheetCounts(
  inventory: readonly CommerceFacetProduct[],
  state: CommerceFacetState,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): TasteSheetCounts {
  const meals: Record<string, number> = {};
  for (const meal of FOOD_MEALS) {
    meals[meal.id] = inventory.filter((product) =>
      productMatchesFoodFacets(product, { meal: meal.id }),
    ).length;
  }

  const cuisinePool = remainingPool(inventory, state, { cuisine: null }, categoryConfigs);
  const cuisines: Record<string, number> = {};
  for (const cuisine of FOOD_CUISINES) {
    if (cuisine.id === 'other') continue;
    cuisines[cuisine.id] = cuisinePool.filter((product) =>
      productMatchesFoodFacets(product, { cuisine: cuisine.id }),
    ).length;
  }

  const coursePool = remainingPool(inventory, state, { course: null }, categoryConfigs);
  const courses: Record<string, number> = {};
  for (const course of FOOD_COURSES) {
    courses[course.id] = coursePool.filter((product) =>
      productMatchesFoodFacets(product, { course: course.id }),
    ).length;
  }

  const dietPool = remainingPool(inventory, state, { veg: false, nonVeg: false }, categoryConfigs);
  let veg = 0;
  let nonVeg = 0;
  for (const product of dietPool) {
    if (product.is_veg === true) veg += 1;
    else if (product.is_veg === false) nonVeg += 1;
  }

  return { veg, nonVeg, meals, cuisines, courses };
}

export function remainingAttributeCount(
  inventory: readonly CommerceFacetProduct[],
  state: CommerceFacetState,
  type: 'spice' | 'pack' | 'catalogue',
  value: string,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): number {
  if (type === 'spice') {
    const needle = value.trim().toLowerCase();
    return remainingPool(inventory, state, { spiceLevel: null }, categoryConfigs)
      .filter((product) => (product.spice_level || '').trim().toLowerCase() === needle)
      .length;
  }
  if (type === 'pack') {
    return remainingPool(inventory, state, { packSize: null }, categoryConfigs)
      .filter((product) => (product.serving_size || '').trim() === value)
      .length;
  }
  const needle = value.trim().toLowerCase();
  return remainingPool(inventory, state, { catalogueTag: null }, categoryConfigs)
    .filter((product) =>
      (product.tags || []).some((tag) => String(tag).trim().toLowerCase() === needle),
    )
    .length;
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
  product: CommerceFacetProduct,
  state: CommerceFacetState,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): boolean {
  if (state.subCategory && product.category !== state.subCategory) {
    return false;
  }

  if (state.veg && product.is_veg !== true) {
    return false;
  }

  if (state.nonVeg && product.is_veg !== false) {
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
    const productAction = resolveListingAction(product.action_type, product.category, categoryConfigs);
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

  if (state.spiceLevel) {
    const level = (product.spice_level || '').trim().toLowerCase();
    if (level !== state.spiceLevel) return false;
  }

  if (state.packSize) {
    if ((product.serving_size || '').trim() !== state.packSize) return false;
  }

  if (state.catalogueTag) {
    const tags = (product.tags || []).map((tag) => String(tag).trim().toLowerCase());
    if (!tags.includes(state.catalogueTag.trim().toLowerCase())) return false;
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

/** Buyer labels for tags that already exist on a product. A missing tag never becomes a filter. */
const CATALOGUE_TAG_LABELS: Record<string, string> = {
  saree: 'Saree',
  festive: 'Festive',
  wedding: 'Wedding',
  ethnic: 'Ethnic',
  chikankari: 'Chikankari',
  embroidery: 'Embroidery',
  printed: 'Printed',
  silk: 'Silk',
  cotton: 'Cotton',
};

const SPICE_LABELS: Record<string, string> = {
  mild: 'Mild',
  medium: 'Medium',
  hot: 'Hot',
};

function attributeChips(chips: readonly DynamicFacetChip[]): DynamicFacetChip[] {
  return chips.filter((chip) => chip.type === 'spice' || chip.type === 'pack' || chip.type === 'catalogue');
}

function pushWhenItNarrows(
  counts: Map<string, number>,
  total: number,
  emit: (value: string, count: number) => void,
) {
  const covered = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const narrows = counts.size >= 2 || (counts.size === 1 && covered < total);
  if (!narrows) return;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [value, count] of ranked) {
    if (count > 0 && count < total) emit(value, count);
  }
}

function appendAttributeChips(
  products: Array<{
    tags?: string[] | null;
    spice_level?: string | null;
    serving_size?: string | null;
  }>,
  current: CommerceFacetState,
  chips: DynamicFacetChip[],
) {
  const total = products.length;
  if (total === 0) return;

  const spiceCounts = new Map<string, number>();
  const packCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  for (const product of products) {
    const spice = (product.spice_level || '').trim().toLowerCase();
    if (spice) spiceCounts.set(spice, (spiceCounts.get(spice) || 0) + 1);
    const pack = (product.serving_size || '').trim();
    if (pack && packLooksLikeSize(pack)) packCounts.set(pack, (packCounts.get(pack) || 0) + 1);
    const seen = new Set<string>();
    for (const raw of product.tags || []) {
      const tag = String(raw).trim().toLowerCase();
      if (!tag || seen.has(tag) || !CATALOGUE_TAG_LABELS[tag]) continue;
      seen.add(tag);
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  pushWhenItNarrows(spiceCounts, total, (level, count) => {
    chips.push({
      id: `spice:${level}`,
      label: SPICE_LABELS[level] || level.charAt(0).toUpperCase() + level.slice(1),
      count,
      type: 'spice',
      value: level,
      isActive: current.spiceLevel === level,
    });
  });

  pushWhenItNarrows(packCounts, total, (pack, count) => {
    chips.push({
      id: `pack:${pack}`,
      label: packSizeBuyerLabel(pack),
      count,
      type: 'pack',
      value: pack,
      isActive: current.packSize === pack,
    });
  });

  pushWhenItNarrows(tagCounts, total, (tag, count) => {
    chips.push({
      id: `tag:${tag}`,
      label: CATALOGUE_TAG_LABELS[tag],
      count,
      type: 'catalogue',
      value: tag,
      isActive: current.catalogueTag === tag,
    });
  });
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
    spice_level?: string | null;
    serving_size?: string | null;
    service_duration_minutes?: number | null;
    delivery_time_text?: string | null;
    service_scope?: string | null;
    is_veg?: boolean | null;
    image_url?: string | null;
  }>,
  options?: {
    parentGroup?: string | null;
    currentState?: CommerceFacetState;
    categoryConfigs?: readonly CategoryActionConfig[] | null;
  }
): DynamicFacetChip[] {
  if (!products || products.length === 0) return [];

  const parentGroup = options?.parentGroup || null;
  const isFood = isFoodParentGroup(parentGroup);
  const current = options?.currentState || emptyCommerceFacetState();
  const chips: DynamicFacetChip[] = [];

  const pushFoodMoods = () => {
    const usedPhotos = new Set<string>();
    for (const mood of TASTE_MOODS) {
      const count = products.filter((p) =>
        productMatchesFoodFacets(p, {
          cuisine: mood.facet === 'cuisine' ? mood.value : null,
          meal: mood.facet === 'meal' ? mood.value : null,
          course: mood.facet === 'course' ? mood.value : null,
        } as any)
      ).length;
      if (count > 0) {
        const meal = mood.facet === 'meal' ? (mood.value as FoodMealId) : null;
        const cuisine = mood.facet === 'cuisine' ? mood.value : null;
        let imageUrl: string | undefined;
        if (meal) {
          const art = curatedMealArt(meal);
          if (art) {
            usedPhotos.add(art);
            imageUrl = art;
          }
        } else {
          const live = listingPhotoForFacet(products, mood, usedPhotos);
          imageUrl = live
            || resolveFoodChipArt(null, { meal, cuisine }, usedPhotos)
            || undefined;
        }
        chips.push({
          id: `mood:${mood.id}`,
          label: mood.label,
          emoji: mood.emoji,
          imageUrl,
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

  appendAttributeChips(products, current, chips);

  if (isFood) {
    appendPriceChips(products, current, chips);
    return chips;
  }

  // 2. Action Types present in inventory
  const actionCounts = new Map<string, number>();
  for (const p of products) {
    const act = resolveListingAction(p.action_type, p.category, options?.categoryConfigs);
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
