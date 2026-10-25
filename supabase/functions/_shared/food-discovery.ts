/**
 * Fulfilment-honest food discovery.
 * Catalogue is the CMS. Frames are the voice. Silence is a valid outcome.
 */

export const TITLE_MAX = 40;
export const BODY_MAX = 100;
export const FOOD_DISCOVERY_SOURCE = 'food_discovery';
export const FOOD_DISCOVERY_TYPE = 'promotion';

export type MealSlot = 'breakfast' | 'lunch' | 'evening';
export type Fulfillment = 'now' | 'schedule';
export type DestKind = 'product' | 'store' | 'meal_collection';
export type DiscoveryMode = 'off' | 'shadow' | 'live';

export const FOOD_DISCOVERY_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'evening'];

export const DEFAULT_FOOD_DISCOVERY_CONFIG = {
  mode: 'shadow' as DiscoveryMode,
  timezone: 'Asia/Kolkata',
  slots: {
    breakfast: { hour: 10, minute: 15, enabled: true },
    lunch: { hour: 11, minute: 15, enabled: true },
    evening: { hour: 17, minute: 30, enabled: true },
  },
  max_per_user_per_day: 2,
  max_per_user_per_week: 10,
  min_hours_between: 4,
  auto_include_food_stores: true,
  seller_ids: [
    '3dac28c6-74dc-4b3f-bb85-614dc3b40794',
    '0a670c2b-f28a-4916-90cf-47fb1e9edbfa',
    '40829bcd-c028-4f30-94e1-b071092c59ae',
    '66eb3652-5fb0-4a70-abe6-fd5853530490',
    '63cc42c4-4704-48dc-ad7b-2eeeae42c70e',
    '6e73b27d-606b-4593-a685-0b8279d2452e',
  ],
  exclude_seller_ids: [] as string[],
  exclude_name_patterns: ['qa', '[hold]', 'test product'],
  society_ids: [
    '327fb699-542e-4ab6-b0b1-97022604bb88',
    'e3b1aa9b-d4e5-467c-b95e-13348129f426',
  ],
  grace_minutes_before: 10,
  grace_minutes_after: 45,
};

export type FoodDiscoveryConfig = typeof DEFAULT_FOOD_DISCOVERY_CONFIG;

export type DiscoveryFrame = {
  id: string;
  slot: MealSlot;
  theme: string;
  fulfillment: Fulfillment | 'any';
  keywords: string[];
  title: string;
  body: string;
  dest: DestKind;
  eveningKind?: 'snack' | 'dinner';
};

export type DiscoveryProduct = {
  id: string;
  name: string;
  price: number | null;
  category: string | null;
  cuisineType: string | null;
  tags: string[] | null;
  isAvailable: boolean;
  stockQuantity: number | null;
  sellerId: string;
  sellerName: string;
  sellerSocietyId?: string | null;
  primaryGroup?: string | null;
  sellerCategories?: string[] | null;
  storeAvailable: boolean;
  vacationMode: boolean;
  availabilityStart: string | null;
  availabilityEnd: string | null;
  operatingDays: string[] | null;
};

export type RecentDiscoverySend = {
  istDate: string;
  slot: MealSlot;
  sellerId: string | null;
  variantId: string | null;
  productId: string | null;
};

export type DiscoverySelection = {
  slot: MealSlot;
  fulfillment: Fulfillment;
  frameId: string;
  title: string;
  body: string;
  destination: string;
  destKind: DestKind;
  productId: string | null;
  productName: string | null;
  sellerId: string;
  sellerName: string;
  price: number | null;
  whenLabel: string;
};

export type DiscoverySkip = {
  skip: true;
  reason: string;
};

const FOOD_CATEGORIES = new Set([
  'home_food',
  'cafe',
  'pickles',
  'bakery',
  'snacks',
  'restaurant',
  'breakfast_items',
  'groceries',
]);

const FOOD_GROUPS = new Set(['food_beverages', 'food']);

const DAY_ABBREVS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function unicodeLen(value: string): number {
  return Array.from(value).length;
}

export function istWall(now: Date) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    date: ist.getUTCDate(),
    day: ist.getUTCDay(),
    hours: ist.getUTCHours(),
    minutes: ist.getUTCMinutes(),
    minutesOfDay: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  };
}

export function istDateKey(now: Date): string {
  const w = istWall(now);
  return `${w.year}-${String(w.month + 1).padStart(2, '0')}-${String(w.date).padStart(2, '0')}`;
}

export function formatHourMinute12h(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}

function parseHm(raw: string | null | undefined): { h: number; m: number } | null {
  if (!raw) return null;
  const parts = String(raw).trim().split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return { h, m };
}

function operatingDayMatches(operatingDays: string[] | null | undefined, currentDay: string): boolean {
  if (!operatingDays || operatingDays.length === 0) return true;
  const needle = currentDay.slice(0, 3).toLowerCase();
  const dayIdx = DAY_ABBREVS.findIndex((d) => d.toLowerCase() === needle);
  return operatingDays.some((d) => {
    const s = String(d ?? '').trim();
    if (!s) return false;
    if (s.slice(0, 3).toLowerCase() === needle) return true;
    if (/^\d+$/.test(s) && Number(s) === dayIdx) return true;
    return false;
  });
}

export type SimpleStoreStatus = 'open' | 'closed' | 'closed_today' | 'paused';

export function storeStatusNow(product: DiscoveryProduct, now: Date): SimpleStoreStatus {
  if (!product.storeAvailable || product.vacationMode) return 'paused';
  const wall = istWall(now);
  const currentDay = DAY_ABBREVS[wall.day];
  if (!operatingDayMatches(product.operatingDays, currentDay)) return 'closed_today';
  const start = parseHm(product.availabilityStart);
  const end = parseHm(product.availabilityEnd);
  if (!start || !end) return 'open';
  const startM = start.h * 60 + start.m;
  const rawEnd = end.h * 60 + end.m;
  const endM = rawEnd === 0 ? 1440 : rawEnd;
  const overnight = endM <= startM;
  const current = wall.minutesOfDay;
  const isOpen = overnight
    ? current >= startM || current < endM
    : current >= startM && current < endM;
  return isOpen ? 'open' : 'closed';
}

export function openTimeLabel(product: DiscoveryProduct): string {
  const start = parseHm(product.availabilityStart);
  if (!start) return '';
  return formatHourMinute12h(start.h, start.m);
}

export function isFoodStore(product: {
  category?: string | null;
  primaryGroup?: string | null;
  sellerCategories?: string[] | null;
}): boolean {
  if (FOOD_CATEGORIES.has(String(product.category || '').trim())) return true;
  if (FOOD_GROUPS.has(String(product.primaryGroup || '').trim())) return true;
  return (product.sellerCategories || []).some((c) => FOOD_CATEGORIES.has(String(c)));
}

export function isExcludedSellerName(name: string, patterns: string[]): boolean {
  const hay = name.toLowerCase();
  return patterns.some((p) => hay.includes(p.toLowerCase()));
}

export function mergeFoodDiscoveryConfig(raw: unknown): FoodDiscoveryConfig {
  const base = JSON.parse(JSON.stringify(DEFAULT_FOOD_DISCOVERY_CONFIG)) as FoodDiscoveryConfig;
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as Record<string, unknown>;
  if (src.mode === 'off' || src.mode === 'shadow' || src.mode === 'live') base.mode = src.mode;
  if (typeof src.max_per_user_per_day === 'number') base.max_per_user_per_day = src.max_per_user_per_day;
  if (typeof src.max_per_user_per_week === 'number') base.max_per_user_per_week = src.max_per_user_per_week;
  if (typeof src.min_hours_between === 'number') base.min_hours_between = src.min_hours_between;
  if (typeof src.auto_include_food_stores === 'boolean') {
    base.auto_include_food_stores = src.auto_include_food_stores;
  }
  if (Array.isArray(src.seller_ids)) base.seller_ids = src.seller_ids.map(String);
  if (Array.isArray(src.exclude_seller_ids)) base.exclude_seller_ids = src.exclude_seller_ids.map(String);
  if (Array.isArray(src.exclude_name_patterns)) {
    base.exclude_name_patterns = src.exclude_name_patterns.map(String);
  }
  if (Array.isArray(src.society_ids)) base.society_ids = src.society_ids.map(String);
  if (src.slots && typeof src.slots === 'object') {
    for (const slot of FOOD_DISCOVERY_SLOTS) {
      const row = (src.slots as Record<string, any>)[slot];
      if (!row) continue;
      if (typeof row.hour === 'number') base.slots[slot].hour = row.hour;
      if (typeof row.minute === 'number') base.slots[slot].minute = row.minute;
      if (typeof row.enabled === 'boolean') base.slots[slot].enabled = row.enabled;
    }
  }
  return base;
}

export function slotDueAt(slot: MealSlot, config: FoodDiscoveryConfig, now: Date): boolean {
  const spec = config.slots[slot];
  if (!spec.enabled) return false;
  const wall = istWall(now);
  const scheduled = spec.hour * 60 + spec.minute;
  const delta = wall.minutesOfDay - scheduled;
  return delta >= -config.grace_minutes_before && delta <= config.grace_minutes_after;
}

export function inferSlot(config: FoodDiscoveryConfig, now: Date): MealSlot | null {
  for (const slot of FOOD_DISCOVERY_SLOTS) {
    if (slotDueAt(slot, config, now)) return slot;
  }
  return null;
}

export function mealQueryForSlot(slot: MealSlot, eveningKind?: 'snack' | 'dinner'): string {
  if (slot === 'evening') return eveningKind === 'dinner' ? 'dinner' : 'snack';
  return slot;
}

export function destinationFor(
  dest: DestKind,
  slot: MealSlot,
  product: DiscoveryProduct,
  eveningKind?: 'snack' | 'dinner',
): string {
  if (dest === 'product') return `/product/${product.id}`;
  if (dest === 'store') return `/seller/${product.sellerId}`;
  return `/category/food_beverages?meal=${mealQueryForSlot(slot, eveningKind)}`;
}

function collapseCopy(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

export function renderDiscoveryCopy(
  frame: DiscoveryFrame,
  product: DiscoveryProduct,
  fulfillment: Fulfillment,
  whenLabel: string,
): { title: string; body: string } | null {
  const title = collapseCopy(frame.title);
  if (unicodeLen(title) === 0 || unicodeLen(title) > TITLE_MAX) return null;

  const priceBit = product.price != null && Number.isFinite(product.price)
    ? `from ₹${Math.round(Number(product.price))}`
    : '';
  const whenBit = fulfillment === 'schedule' && whenLabel
    ? (whenLabel.endsWith('.') ? whenLabel : `${whenLabel}.`)
    : '';

  const attempts = [
    { product: product.name, store: product.sellerName, price: priceBit, when: whenBit },
    { product: product.name, store: product.sellerName, price: '', when: whenBit },
    { product: product.name, store: '', price: '', when: whenBit },
    { product: '', store: product.sellerName, price: '', when: whenBit },
    { product: '', store: '', price: '', when: whenBit },
  ];

  for (const vars of attempts) {
    const body = collapseCopy(
      frame.body
        .replace(/\{product\}/g, vars.product)
        .replace(/\{store\}/g, vars.store)
        .replace(/\{price\}/g, vars.price)
        .replace(/\{when\}/g, vars.when),
    );
    if (!body) continue;
    if (unicodeLen(body) > BODY_MAX) continue;
    if (/\{[a-z]+\}/i.test(body)) continue;
    return { title, body };
  }
  return null;
}

function slotHaystack(product: DiscoveryProduct): string {
  return [
    product.name,
    product.category,
    product.cuisineType,
    ...(product.tags || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

const FACET_PREFIXES = ['meal:', 'course:', 'cuisine:'];

export function dishHaystack(product: DiscoveryProduct): string {
  const tags = (product.tags || []).filter((tag) => {
    const value = String(tag).toLowerCase();
    return !FACET_PREFIXES.some((prefix) => value.startsWith(prefix));
  });
  return [
    product.name,
    product.category,
    product.cuisineType,
    ...tags,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

const SLOTISH_WORDS = new Set([
  'breakfast', 'lunch', 'dinner', 'snack', 'morning', 'evening', 'today',
  'nearby', 'kitchen', 'kitchens', 'sociva', 'neighbour', 'neighbors',
  'home', 'plate', 'plates', 'food', 'order', 'orders', 'tea', 'chai',
  'cup', 'menu', 'list', 'now', 'later', 'local', 'style', 'homestyle',
]);

const DISH_CLAIM_TOKENS = [
  'rajma', 'chole', 'paratha', 'omelette', 'omlette', 'pakoda', 'pakora',
  'samosa', 'kachori', 'thukpa', 'thupka', 'momo', 'maggi', 'kadhi',
  'manchurian', 'pickle', 'makhana', 'thali', 'chapati', 'sabzi', 'biryani',
  'pasta', 'noodle', 'soup', 'roll', 'juice', 'coffee', 'fries', 'chops',
  'paneer', 'dal tadka', 'baingan', 'bhindi', 'pulao', 'poori', 'roti',
  'egg', 'eggs',
];

export function claimedDishesInCopy(title: string, body: string): string[] {
  const text = `${title} ${body}`.toLowerCase().replace(/\{[a-z]+\}/gi, ' ');
  return DISH_CLAIM_TOKENS
    .filter((token) => !SLOTISH_WORDS.has(token) && text.includes(token))
    .sort((a, b) => b.length - a.length);
}

export function frameCopyIsHonest(
  frame: DiscoveryFrame,
  product: DiscoveryProduct,
  eligible: DiscoveryProduct[],
  copy: { title: string; body: string },
): boolean {
  const claims = claimedDishesInCopy(frame.title, frame.body);
  if (claims.length === 0) return true;
  const productHay = dishHaystack(product);
  const matchedOnProduct = claims.filter((claim) => productHay.includes(claim));
  if (frame.dest === 'product') return claims.every((claim) => productHay.includes(claim));
  if (matchedOnProduct.length === 0) return false;
  const pool = frame.dest === 'store'
    ? eligible.filter((row) => row.sellerId === product.sellerId)
    : eligible;
  const poolHay = pool.map((row) => dishHaystack(row)).join(' | ');
  return claims.every((claim) => poolHay.includes(claim));
}

export function frameMatchesProduct(
  frame: DiscoveryFrame,
  product: DiscoveryProduct,
  slot: MealSlot,
  fulfillment: Fulfillment,
): boolean {
  if (frame.slot !== slot) return false;
  if (frame.fulfillment !== 'any' && frame.fulfillment !== fulfillment) return false;
  if (frame.keywords.length === 0) return true;
  const hay = dishHaystack(product);
  return frame.keywords.some((k) => hay.includes(k.toLowerCase()));
}

function slotProductHint(slot: MealSlot, eveningKind?: 'snack' | 'dinner'): string[] {
  if (slot === 'breakfast') {
    return ['paratha', 'omelette', 'omlette', 'breakfast', 'tea', 'coffee', 'sprout', 'roll', 'juice', 'milk'];
  }
  if (slot === 'lunch') {
    return ['lunch', 'rice', 'chole', 'rajma', 'dal', 'kadhi', 'paneer', 'thali', 'maggi', 'combo', 'sabzi', 'roti', 'poori'];
  }
  if (eveningKind === 'dinner') {
    return ['dinner', 'thukpa', 'thupka', 'soup', 'noodle', 'fried rice', 'manchurian', 'momo', 'roll'];
  }
  return ['snack', 'pakoda', 'pakora', 'samosa', 'kachori', 'fries', 'momo', 'pickle', 'makhana', 'tea', 'coffee'];
}

export function productFitsSlot(
  product: DiscoveryProduct,
  slot: MealSlot,
  eveningKind?: 'snack' | 'dinner',
): boolean {
  const hay = slotHaystack(product);
  const hints = slotProductHint(slot, eveningKind);
  if (hints.some((h) => hay.includes(h))) return true;
  if (slot === 'breakfast' && product.category === 'breakfast_items') return true;
  if (slot === 'evening' && eveningKind !== 'dinner' && product.category === 'snacks') return true;
  if (slot === 'evening' && eveningKind !== 'dinner' && product.category === 'pickles') return true;
  return false;
}

export function eveningKindForDate(istDate: string): 'snack' | 'dinner' {
  const day = Number(String(istDate).slice(-2)) || 1;
  return day % 2 === 0 ? 'dinner' : 'snack';
}

function eligibleProducts(
  products: DiscoveryProduct[],
  config: FoodDiscoveryConfig,
  now: Date,
  slot: MealSlot,
  eveningKind?: 'snack' | 'dinner',
): Array<DiscoveryProduct & { fulfillment: Fulfillment; status: SimpleStoreStatus }> {
  const excludeIds = new Set(config.exclude_seller_ids);
  const allowIds = new Set(config.seller_ids);
  const societyIds = new Set(config.society_ids);
  const out: Array<DiscoveryProduct & { fulfillment: Fulfillment; status: SimpleStoreStatus }> = [];

  for (const product of products) {
    if (!product.isAvailable) continue;
    if (product.stockQuantity != null && product.stockQuantity <= 0) continue;
    if (excludeIds.has(product.sellerId)) continue;
    if (isExcludedSellerName(product.sellerName, config.exclude_name_patterns)) continue;
    const listed = allowIds.has(product.sellerId);
    const inAudienceSociety = !!product.sellerSocietyId && societyIds.has(product.sellerSocietyId);
    if (!listed) {
      if (!config.auto_include_food_stores) continue;
      if (product.sellerSocietyId && !inAudienceSociety) continue;
    }
    if (!isFoodStore({
      category: product.category,
      primaryGroup: product.primaryGroup,
      sellerCategories: product.sellerCategories,
    })) continue;
    if (!productFitsSlot(product, slot, eveningKind)) continue;

    const status = storeStatusNow(product, now);
    if (status === 'paused' || status === 'closed_today') continue;
    const fulfillment: Fulfillment = status === 'open' ? 'now' : 'schedule';
    out.push({ ...product, fulfillment, status });
  }
  return out;
}

export function pickFoodDiscovery(args: {
  slot: MealSlot;
  now: Date;
  products: DiscoveryProduct[];
  recent: RecentDiscoverySend[];
  config?: FoodDiscoveryConfig;
}): DiscoverySelection | DiscoverySkip {
  const config = args.config || DEFAULT_FOOD_DISCOVERY_CONFIG;
  const istDate = istDateKey(args.now);
  const eveningKind = args.slot === 'evening' ? eveningKindForDate(istDate) : undefined;
  const eligible = eligibleProducts(args.products, config, args.now, args.slot, eveningKind);
  if (eligible.length === 0) return { skip: true, reason: 'no_eligible_products' };

  const lastSellerAt = new Map<string, string>();
  const usedFrames = new Set<string>();
  const usedProducts = new Set<string>();
  for (const row of args.recent) {
    if (row.sellerId) {
      const prev = lastSellerAt.get(row.sellerId);
      if (!prev || row.istDate > prev) lastSellerAt.set(row.sellerId, row.istDate);
    }
    if (row.istDate === istDate && row.variantId) usedFrames.add(row.variantId);
    if (row.variantId) usedFrames.add(`${row.istDate}:${row.variantId}`);
    if (row.productId) usedProducts.add(row.productId);
  }

  const sellers = [...new Set(eligible.map((p) => p.sellerId))].sort((a, b) => {
    const aAt = lastSellerAt.get(a) || '';
    const bAt = lastSellerAt.get(b) || '';
    if (aAt !== bAt) return aAt.localeCompare(bAt);
    return a.localeCompare(b);
  });

  for (const sellerId of sellers) {
    const sellerProducts = eligible.filter((p) => p.sellerId === sellerId);
    const fulfillment = sellerProducts[0].fulfillment;
    const whenLabel = fulfillment === 'schedule'
      ? `Opens ${openTimeLabel(sellerProducts[0])}`.trim()
      : '';

    const rankedProducts = [...sellerProducts].sort((a, b) => {
      const aUsed = usedProducts.has(a.id) ? 1 : 0;
      const bUsed = usedProducts.has(b.id) ? 1 : 0;
      if (aUsed !== bUsed) return aUsed - bUsed;
      return a.name.localeCompare(b.name);
    });

    for (const product of rankedProducts) {
      const frames = FOOD_DISCOVERY_FRAMES.filter((frame) => {
        if (usedFrames.has(frame.id) || usedFrames.has(`${istDate}:${frame.id}`)) return false;
        if (frame.eveningKind && eveningKind && frame.eveningKind !== eveningKind) return false;
        return frameMatchesProduct(frame, product, args.slot, fulfillment);
      });
      for (const frame of frames) {
        const copy = renderDiscoveryCopy(frame, product, fulfillment, whenLabel);
        if (!copy) continue;
        if (!frameCopyIsHonest(frame, product, eligible, copy)) continue;
        return {
          slot: args.slot,
          fulfillment,
          frameId: frame.id,
          title: copy.title,
          body: copy.body,
          destination: destinationFor(frame.dest, args.slot, product, eveningKind),
          destKind: frame.dest,
          productId: frame.dest === 'product' ? product.id : null,
          productName: product.name,
          sellerId: product.sellerId,
          sellerName: product.sellerName,
          price: product.price,
          whenLabel,
        };
      }
    }
  }

  return { skip: true, reason: 'no_matching_frame' };
}

export function isDiscoverySkip(value: DiscoverySelection | DiscoverySkip): value is DiscoverySkip {
  return (value as DiscoverySkip).skip === true;
}

function f(
  id: string,
  slot: MealSlot,
  theme: string,
  keywords: string[],
  title: string,
  body: string,
  dest: DestKind = 'product',
  fulfillment: Fulfillment | 'any' = 'any',
  eveningKind?: 'snack' | 'dinner',
): DiscoveryFrame {
  return { id, slot, theme, keywords, title, body, dest, fulfillment, eveningKind };
}

export const FOOD_DISCOVERY_FRAMES: DiscoveryFrame[] = [
  f('b01', 'breakfast', 'paratha', ['paratha'], 'Paratha Morning, Sorted', 'Fresh aloo and cheese parathas nearby. {when} Find breakfast on Sociva.'),
  f('b02', 'breakfast', 'paratha', ['aloo paratha'], 'Warm Aloo Paratha Nearby', '{product} {price}. {when} A homestyle start on Sociva.', 'product'),
  f('b03', 'breakfast', 'paratha', ['cheese paratha'], 'Cheese Paratha Today', '{product} {price} from {store}. {when} Order when you are ready.', 'product'),
  f('b04', 'breakfast', 'paratha', ['paratha'], 'Start With a Paratha', 'Hot stuffed parathas from a neighbour kitchen. {when} Browse breakfast nearby.'),
  f('b05', 'breakfast', 'omelette', ['omelette', 'omlette'], 'Omelette Kind of Morning', '{product} {price}. {when} A simple breakfast on Sociva.', 'product'),
  f('b06', 'breakfast', 'omelette', ['omlette', 'omelette'], 'Eggs, Soft and Simple', 'Cafe-style omelettes from {store}. {when} See what is cooking.', 'store'),
  f('b07', 'breakfast', 'breakfast', ['breakfast', 'paratha', 'omelette', 'omlette'], 'A Quiet Breakfast Nearby', 'Parathas, eggs and tea from local kitchens. {when} Explore morning food.'),
  f('b08', 'breakfast', 'tea', ['tea'], 'Tea First, Then Food', '{product} {price}. {when} Pair it with breakfast nearby.', 'product'),
  f('b09', 'breakfast', 'coffee', ['coffee'], 'Mountain Coffee is On', '{product} {price} from {store}. {when} Start slow on Sociva.', 'product'),
  f('b10', 'breakfast', 'tea', ['assam tea', 'tea'], 'Assam Tea, Close By', 'A proper cup from {store}. {when} Find tea and breakfast nearby.', 'store'),
  f('b11', 'breakfast', 'roll', ['roll'], 'Breakfast Rolls Nearby', '{product} {price}. {when} Grab a morning roll on Sociva.', 'product'),
  f('b12', 'breakfast', 'roll', ['paneer', 'roll'], 'Paneer Roll This Morning', 'Warm paneer rolls from {store}. {when} See the breakfast counter.', 'store'),
  f('b13', 'breakfast', 'sprouts', ['sprout'], 'Something Light to Start', '{product} {price}. {when} A lighter breakfast on Sociva.', 'product'),
  f('b14', 'breakfast', 'milk', ['badam milk', 'milk'], 'Badam Milk to Begin', '{product} {price}. {when} Warm, simple, nearby.', 'product'),
  f('b15', 'breakfast', 'juice', ['juice'], 'Fresh Juice Nearby', '{product} {price} from {store}. {when} Add it to breakfast.', 'product'),
  f('b16', 'breakfast', 'breakfast', [], 'Breakfast From Next Door', 'Homestyle morning plates from your society. {when} Explore breakfast on Sociva.', 'meal_collection'),
  f('b17', 'breakfast', 'breakfast', [], 'Skip the Guessing, Eat', 'See what local kitchens made for breakfast. {when} Open Sociva and pick.', 'meal_collection'),
  f('b18', 'breakfast', 'breakfast', [], 'A Soft Start Nearby', 'Tea, parathas and eggs from neighbours. {when} Browse the morning menu.', 'meal_collection'),
  f('b19', 'breakfast', 'paratha', ['paratha'], 'Order Breakfast, Unhurried', 'Parathas worth waiting for. {when} Schedule or grab them on Sociva.', 'meal_collection'),
  f('b20', 'breakfast', 'coffee', ['coffee', 'tea'], 'Warm Cup, Warm Kitchen', 'Coffee and tea from {store}. {when} Pair with a morning bite.', 'store'),
  f('b21', 'breakfast', 'breakfast', ['paratha', 'omelette', 'omlette'], 'Homestyle Morning Plate', 'The kind of breakfast that feels like home. {when} See nearby options.', 'meal_collection'),
  f('b22', 'breakfast', 'schedule', ['paratha', 'breakfast'], 'Breakfast, Ready When They Open', 'Local kitchens are taking breakfast orders. {when} Reserve yours on Sociva.', 'meal_collection', 'schedule'),
  f('b23', 'breakfast', 'now', ['paratha', 'omelette', 'omlette', 'tea'], 'Kitchens Are Open', 'Breakfast is on from neighbours nearby. Come pick a plate on Sociva.', 'meal_collection', 'now'),
  f('b24', 'breakfast', 'juice', ['orange juice', 'juice'], 'A Glass of Fresh Orange', '{product} {price}. {when} A bright start from {store}.', 'product'),

  f('l01', 'lunch', 'thali', ['rajma', 'chole', 'combo', 'thali', 'sabzi', 'chapati'], 'Ghar Jaisa Lunch, Nearby', 'Rajma rice, chole rice and home-style plates. Explore today on Sociva.', 'meal_collection'),
  f('l02', 'lunch', 'chole', ['chole'], 'Chole Rice is Calling', '{product} {price}. {when} A solid lunch from {store}.', 'product'),
  f('l03', 'lunch', 'rajma', ['rajma'], 'Rajma Rice, Sorted', '{product} {price} from {store}. {when} Comfort lunch on Sociva.', 'product'),
  f('l04', 'lunch', 'dal', ['dal tadka', 'dal fry'], 'Dal Tadka for Lunch', '{product} {price}. {when} Homestyle dal, close by.', 'product'),
  f('l05', 'lunch', 'kadhi', ['kadhi'], 'Kadhi, Slow and Familiar', '{product} {price} from {store}. {when} See lunch options.', 'product'),
  f('l06', 'lunch', 'paneer', ['paneer bhurji'], 'Paneer Bhurji Today', '{product} {price}. {when} A richer lunch nearby.', 'product'),
  f('l07', 'lunch', 'paneer', ['paneer'], 'Paneer, Homestyle', 'Kadai, palak or bhurji from local kitchens. {when} Browse lunch on Sociva.', 'meal_collection'),
  f('l08', 'lunch', 'rice', ['jeera rice', 'rice'], 'Jeera Rice on the Side', '{product} {price}. {when} Build a proper lunch plate.', 'product'),
  f('l09', 'lunch', 'roti', ['roti', 'chapati'], 'Roti, Dal, Done', 'Tawa roti and homestyle sabzi nearby. {when} Find lunch on Sociva.', 'meal_collection'),
  f('l10', 'lunch', 'combo', ['combo', 'chole poori', 'poori'], 'Chole Poori If You Want More', '{product} {price} from {store}. {when} A fuller lunch.', 'product'),
  f('l11', 'lunch', 'thali', ['chapati', 'rice', 'sabzi'], 'A Proper Home Thali', '{product} {price}. {when} Lunch that needs no explaining.', 'product'),
  f('l12', 'lunch', 'maggi', ['maggi'], 'Pahadi Maggi for Lunch', '{product} {price} from {store}. {when} Quick, warm, nearby.', 'product'),
  f('l13', 'lunch', 'friedrice', ['fried rice'], 'Fried Rice, Wok Hot', '{product} {price}. {when} An easy lunch from {store}.', 'product'),
  f('l14', 'lunch', 'lunch', [], 'What is for Lunch Nearby?', 'Home kitchens and cafes around you. {when} Open today\'s lunch list.', 'meal_collection'),
  f('l15', 'lunch', 'lunch', [], 'No Office Canteen Needed', 'Neighbour lunch plates are on Sociva. {when} Pick before the rush.', 'meal_collection'),
  f('l16', 'lunch', 'lunch', ['preorder', 'combo', 'lunch'], 'Lunch Worth Booking Ahead', 'Some plates need a little notice. {when} See what you can still order.', 'meal_collection'),
  f('l17', 'lunch', 'store', ['dal', 'rajma', 'chole', 'paneer'], 'Homestyle Lunch Nearby', 'Dal, rice and sabzi from {store}. {when} Open the kitchen on Sociva.', 'store'),
  f('l18', 'lunch', 'baingan', ['baingan'], 'Baingan Bharta Today', '{product} {price}. {when} Smoky, homely, nearby.', 'product'),
  f('l19', 'lunch', 'bhindi', ['bhindi'], 'Kurkuri Bhindi on the Side', '{product} {price} from {store}. {when} Add it to lunch.', 'product'),
  f('l20', 'lunch', 'pulao', ['pulao', 'matar pulao'], 'Matar Pulao for the Table', '{product} {price}. {when} A gentle lunch plate.', 'product'),
  f('l21', 'lunch', 'now', ['lunch', 'rice', 'dal'], 'Lunch Kitchens Are Open', 'Home-style meals you can order now. Come see the list on Sociva.', 'meal_collection', 'now'),
  f('l22', 'lunch', 'schedule', ['lunch', 'combo'], 'Lock Lunch Before They Cook', 'Local kitchens take lunch orders ahead. {when} Reserve on Sociva.', 'meal_collection', 'schedule'),
  f('l23', 'lunch', 'noodles', ['noodle'], 'Noodles If Dal Can Wait', '{product} {price} from {store}. {when} A different lunch nearby.', 'product'),
  f('l24', 'lunch', 'manchurian', ['manchurian'], 'Manchurian for Lunch', '{product} {price}. {when} Indo-Chinese from next door.', 'product'),
  f('l25', 'lunch', 'thukpa', ['thukpa', 'thupka'], 'A Bowl of Thukpa', '{product} {price}. {when} Warm Himalayan lunch nearby.', 'product'),

  f('e01', 'evening', 'pakoda', ['pakoda', 'pakora'], 'Chai Time Needs Pakodas', 'Crispy aloo pyaz pakodas with chutney. {when} Discover snacks on Sociva.', 'meal_collection', 'any', 'snack'),
  f('e02', 'evening', 'pakoda', ['pakoda', 'pakora'], 'Pakodas, Still Warm', '{product} {price} from {store}. {when} Evening snack nearby.', 'product', 'any', 'snack'),
  f('e03', 'evening', 'samosa', ['samosa'], 'Samosa Weather, Clearly', '{product} {price}. {when} A classic evening bite.', 'product', 'any', 'snack'),
  f('e04', 'evening', 'kachori', ['kachori'], 'Kachori With Evening Tea', '{product} {price} from {store}. {when} Small, hot, nearby.', 'product', 'any', 'snack'),
  f('e05', 'evening', 'fries', ['fries'], 'Fries, Because Why Not', '{product} {price}. {when} A quick snack on Sociva.', 'product', 'any', 'snack'),
  f('e06', 'evening', 'chops', ['aloo chop', 'chops'], 'Soft Aloo Chops Nearby', '{product} {price} from {store}. {when} Evening comfort food.', 'product', 'any', 'snack'),
  f('e07', 'evening', 'momo-snack', ['momo'], 'Momos for Evening Hunger', '{product} {price}. {when} Steamed or fried, nearby.', 'product', 'any', 'snack'),
  f('e08', 'evening', 'tea', ['tea'], 'Evening Chai is Ready', '{product} {price} from {store}. {when} Pair it with a snack.', 'product', 'any', 'snack'),
  f('e09', 'evening', 'coffee', ['coffee'], 'Coffee Before Dusk', '{product} {price}. {when} A cup from {store}.', 'product', 'any', 'snack'),
  f('e10', 'evening', 'snack', [], 'Something Crispy Nearby', 'Pakodas, samosas and cafe snacks. {when} See evening bites on Sociva.', 'meal_collection', 'any', 'snack'),
  f('e11', 'evening', 'snack', [], 'The In-Between Hunger', 'Not dinner yet. Still hungry. Neighbour snacks are on Sociva.', 'meal_collection', 'any', 'snack'),
  f('e12', 'evening', 'pickle', ['pickle'], 'A Jar for the Table', 'Homemade pickles from local sellers. {when} Taste them on Sociva.', 'store', 'any', 'snack'),
  f('e13', 'evening', 'makhana', ['makhana'], 'Makhana, Light and Crunchy', '{product} {price}. {when} An easy evening snack.', 'product', 'any', 'snack'),
  f('e14', 'evening', 'soda', ['soda', 'lemon soda'], 'Lemon Soda, Cold', '{product} {price} from {store}. {when} A sharp evening sip.', 'product', 'any', 'snack'),
  f('e15', 'evening', 'honey chilli', ['honey chilli', 'chilly potatoes', 'chilli potato'], 'Honey Chilli Potatoes', '{product} {price}. {when} A cafe snack worth sharing.', 'product', 'any', 'snack'),
  f('e16', 'evening', 'now', ['pakoda', 'samosa', 'momo'], 'Snacks Are On', 'Evening kitchens nearby are serving. Come pick a bite on Sociva.', 'meal_collection', 'now', 'snack'),
  f('e17', 'evening', 'tea-snack', ['tea', 'pakoda'], 'Chai and Something Fried', 'Tea plus pakodas from neighbours. {when} Open evening snacks.', 'meal_collection', 'any', 'snack'),
  f('e18', 'evening', 'store-snack', ['pakoda', 'samosa', 'fries'], 'Evening Menu Nearby', 'Snacks and chai from {store}. {when} See what is out.', 'store', 'any', 'snack'),
  f('e19', 'evening', 'green tea', ['green tea'], 'Lemon Honey Green Tea', '{product} {price}. {when} A lighter evening cup.', 'product', 'any', 'snack'),
  f('e20', 'evening', 'badam', ['badam milk'], 'Warm Badam Milk Later', '{product} {price} from {store}. {when} Soft landing for the evening.', 'product', 'any', 'snack'),

  f('d01', 'evening', 'momo', ['momo'], 'Momos or Thukpa Tonight?', 'Steamed momos, Himalayan thukpa and soups. Your society has options.', 'meal_collection', 'any', 'dinner'),
  f('d02', 'evening', 'momo', ['steamed momo', 'momo'], 'Steamed Momos Tonight', '{product} {price} from {store}. {when} A warm dinner-ish plate.', 'product', 'any', 'dinner'),
  f('d03', 'evening', 'fried-momo', ['fried momo', 'fried veg momo'], 'Fried Momos After Dusk', '{product} {price}. {when} Crispy, nearby, filling.', 'product', 'any', 'dinner'),
  f('d04', 'evening', 'thukpa', ['thukpa', 'thupka'], 'Thukpa, When You Want Warm', '{product} {price}. {when} Himalayan comfort on Sociva.', 'product', 'any', 'dinner'),
  f('d05', 'evening', 'soup', ['soup'], 'A Bowl of Mountain Soup', '{product} {price} from {store}. {when} Easy dinner energy.', 'product', 'any', 'dinner'),
  f('d06', 'evening', 'roll', ['roll'], 'Rolls for a Late Plate', '{product} {price}. {when} Dinner without a big production.', 'product', 'any', 'dinner'),
  f('d07', 'evening', 'noodles', ['noodle'], 'Mountain Noodles Tonight', '{product} {price} from {store}. {when} A full evening bowl.', 'product', 'any', 'dinner'),
  f('d08', 'evening', 'chinese', ['fried rice', 'manchurian', 'chilli'], 'Indo-Chinese, Close By', 'Fried rice, manchurian and chilli plates. {when} Dinner on Sociva.', 'meal_collection', 'any', 'dinner'),
  f('d09', 'evening', 'pasta', ['pasta'], 'Pasta If You Want Soft', '{product} {price}. {when} A different dinner nearby.', 'product', 'any', 'dinner'),
  f('d10', 'evening', 'dinner', [], 'What is Dinner Nearby?', 'Home plates and cafe bowls around you. {when} Browse dinner on Sociva.', 'meal_collection', 'any', 'dinner'),
  f('d11', 'evening', 'dinner', [], 'Stay In. Eat Well.', 'Neighbour kitchens are cooking tonight. Open Sociva and pick a plate.', 'meal_collection', 'any', 'dinner'),
  f('d12', 'evening', 'jhol', ['jhol momo'], 'Jhol Momos, Extra Comfort', '{product} {price} from {store}. {when} Brothy, filling, close.', 'product', 'any', 'dinner'),
  f('d13', 'evening', 'chicken', ['chicken'], 'A Non-Veg Evening Plate', '{product} {price}. {when} From a kitchen in your society.', 'product', 'any', 'dinner'),
  f('d14', 'evening', 'paneer-dinner', ['paneer'], 'Paneer for Dinner', '{product} {price} from {store}. {when} Homestyle or cafe-style.', 'product', 'any', 'dinner'),
  f('d15', 'evening', 'now', ['momo', 'thukpa', 'thupka', 'dinner'], 'Dinner Kitchens Are Open', 'Momos, soups and evening plates you can order now on Sociva.', 'meal_collection', 'now', 'dinner'),
  f('d16', 'evening', 'store-dinner', ['momo', 'thukpa', 'thupka'], 'Tonight at the Cafe', 'Himalayan bowls and momos from {store}. {when} See the menu.', 'store', 'any', 'dinner'),
  f('d17', 'evening', 'kheer', ['kheer'], 'End With Kheer, Maybe', '{product} {price}. {when} A homemade sweet after dinner.', 'product', 'any', 'dinner'),
  f('d18', 'evening', 'dal-dinner', ['dal tadka', 'dal'], 'Dal Tadka Tonight', '{product} {price} from {store}. {when} Simple dinner, done well.', 'product', 'any', 'dinner'),
  f('d19', 'evening', 'rice-dinner', ['fried rice', 'rice'], 'Rice, When You Need Easy', '{product} {price}. {when} An unfussy evening plate.', 'product', 'any', 'dinner'),
  f('d20', 'evening', 'dragon', ['dragon'], 'Dragon Plates After Five', '{product} {price} from {store}. {when} Bold cafe dinner nearby.', 'product', 'any', 'dinner'),

  f('h01', 'lunch', 'pickle', ['pickle', 'amla'], 'A Little Taste of Home', 'Homemade pickles, including amla and lemon, from local sellers on Sociva.', 'store'),
  f('h02', 'lunch', 'amla', ['amla'], 'Amla Pickle on the Side', '{product} {price} from {store}. A sharp homemade finish.', 'product'),
  f('h03', 'lunch', 'lemon-pickle', ['lemon pickle'], 'Lemon Pickle, Homemade', '{product} {price}. Keep a jar from a neighbour kitchen.', 'product'),
  f('h04', 'lunch', 'mango-pickle', ['mango pickle'], 'Mango Pickle in the House', '{product} {price} from {store}. The lunch table needs this.', 'product'),
  f('h05', 'evening', 'chilli-pickle', ['green chilli', 'chilli stuffed'], 'Green Chilli, Stuffed', '{product} {price}. Homemade heat from {store}.', 'product', 'any', 'snack'),
  f('h06', 'lunch', 'muli', ['muli', 'gajar'], 'Muli Gajar Pickle', '{product} {price} from {store}. Winter-ish, homestyle, nearby.', 'product'),
  f('h07', 'lunch', 'pickle-store', ['pickle'], 'MOM-style Pickles Nearby', 'Amla, lemon, mango and more from {store}. Open the pickle shelf.', 'store'),
  f('h08', 'evening', 'makhana-home', ['makhana'], 'Homemade Makhana Nearby', '{product} {price}. A clean snack from a local seller.', 'product', 'any', 'snack'),
  f('h09', 'lunch', 'ghee', ['ghee'], 'Desi Ghee, If You Cook', '{product} {price} from {store}. A pantry thing worth knowing.', 'product'),
  f('h10', 'breakfast', 'pickle', ['pickle'], 'Pickle With Paratha', 'Homemade pickle next to a morning paratha. {when} See both on Sociva.', 'meal_collection'),

  f('v01', 'breakfast', 'tea2', ['tea'], 'A Proper Cup Nearby', '{product} {price}. {when} Tea from {store}, no fuss.', 'product'),
  f('v02', 'evening', 'tea2', ['assam tea', 'tea'], 'Assam Tea at Dusk', '{product} {price} from {store}. {when} Evening, sorted.', 'product', 'any', 'snack'),
  f('v03', 'breakfast', 'coffee2', ['mountain coffee', 'coffee'], 'Small Coffee, Big Pause', '{product} {price}. {when} From {store}.', 'product'),
  f('v04', 'evening', 'juice2', ['watermelon', 'juice'], 'Watermelon Juice Later', '{product} {price}. {when} Cold, nearby, easy.', 'product', 'any', 'snack'),
  f('v05', 'lunch', 'juice3', ['pomegranate', 'juice'], 'Pomegranate, Fresh', '{product} {price} from {store}. A bright sip with lunch.', 'product'),
  f('v06', 'breakfast', 'apple-juice', ['apple juice'], 'Fresh Apple Juice', '{product} {price}. {when} Morning sweetness, nearby.', 'product'),
  f('v07', 'evening', 'lemon-juice', ['lemon juice'], 'Fresh Lemon Juice', '{product} {price} from {store}. {when} Sharp and cold.', 'product', 'any', 'snack'),
  f('v08', 'lunch', 'soda2', ['lemon soda'], 'Lemon Soda With Lunch', '{product} {price}. A cafe sip from {store}.', 'product'),
  f('v09', 'evening', 'green-tea2', ['green tea'], 'Green Tea, Unhurried', '{product} {price}. {when} Light evening from {store}.', 'product', 'any', 'snack'),
  f('v10', 'breakfast', 'badam2', ['badam milk'], 'Badam Milk, Warm', '{product} {price}. {when} Soft breakfast energy.', 'product'),
];

export function assertFrameLibrary(): { id: string; field: 'title' | 'body'; length: number }[] {
  const issues: { id: string; field: 'title' | 'body'; length: number }[] = [];
  const ids = new Set<string>();
  for (const frame of FOOD_DISCOVERY_FRAMES) {
    if (ids.has(frame.id)) issues.push({ id: frame.id, field: 'title', length: -1 });
    ids.add(frame.id);
    const titleLen = unicodeLen(frame.title);
    if (titleLen > TITLE_MAX || /\{[a-z]+\}/i.test(frame.title)) {
      issues.push({ id: frame.id, field: 'title', length: titleLen });
    }
    const emptyBody = collapseCopy(
      frame.body.replace(/\{product\}/g, '').replace(/\{store\}/g, '').replace(/\{price\}/g, '').replace(/\{when\}/g, ''),
    );
    if (unicodeLen(emptyBody) > BODY_MAX) issues.push({ id: frame.id, field: 'body', length: unicodeLen(emptyBody) });
  }
  return issues;
}

export function userWithinFrequencyCap(args: {
  sendsToday: number;
  sendsWeek: number;
  hoursSinceLast: number | null;
  config?: FoodDiscoveryConfig;
}): boolean {
  const config = args.config || DEFAULT_FOOD_DISCOVERY_CONFIG;
  if (args.sendsToday >= config.max_per_user_per_day) return false;
  if (args.sendsWeek >= config.max_per_user_per_week) return false;
  if (args.hoursSinceLast != null && args.hoursSinceLast < config.min_hours_between) return false;
  return true;
}
