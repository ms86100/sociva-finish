import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  FOOD_DISCOVERY_FRAMES,
  TITLE_MAX,
  BODY_MAX,
  assertFrameLibrary,
  destinationFor,
  eveningKindForDate,
  inferSlot,
  isDiscoverySkip,
  isExcludedSellerName,
  mergeFoodDiscoveryConfig,
  pickFoodDiscovery,
  renderDiscoveryCopy,
  storeStatusNow,
  unicodeLen,
  userWithinFrequencyCap,
  type DiscoveryProduct,
} from '@/lib/food-discovery';
import { pickNotificationRoute } from '@/lib/notification-routes';

function product(partial: Partial<DiscoveryProduct> & Pick<DiscoveryProduct, 'id' | 'name' | 'sellerId' | 'sellerName'>): DiscoveryProduct {
  return {
    price: 100,
    category: 'home_food',
    cuisineType: 'north_indian',
    tags: ['meal:lunch'],
    isAvailable: true,
    stockQuantity: null,
    storeAvailable: true,
    vacationMode: false,
    availabilityStart: '10:00:00',
    availabilityEnd: '21:00:00',
    operatingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    ...partial,
  };
}

const tadkaParatha = product({
  id: 'p-paratha',
  name: 'Aloo Paratha',
  price: 60,
  category: 'home_food',
  tags: ['meal:breakfast', 'paratha'],
  sellerId: 's-tadka',
  sellerName: 'Tadka Ghar',
});

const mountainPakoda = product({
  id: 'p-pakoda',
  name: 'Crispy Pyaz Pakodas',
  price: 99,
  category: 'cafe',
  tags: ['meal:snack', 'pakoda'],
  sellerId: 's-mountain',
  sellerName: 'Mountain High Studio Cafe',
  availabilityStart: '10:00:00',
  availabilityEnd: '22:30:00',
  operatingDays: ['Sun', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
});

const pickle = product({
  id: 'p-amla',
  name: 'Amla Pickle',
  price: 185,
  category: 'pickles',
  tags: ['pickle', 'meal:lunch'],
  sellerId: 's-pickle',
  sellerName: "MOM's HOME PICKLE",
  availabilityStart: '09:00:00',
});

const qaKitchen = product({
  id: 'p-qa',
  name: 'Rajma Chawal',
  tags: ['meal:lunch', 'rajma'],
  sellerId: 's-qa',
  sellerName: 'QA V5 Apple Kitchen',
});

describe('food discovery frames', () => {
  it('has at least 100 distinct frames with valid titles', () => {
    expect(FOOD_DISCOVERY_FRAMES.length).toBeGreaterThanOrEqual(100);
    expect(assertFrameLibrary()).toEqual([]);
    const titles = new Set(FOOD_DISCOVERY_FRAMES.map((f) => f.title));
    expect(titles.size).toBe(FOOD_DISCOVERY_FRAMES.length);
  });

  it('renders within hard limits even with a long store name', () => {
    const long = product({
      id: 'p-long',
      name: 'Dal fry + aloo Shimla mirch sabzi + chapati (2pcs) + rice',
      price: 210,
      tags: ['meal:lunch', 'thali', 'combo'],
      sellerId: 's-long',
      sellerName: 'Tadka Ghar - Homestyle North Indian Food',
    });
    const lunchFrames = FOOD_DISCOVERY_FRAMES.filter((f) => f.slot === 'lunch');
    let ok = 0;
    for (const frame of lunchFrames) {
      const copy = renderDiscoveryCopy(frame, long, 'now', '');
      if (!copy) continue;
      expect(unicodeLen(copy.title)).toBeLessThanOrEqual(TITLE_MAX);
      expect(unicodeLen(copy.body)).toBeLessThanOrEqual(BODY_MAX);
      ok += 1;
    }
    expect(ok).toBeGreaterThan(0);
  });
});

describe('food discovery selection', () => {
  it('skips when nothing is eligible', () => {
    const now = new Date('2026-10-21T05:45:00.000Z');
    const picked = pickFoodDiscovery({ slot: 'lunch', now, products: [qaKitchen], recent: [] });
    expect(isDiscoverySkip(picked) && picked.reason).toBe('no_eligible_products');
  });

  it('does not claim open-now when the store is still closed', () => {
    const now = new Date('2026-10-21T03:45:00.000Z');
    expect(storeStatusNow(tadkaParatha, now)).toBe('closed');
    const picked = pickFoodDiscovery({ slot: 'breakfast', now, products: [tadkaParatha], recent: [] });
    expect(isDiscoverySkip(picked)).toBe(false);
    if (!isDiscoverySkip(picked)) {
      expect(picked.fulfillment).toBe('schedule');
      expect(picked.body.toLowerCase()).toMatch(/opens/);
      expect(picked.destination.startsWith('/')).toBe(true);
    }
  });

  it('uses now copy after the kitchen opens', () => {
    const now = new Date('2026-10-21T04:50:00.000Z');
    expect(storeStatusNow(tadkaParatha, now)).toBe('open');
    const picked = pickFoodDiscovery({ slot: 'breakfast', now, products: [tadkaParatha], recent: [] });
    expect(isDiscoverySkip(picked)).toBe(false);
    if (!isDiscoverySkip(picked)) expect(picked.fulfillment).toBe('now');
  });

  it('skips a cafe that is closed today instead of pretending it is open later today', () => {
    const mondayMorning = new Date('2026-10-19T04:50:00.000Z');
    expect(storeStatusNow(mountainPakoda, mondayMorning)).toBe('closed_today');
    const picked = pickFoodDiscovery({
      slot: 'evening',
      now: mondayMorning,
      products: [mountainPakoda],
      recent: [],
    });
    expect(isDiscoverySkip(picked) && picked.reason).toBe('no_eligible_products');
  });

  it('rotates sellers instead of repeating the last featured kitchen', () => {
    const now = new Date('2026-10-21T05:45:00.000Z');
    const chole = product({
      id: 'p-chole',
      name: 'Combo 1 - Chole Rice',
      tags: ['meal:lunch', 'chole'],
      sellerId: 's-tadka',
      sellerName: 'Tadka Ghar',
    });
    const first = pickFoodDiscovery({
      slot: 'lunch',
      now,
      products: [chole, pickle],
      recent: [],
    });
    expect(isDiscoverySkip(first)).toBe(false);
    if (isDiscoverySkip(first)) return;
    const second = pickFoodDiscovery({
      slot: 'lunch',
      now,
      products: [chole, pickle],
      recent: [{
        istDate: '2026-10-20',
        slot: 'lunch',
        sellerId: first.sellerId,
        variantId: first.frameId,
        productId: first.productId,
      }],
    });
    expect(isDiscoverySkip(second)).toBe(false);
    if (!isDiscoverySkip(second)) expect(second.sellerId).not.toBe(first.sellerId);
  });

  it('does not advertise rajma or chole for a lunch-tagged omelette', () => {
    const now = new Date('2026-10-21T05:45:00.000Z');
    const omelette = product({
      id: 'p-omelette',
      name: 'Cafe Double Omlette',
      price: 89,
      category: 'cafe',
      tags: ['cuisine:other', 'meal:lunch', 'course:appetizer'],
      sellerId: 's-mountain',
      sellerName: 'Mountain High Studio Cafe',
    });
    const onlyOmelette = pickFoodDiscovery({ slot: 'lunch', now, products: [omelette], recent: [] });
    expect(isDiscoverySkip(onlyOmelette)).toBe(false);
    if (!isDiscoverySkip(onlyOmelette)) {
      expect(onlyOmelette.body.toLowerCase()).not.toMatch(/rajma|chole/);
      expect(onlyOmelette.productName).toBe('Cafe Double Omlette');
    }

    const chole = product({
      id: 'p-chole-rice',
      name: 'Combo 1 - Chole Rice',
      tags: ['meal:lunch', 'chole'],
      sellerId: 's-tadka',
      sellerName: 'Tadka Ghar',
    });
    const rajma = product({
      id: 'p-rajma-rice',
      name: 'Rajma with Rice',
      tags: ['meal:lunch', 'rajma'],
      sellerId: 's-tadka',
      sellerName: 'Tadka Ghar',
    });
    const mixed = pickFoodDiscovery({
      slot: 'lunch',
      now,
      products: [omelette, chole, rajma],
      recent: [],
    });
    expect(isDiscoverySkip(mixed)).toBe(false);
    if (isDiscoverySkip(mixed)) return;
    if (/rajma|chole/.test(mixed.body.toLowerCase())) {
      expect(mixed.sellerId).toBe('s-tadka');
      expect(String(mixed.productName).toLowerCase()).toMatch(/chole|rajma/);
    }
  });

  it('keeps auto-include stores inside the audience society', () => {
    const now = new Date('2026-10-21T05:45:00.000Z');
    const local = product({
      id: 'p-local-chole',
      name: 'Combo 1 - Chole Rice',
      tags: ['meal:lunch', 'chole'],
      sellerId: 's-local',
      sellerName: 'Local Kitchen',
      sellerSocietyId: '327fb699-542e-4ab6-b0b1-97022604bb88',
    });
    const far = product({
      id: 'p-far-rajma',
      name: 'Rajma with Rice',
      tags: ['meal:lunch', 'rajma'],
      sellerId: 's-far',
      sellerName: 'Far Kitchen',
      sellerSocietyId: '00000000-0000-0000-0000-000000000099',
    });
    const picked = pickFoodDiscovery({
      slot: 'lunch',
      now,
      products: [far, local],
      recent: [],
    });
    expect(isDiscoverySkip(picked)).toBe(false);
    if (!isDiscoverySkip(picked)) expect(picked.sellerId).toBe('s-local');
  });

  it('lands product frames on the product and collections on the meal list', () => {
    expect(destinationFor('product', 'lunch', tadkaParatha)).toBe('/product/p-paratha');
    expect(destinationFor('store', 'lunch', tadkaParatha)).toBe('/seller/s-tadka');
    expect(destinationFor('meal_collection', 'breakfast', tadkaParatha)).toBe(
      '/category/food_beverages?meal=breakfast',
    );
    expect(destinationFor('meal_collection', 'evening', mountainPakoda, 'snack')).toBe(
      '/category/food_beverages?meal=snack',
    );
  });
});

describe('food discovery config and caps', () => {
  it('keeps shadow as the safe default', () => {
    const cfg = mergeFoodDiscoveryConfig({});
    expect(cfg.mode).toBe('shadow');
    expect(cfg.slots.breakfast.hour).toBe(10);
    expect(cfg.slots.breakfast.minute).toBe(15);
  });

  it('infers IST slots with a grace window', () => {
    const cfg = mergeFoodDiscoveryConfig({});
    expect(inferSlot(cfg, new Date('2026-10-21T04:45:00.000Z'))).toBe('breakfast');
    expect(inferSlot(cfg, new Date('2026-10-21T05:45:00.000Z'))).toBe('lunch');
    expect(inferSlot(cfg, new Date('2026-10-21T12:00:00.000Z'))).toBe('evening');
    expect(inferSlot(cfg, new Date('2026-10-21T08:00:00.000Z'))).toBeNull();
  });

  it('caps per-user frequency', () => {
    expect(userWithinFrequencyCap({ sendsToday: 2, sendsWeek: 2, hoursSinceLast: 8 })).toBe(false);
    expect(userWithinFrequencyCap({ sendsToday: 1, sendsWeek: 2, hoursSinceLast: 2 })).toBe(false);
    expect(userWithinFrequencyCap({ sendsToday: 1, sendsWeek: 2, hoursSinceLast: 5 })).toBe(true);
  });

  it('excludes QA and hold stores by name', () => {
    expect(isExcludedSellerName('QA V5 Apple Kitchen', ['qa', '[hold]'])).toBe(true);
    expect(isExcludedSellerName('[HOLD] Sagar Homestyle Kitchen', ['qa', '[hold]'])).toBe(true);
    expect(isExcludedSellerName('Tadka Ghar', ['qa', '[hold]'])).toBe(false);
  });

  it('alternates evening snack and dinner by IST date', () => {
    expect(eveningKindForDate('2026-10-21')).toBe('snack');
    expect(eveningKindForDate('2026-10-22')).toBe('dinner');
  });
});

describe('promotion routes and pipeline isolation', () => {
  it('opens the stored food destination instead of inbox', () => {
    expect(pickNotificationRoute({
      type: 'promotion',
      reference_path: '/product/p-paratha',
      payload: { source: 'food_discovery' },
    })).toBe('/product/p-paratha');
    expect(pickNotificationRoute({
      type: 'promotion',
      payload: {},
    })).toBe('/category/food_beverages');
  });

  it('does not touch native order-alert channels in the worker', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/send-food-discovery/index.ts'),
      'utf8',
    );
    expect(src).toContain("type: FOOD_DISCOVERY_TYPE");
    expect(src).toContain('high_priority: false');
    expect(src).not.toMatch(/orders_incoming_v3|gate_bell/);
    expect(src).toContain('x-cron-secret');
    expect(src).toContain('mode === "off"');
    expect(src).toContain('dryRun || config.mode === "shadow"');
    expect(src).toContain('from("notification_queue")');
    expect(src).toContain('food_discovery_audience');
    expect(src).toContain('society_id');
  });

  it('keeps the shared engine identical to the app module', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/lib/food-discovery.ts'), 'utf8');
    const shared = readFileSync(
      resolve(process.cwd(), 'supabase/functions/_shared/food-discovery.ts'),
      'utf8',
    );
    expect(shared).toBe(app);
  });
});
