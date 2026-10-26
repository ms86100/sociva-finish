import { pickDishListingPhoto, pickListingChipPhoto } from '@/lib/chip-listing-photo';
import {
  resolveListingAction,
  type CategoryActionConfig,
} from '@/lib/commerce-mode';
import {
  FOOD_CUISINES,
  FOOD_MEALS,
  foodFacetsBrowsePath,
  productMatchesFoodFacets,
  writeFoodFacetsToSearchParams,
  type FoodCuisineId,
  type FoodMealId,
} from '@/lib/food-facets';
import {
  curatedCategoryArt,
  curatedCuisineArt,
  curatedMealArt,
  guidedKitchenCountLabel,
  guidedSpotCountLabel,
  resolveFoodChipArt,
} from '@/lib/food-chip-art';
import type { ProductActionType } from '@/types/Database';

export type GuidedDiscoveryHubId =
  | 'home_food'
  | 'restaurant_food'
  | 'pickles_homemade'
  | 'daily_needs'
  | 'services'
  | 'book_enquire'
  | 'contact_seller';

export type GuidedDiscoveryHubKind = 'shop_categories' | 'book' | 'contact' | 'enquiry';

export type GuidedDiscoveryTileKind = 'meal' | 'cuisine' | 'category' | 'tiffin';

export const GUIDED_DISCOVERY_HEADING = 'What are you looking for today?';
export const GUIDED_DISCOVERY_SHELF_HEADING = 'On the shelf today';
export const GUIDED_DISCOVERY_AISLE_HEADING = 'Browse by meal time';

export const TIFFIN_SUBCATEGORY_SLUGS = ['daily_tiffin', 'tiffin'] as const;

export interface GuidedDiscoveryListing {
  id?: string;
  name?: string;
  category?: string | null;
  subcategory?: string | null;
  subcategory_slug?: string | null;
  tags?: string[] | null;
  cuisine_type?: string | null;
  image_url?: string | null;
  action_type?: string | null;
  prep_time_minutes?: number | null;
  lead_time_hours?: number | null;
  delivery_time_text?: string | null;
  service_duration_minutes?: number | null;
  seller_id?: string | null;
  seller_name?: string | null;
  seller_rating?: number | null;
  seller_reviews?: number | null;
}

export interface GuidedDiscoveryCategoryMeta {
  category: string;
  displayName?: string | null;
  imageUrl?: string | null;
}

export interface GuidedDiscoveryHubDef {
  id: GuidedDiscoveryHubId;
  title: string;
  subtitle: string;
  kind: GuidedDiscoveryHubKind;
  categories?: readonly string[];
  parentGroup?: string;
}

export interface GuidedDiscoveryHub {
  id: GuidedDiscoveryHubId;
  title: string;
  subtitle: string;
  href: string;
  imageUrl: string | null;
  count: number;
  kind: GuidedDiscoveryHubKind;
}

export interface GuidedDiscoveryTile {
  id: string;
  kind: GuidedDiscoveryTileKind;
  label: string;
  subtitle: string;
  href: string;
  imageUrl: string | null;
  count: number;
  eta: string | null;
}

export const GUIDED_DISCOVERY_HUB_PANEL: Record<GuidedDiscoveryHubId, string> = {
  home_food: 'bg-amber-50/95 dark:bg-amber-950/75',
  restaurant_food: 'bg-rose-50/95 dark:bg-rose-950/75',
  pickles_homemade: 'bg-yellow-50/95 dark:bg-yellow-950/70',
  daily_needs: 'bg-emerald-50/95 dark:bg-emerald-950/70',
  services: 'bg-slate-50/95 dark:bg-slate-900/80',
  book_enquire: 'bg-teal-50/95 dark:bg-teal-950/70',
  contact_seller: 'bg-sky-50/95 dark:bg-sky-950/70',
};

/** Prep minutes from the listing itself. Never invent a default. */
export function listingPrepMinutes(listing: {
  prep_time_minutes?: number | null;
  lead_time_hours?: number | null;
}): number | null {
  const prep = Number(listing.prep_time_minutes);
  if (Number.isFinite(prep) && prep > 0) return Math.round(prep);
  const hours = Number(listing.lead_time_hours);
  if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 60);
  return null;
}

function formatPrepRange(min: number, max: number): string {
  if (min >= 60 && min % 60 === 0 && max % 60 === 0) {
    const from = min / 60;
    const to = max / 60;
    return from === to ? `Ready in ${from} hr` : `Ready in ${from}-${to} hr`;
  }
  return min === max ? `Delivers in ${min} min` : `Delivers in ${min}-${max} min`;
}

export function guidedListingEta(listing: {
  delivery_time_text?: string | null;
  prep_time_minutes?: number | null;
  lead_time_hours?: number | null;
  service_duration_minutes?: number | null;
}): string | null {
  const prep = listingPrepMinutes(listing);
  if (prep && prep <= 360) return prep >= 60 && prep % 60 === 0 ? `${prep / 60} hr` : `${prep} min`;
  const text = listing.delivery_time_text?.trim();
  if (text) return text;
  const duration = Number(listing.service_duration_minutes);
  if (Number.isFinite(duration) && duration > 0) return `${Math.round(duration)} min`;
  return null;
}

export function guidedCollectionEta(
  listings: readonly {
    delivery_time_text?: string | null;
    prep_time_minutes?: number | null;
    lead_time_hours?: number | null;
  }[],
): string | null {
  const minutes = listings
    .map((item) => listingPrepMinutes(item))
    .filter((value): value is number => value != null && value > 0 && value <= 360);
  if (minutes.length > 0) {
    return formatPrepRange(Math.min(...minutes), Math.max(...minutes));
  }
  const text = listings.map((item) => item.delivery_time_text?.trim()).find(Boolean) || null;
  if (!text) return null;
  return /deliver/i.test(text) ? text : `Delivers in ${text}`;
}

export type GuidedListingSnapshotInput = {
  id?: string | null;
  name?: string | null;
  price?: number | null;
  image_url?: string | null;
  seller_id?: string | null;
  seller_name?: string | null;
  seller_is_available?: boolean | null;
  seller_vacation_mode?: boolean | null;
  society_name?: string | null;
  prep_time_minutes?: number | null;
  lead_time_hours?: number | null;
  delivery_time_text?: string | null;
  completed_order_count?: number | null;
};

export type GuidedListingSnapshot = {
  dishCount: number;
  kitchenCount: number;
  openKitchenCount: number;
  fastestPrepMinutes: number | null;
  prepLabel: string | null;
  priceFrom: number | null;
  priceTo: number | null;
  heroImageUrl: string | null;
  secondaryImageUrl: string | null;
  topKitchenName: string | null;
  totalOrders: number;
};

function formatFastestPrep(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return `from ${minutes / 60} hr`;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `from ${hours}h ${mins}m` : `from ${hours} hr`;
  }
  return `from ${minutes} min`;
}

/**
 * Live shelf snapshot for meal/cuisine listing chrome.
 * Only returns facts present on real listings - never invents prep, price, or orders.
 */
export function buildGuidedListingSnapshot(
  listings: readonly GuidedListingSnapshotInput[],
): GuidedListingSnapshot {
  const sellers = new Map<string, GuidedListingSnapshotInput>();
  let openKitchenCount = 0;
  let priceFrom: number | null = null;
  let priceTo: number | null = null;
  let fastestPrepMinutes: number | null = null;
  let totalOrders = 0;
  const withPhotos: GuidedListingSnapshotInput[] = [];

  for (const listing of listings) {
    const sellerKey = String(listing.seller_id || listing.seller_name || '').trim();
    if (sellerKey && !sellers.has(sellerKey)) {
      sellers.set(sellerKey, listing);
      const open = listing.seller_is_available === true && listing.seller_vacation_mode !== true;
      if (open) openKitchenCount += 1;
    }
    const price = Number(listing.price);
    if (Number.isFinite(price) && price > 0) {
      priceFrom = priceFrom == null ? price : Math.min(priceFrom, price);
      priceTo = priceTo == null ? price : Math.max(priceTo, price);
    }
    const prep = listingPrepMinutes(listing);
    if (prep != null && prep > 0 && prep <= 360) {
      fastestPrepMinutes = fastestPrepMinutes == null ? prep : Math.min(fastestPrepMinutes, prep);
    }
    const orders = Number(listing.completed_order_count);
    if (Number.isFinite(orders) && orders > 0) totalOrders += Math.round(orders);
    if (listing.image_url?.trim()) withPhotos.push(listing);
  }

  const heroImageUrl = pickDishListingPhoto(withPhotos as any) || withPhotos[0]?.image_url || null;
  const secondaryImageUrl = withPhotos.find((item) => item.image_url !== heroImageUrl)?.image_url || null;
  const topKitchen = [...sellers.values()]
    .sort((a, b) => (Number(b.completed_order_count) || 0) - (Number(a.completed_order_count) || 0))[0];

  return {
    dishCount: listings.length,
    kitchenCount: sellers.size,
    openKitchenCount,
    fastestPrepMinutes,
    prepLabel: fastestPrepMinutes != null ? formatFastestPrep(fastestPrepMinutes) : null,
    priceFrom,
    priceTo,
    heroImageUrl,
    secondaryImageUrl,
    topKitchenName: topKitchen?.seller_name?.trim() || null,
    totalOrders,
  };
}

/** Dynamic listing headline from live counts. */
export function guidedListingHeadline(snapshot: GuidedListingSnapshot): string {
  if (snapshot.dishCount <= 0) return 'No matches nearby';
  const dishWord = snapshot.dishCount === 1 ? 'dish' : 'dishes';
  if (snapshot.kitchenCount > 0) {
    const kitchenWord = snapshot.kitchenCount === 1 ? 'kitchen' : 'kitchens';
    return `${snapshot.dishCount} ${dishWord} · ${snapshot.kitchenCount} ${kitchenWord}`;
  }
  return `${snapshot.dishCount} ${dishWord} nearby`;
}

/** Dynamic subline from live prep / open / cuisine filter. Never pads with fake copy. */
export function guidedListingSubline(
  snapshot: GuidedListingSnapshot,
  options?: { cuisineLabel?: string | null },
): string | null {
  const parts: string[] = [];
  if (options?.cuisineLabel) parts.push(options.cuisineLabel);
  if (snapshot.openKitchenCount > 0 && snapshot.openKitchenCount === snapshot.kitchenCount) {
    parts.push(snapshot.openKitchenCount === 1 ? '1 kitchen open' : `${snapshot.openKitchenCount} kitchens open`);
  } else if (snapshot.openKitchenCount > 0) {
    parts.push(`${snapshot.openKitchenCount} open now`);
  }
  if (snapshot.prepLabel) parts.push(snapshot.prepLabel);
  if (snapshot.totalOrders > 0) {
    parts.push(`${snapshot.totalOrders} order${snapshot.totalOrders === 1 ? '' : 's'} fulfilled`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function buildGuidedCuisineChips(
  listings: readonly GuidedDiscoveryListing[],
): Array<{ id: FoodCuisineId; label: string; count: number }> {
  return FOOD_CUISINES
    .filter((cuisine) => cuisine.id !== 'other')
    .map((cuisine) => ({
      id: cuisine.id,
      label: cuisine.label,
      count: listings.filter((listing) => productMatchesFoodFacets(listing, { cuisine: cuisine.id })).length,
    }))
    .filter((chip) => chip.count > 0);
}

export const GUIDED_DISCOVERY_HUBS: readonly GuidedDiscoveryHubDef[] = [
  {
    id: 'home_food',
    title: 'Home Food',
    subtitle: 'Fresh homemade by neighbors',
    kind: 'shop_categories',
    categories: ['home_food'],
    parentGroup: 'food_beverages',
  },
  {
    id: 'restaurant_food',
    title: 'Restaurant Food',
    subtitle: 'Your favorite local restaurants',
    kind: 'shop_categories',
    categories: ['restaurant', 'cafe'],
    parentGroup: 'food_beverages',
  },
  {
    id: 'pickles_homemade',
    title: 'Pickles & Homemade',
    subtitle: 'Pickles, snacks and sweets',
    kind: 'shop_categories',
    categories: ['pickles', 'snacks', 'bakery'],
    parentGroup: 'food_beverages',
  },
  {
    id: 'daily_needs',
    title: 'Daily Needs',
    subtitle: 'Groceries and essentials',
    kind: 'shop_categories',
    categories: ['groceries'],
    parentGroup: 'food_beverages',
  },
  {
    id: 'services',
    title: 'Services',
    subtitle: 'Repairs, cleaning and more',
    kind: 'enquiry',
  },
  {
    id: 'book_enquire',
    title: 'Discover services near you',
    subtitle: 'Tuition, salon, fitness and more',
    kind: 'book',
  },
  {
    id: 'contact_seller',
    title: 'Discover listings',
    subtitle: 'Browse neighbors and message them directly',
    kind: 'contact',
  },
];

export const BOOK_TILE_ORDER = ['salon', 'beauty', 'tuition', 'fitness'] as const;

export const BOOK_TILE_COPY: Record<string, { label: string; subtitle: string }> = {
  salon: { label: 'Salon Appointments', subtitle: 'Hair styling, cuts and more' },
  beauty: { label: 'Beauty at Home', subtitle: 'Salon services at your doorstep' },
  tuition: { label: 'Tuition classes', subtitle: 'Academic support for all ages' },
  fitness: { label: 'Fitness', subtitle: 'Workouts and wellness sessions' },
};

const MEAL_TILE_COPY: Record<FoodMealId, { label: string; subtitle: string }> = {
  breakfast: { label: 'Breakfast', subtitle: 'Idli, paratha, poha and morning favourites' },
  lunch: { label: 'Lunch', subtitle: 'Thalis, rice, curries and daily meals' },
  dinner: { label: 'Dinner', subtitle: 'Rotis, curries and complete meals' },
  snack: { label: 'Snacks', subtitle: 'Samosas, cutlets, chaats and evening snacks' },
};

export function guidedDiscoveryHubHref(hubId: GuidedDiscoveryHubId): string {
  return `/explore/${hubId}`;
}

export function isGuidedDiscoveryHubId(raw: string | null | undefined): raw is GuidedDiscoveryHubId {
  return GUIDED_DISCOVERY_HUBS.some((hub) => hub.id === raw);
}

export function guidedDiscoveryHubDef(hubId: GuidedDiscoveryHubId): GuidedDiscoveryHubDef | undefined {
  return GUIDED_DISCOVERY_HUBS.find((hub) => hub.id === hubId);
}

export function guidedDiscoveryPageTitle(
  hubId: GuidedDiscoveryHubId,
  tile?: GuidedDiscoveryTile | null,
): string {
  return tile?.label || guidedDiscoveryHubDef(hubId)?.title || 'Explore';
}

export function guidedDiscoveryPageSubtitle(
  hubId: GuidedDiscoveryHubId,
  tile?: GuidedDiscoveryTile | null,
  snapshot?: GuidedListingSnapshot | null,
): string {
  if (snapshot && tile) {
    const live = guidedListingSubline(snapshot) || guidedListingHeadline(snapshot);
    if (live && snapshot.dishCount > 0) return live;
  }
  if (tile?.kind === 'meal') {
    if (tile.eta) return tile.eta;
    if (tile.count > 0) {
      return tile.count === 1 ? '1 dish nearby' : `${tile.count} dishes nearby`;
    }
    return tile.subtitle;
  }
  if (tile?.kind === 'tiffin') {
    if (tile.eta) return tile.eta;
    return tile.subtitle || 'Daily or weekly meal plans';
  }
  if (tile) return tile.subtitle;
  return guidedDiscoveryHubDef(hubId)?.subtitle || 'Browse what is available in your society';
}

export function guidedDiscoverySeeAllHref(hubId: GuidedDiscoveryHubId): string {
  if (hubId === 'home_food') return '/category/food_beverages?sub=home_food';
  if (hubId === 'restaurant_food') return '/category/food_beverages';
  if (hubId === 'pickles_homemade') return '/category/food_beverages?sub=pickles';
  if (hubId === 'daily_needs') return '/category/food_beverages?sub=groceries';
  if (hubId === 'book_enquire') return '/book';
  return '/services';
}

function listingAction(
  listing: GuidedDiscoveryListing,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): ProductActionType {
  return resolveListingAction(listing.action_type, listing.category, categoryConfigs);
}

function isShopAction(action: ProductActionType): boolean {
  return action === 'add_to_cart' || action === 'buy_now';
}

export function listingMatchesGuidedHub(
  hub: Pick<GuidedDiscoveryHubDef, 'kind' | 'categories'>,
  listing: GuidedDiscoveryListing,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): boolean {
  const action = listingAction(listing, categoryConfigs);
  if (hub.kind === 'shop_categories') {
    return isShopAction(action) && !!listing.category && (hub.categories || []).includes(listing.category);
  }
  if (hub.kind === 'book') {
    return action === 'book' || action === 'schedule_visit';
  }
  if (hub.kind === 'contact') {
    return action === 'contact_seller';
  }
  return action === 'request_service' || action === 'request_quote' || action === 'make_offer';
}

export function isTiffinListing(listing: GuidedDiscoveryListing): boolean {
  const slug = String(listing.subcategory || listing.subcategory_slug || '').trim().toLowerCase();
  if ((TIFFIN_SUBCATEGORY_SLUGS as readonly string[]).includes(slug)) return true;
  const blob = `${listing.name || ''} ${(listing.tags || []).join(' ')}`.toLowerCase();
  return /\btiffin\b/.test(blob);
}

export function listingsForGuidedHub<T extends GuidedDiscoveryListing>(
  hubId: GuidedDiscoveryHubId,
  listings: readonly T[],
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): T[] {
  const def = guidedDiscoveryHubDef(hubId);
  if (!def) return [];
  return listings.filter((listing) => listingMatchesGuidedHub(def, listing, categoryConfigs));
}

function categoryLabel(slug: string, metas?: readonly GuidedDiscoveryCategoryMeta[]): string {
  const hit = metas?.find((meta) => meta.category === slug);
  if (hit?.displayName?.trim()) return hit.displayName.trim();
  return slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function categoryImage(slug: string, metas?: readonly GuidedDiscoveryCategoryMeta[]): string | null {
  const hit = metas?.find((meta) => meta.category === slug);
  return hit?.imageUrl || null;
}

export function homeFoodMealHref(meal: FoodMealId): string {
  const params = writeFoodFacetsToSearchParams(new URLSearchParams(), { meal });
  params.set('sub', 'home_food');
  return `/category/food_beverages?${params.toString()}`;
}

export function buildGuidedDiscoveryHubs(
  listings: readonly GuidedDiscoveryListing[],
  options?: {
    categoryConfigs?: readonly CategoryActionConfig[] | null;
    categoryMeta?: readonly GuidedDiscoveryCategoryMeta[];
  },
): GuidedDiscoveryHub[] {
  const usedPhotos = new Set<string>();
  const hubs: GuidedDiscoveryHub[] = [];
  for (const def of GUIDED_DISCOVERY_HUBS) {
    const matched = listings.filter((listing) => listingMatchesGuidedHub(def, listing, options?.categoryConfigs));
    if (matched.length === 0) continue;
    const categoryPhoto = (def.categories || [])
      .map((slug) => categoryImage(slug, options?.categoryMeta))
      .find((url): url is string => !!url);
    const hubCategory = def.categories?.[0] || null;
    const live = pickDishListingPhoto(matched, usedPhotos)
      || pickListingChipPhoto(matched, usedPhotos)
      || null;
    let imageUrl = live;
    if (!imageUrl && categoryPhoto && !usedPhotos.has(categoryPhoto)) {
      usedPhotos.add(categoryPhoto);
      imageUrl = categoryPhoto;
    }
    if (!imageUrl) {
      imageUrl = resolveFoodChipArt(null, { category: hubCategory }, usedPhotos)
        || curatedCategoryArt(hubCategory);
    }
    hubs.push({
      id: def.id,
      title: def.title,
      subtitle: def.subtitle,
      href: guidedDiscoveryHubHref(def.id),
      imageUrl,
      count: matched.length,
      kind: def.kind,
    });
  }
  return hubs;
}

function uniqueCategories(listings: readonly GuidedDiscoveryListing[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const listing of listings) {
    const category = String(listing.category || '').trim();
    if (!category || seen.has(category)) continue;
    seen.add(category);
    order.push(category);
  }
  return order;
}

export function listingMatchesGuidedTile(
  tileId: string | null | undefined,
  listing: GuidedDiscoveryListing,
): boolean {
  if (!tileId) return true;
  if (tileId === 'tiffin') return isTiffinListing(listing);
  if (tileId.startsWith('meal:')) {
    const meal = tileId.slice('meal:'.length) as FoodMealId;
    return productMatchesFoodFacets(listing, { meal });
  }
  if (tileId.startsWith('cuisine:')) {
    const cuisine = tileId.slice('cuisine:'.length) as FoodCuisineId;
    return productMatchesFoodFacets(listing, { cuisine });
  }
  if (tileId.startsWith('category:')) {
    return listing.category === tileId.slice('category:'.length);
  }
  return true;
}

export function filterGuidedDiscoveryListings<T extends GuidedDiscoveryListing>(
  hubId: GuidedDiscoveryHubId,
  listings: readonly T[],
  options?: {
    tileId?: string | null;
    cuisine?: FoodCuisineId | null;
    categoryConfigs?: readonly CategoryActionConfig[] | null;
  },
): T[] {
  const hubListings = listingsForGuidedHub(hubId, listings, options?.categoryConfigs);
  return hubListings.filter((listing) => {
    if (options?.tileId && !listingMatchesGuidedTile(options.tileId, listing)) return false;
    if (options?.cuisine && !productMatchesFoodFacets(listing, { cuisine: options.cuisine })) return false;
    return true;
  });
}

export function buildGuidedDiscoveryTiles(
  hubId: GuidedDiscoveryHubId,
  listings: readonly GuidedDiscoveryListing[],
  options?: {
    categoryConfigs?: readonly CategoryActionConfig[] | null;
    categoryMeta?: readonly GuidedDiscoveryCategoryMeta[];
  },
): GuidedDiscoveryTile[] {
  const hubListings = listingsForGuidedHub(hubId, listings, options?.categoryConfigs);
  if (hubListings.length === 0) return [];
  const usedPhotos = new Set<string>();
  const tiles: GuidedDiscoveryTile[] = [];

  if (hubId === 'home_food') {
    for (const meal of FOOD_MEALS) {
      const matched = hubListings.filter((listing) => productMatchesFoodFacets(listing, { meal: meal.id }));
      if (matched.length === 0) continue;
      const copy = MEAL_TILE_COPY[meal.id];
      // Meal tiles are destinations (morning / lunch / dinner worlds), not product thumbs.
      const mealArt = curatedMealArt(meal.id);
      if (mealArt) usedPhotos.add(mealArt);
      tiles.push({
        id: `meal:${meal.id}`,
        kind: 'meal',
        label: copy.label,
        subtitle: copy.subtitle,
        href: homeFoodMealHref(meal.id),
        imageUrl: mealArt,
        count: matched.length,
        eta: guidedKitchenCountLabel(matched) || null,
      });
    }
    const tiffin = hubListings.filter(isTiffinListing);
    if (tiffin.length > 0) {
      const live = pickDishListingPhoto(tiffin, usedPhotos) || pickListingChipPhoto(tiffin, usedPhotos);
      tiles.push({
        id: 'tiffin',
        kind: 'tiffin',
        label: 'Tiffin Service',
        subtitle: 'Daily or weekly meal plans',
        href: '/explore/home_food?tile=tiffin',
        imageUrl: live || resolveFoodChipArt(null, { category: 'home_food' }, usedPhotos),
        count: tiffin.length,
        eta: guidedKitchenCountLabel(tiffin) || null,
      });
    }
    return tiles;
  }

  if (hubId === 'restaurant_food') {
    for (const cuisine of FOOD_CUISINES) {
      if (cuisine.id === 'other') continue;
      const matched = hubListings.filter((listing) => productMatchesFoodFacets(listing, { cuisine: cuisine.id }));
      if (matched.length === 0) continue;
      tiles.push({
        id: `cuisine:${cuisine.id}`,
        kind: 'cuisine',
        label: cuisine.label,
        subtitle: 'From restaurants and cafes nearby',
        href: foodFacetsBrowsePath('food_beverages', { cuisine: cuisine.id }),
        imageUrl: curatedCuisineArt(cuisine.id)
          || pickListingChipPhoto(matched, usedPhotos)
          || resolveFoodChipArt(null, { cuisine: cuisine.id, category: 'restaurant' }, usedPhotos),
        count: matched.length,
        eta: guidedSpotCountLabel(matched) || null,
      });
    }
    return tiles;
  }

  const categoryHref = (category: string) => {
    if (hubId === 'book_enquire') return `/book?sub=${encodeURIComponent(category)}`;
    if (hubId === 'contact_seller' || hubId === 'services') {
      return `/services?sub=${encodeURIComponent(category)}`;
    }
    return `/category/food_beverages?sub=${encodeURIComponent(category)}`;
  };

  const preferred = GUIDED_DISCOVERY_HUBS.find((hub) => hub.id === hubId)?.categories;
  const liveSlugs = preferred
    ? preferred.filter((slug) => hubListings.some((listing) => listing.category === slug))
    : uniqueCategories(hubListings);
  const slugs = hubId === 'book_enquire'
    ? [
        ...BOOK_TILE_ORDER.filter((slug) => liveSlugs.includes(slug)),
        ...liveSlugs.filter((slug) => !(BOOK_TILE_ORDER as readonly string[]).includes(slug)),
      ]
    : liveSlugs;

  for (const slug of slugs) {
    const matched = hubListings.filter((listing) => listing.category === slug);
    if (matched.length === 0) continue;
    const bookCopy = hubId === 'book_enquire' ? BOOK_TILE_COPY[slug] : undefined;
    tiles.push({
      id: `category:${slug}`,
      kind: 'category',
      label: bookCopy?.label || categoryLabel(slug, options?.categoryMeta),
      subtitle: bookCopy?.subtitle
        || (hubId === 'book_enquire'
          ? 'Book a time nearby'
          : hubId === 'contact_seller'
            ? 'Message the seller directly'
            : hubId === 'services'
              ? 'Request help nearby'
              : 'Available in your society'),
      href: categoryHref(slug),
      imageUrl: pickListingChipPhoto(matched, usedPhotos) || categoryImage(slug, options?.categoryMeta),
      count: matched.length,
      eta: guidedCollectionEta(matched),
    });
  }

  return tiles;
}
