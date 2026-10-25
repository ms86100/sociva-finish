import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOOK_TILE_COPY,
  buildGuidedDiscoveryHubs,
  buildGuidedDiscoveryTiles,
  filterGuidedDiscoveryListings,
  GUIDED_DISCOVERY_HEADING,
  GUIDED_DISCOVERY_HUB_PANEL,
  GUIDED_DISCOVERY_HUBS,
  guidedCollectionEta,
  guidedDiscoveryPageSubtitle,
  guidedDiscoverySeeAllHref,
  homeFoodMealHref,
  isTiffinListing,
  type GuidedDiscoveryListing,
} from '@/lib/guided-discovery';
import { isGuestBrowsePath } from '@/lib/guest-browse-routes';
import { pickDishListingPhoto } from '@/lib/chip-listing-photo';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const configs = [
  { category: 'home_food', transactionType: 'product_sale' },
  { category: 'restaurant', transactionType: 'product_sale' },
  { category: 'cafe', transactionType: 'product_sale' },
  { category: 'pickles', transactionType: 'product_sale' },
  { category: 'snacks', transactionType: 'product_sale' },
  { category: 'groceries', transactionType: 'product_sale' },
  { category: 'salon', transactionType: 'service_booking' },
  { category: 'tuition', transactionType: 'service_booking' },
  { category: 'tax_consultant', transactionType: 'enquiry' },
  { category: 'clothing', transactionType: 'enquiry' },
];

function listing(partial: GuidedDiscoveryListing): GuidedDiscoveryListing {
  return {
    action_type: 'add_to_cart',
    ...partial,
  };
}

describe('dish photos', () => {
  it('prefers a plated dish over a logo-like first photo', () => {
    expect(pickDishListingPhoto([
      { name: 'KHATMITTHI', image_url: 'https://img/logo.jpg' },
      { name: 'Kadhi Rice', image_url: 'https://img/kadhi.jpg' },
    ])).toBe('https://img/kadhi.jpg');
  });
});

describe('guided discovery hubs', () => {
  it('omits hubs with zero live listings', () => {
    const hubs = buildGuidedDiscoveryHubs([
      listing({ id: '1', name: 'Idli', category: 'home_food', tags: ['meal:breakfast'] }),
    ], { categoryConfigs: configs });
    expect(hubs.map((hub) => hub.id)).toEqual(['home_food']);
    expect(hubs.find((hub) => hub.id === 'daily_needs')).toBeUndefined();
    expect(hubs.find((hub) => hub.id === 'services')).toBeUndefined();
  });

  it('keeps Home Food, Restaurant, Pickles, Daily Needs, Book, Contact and Services when they have stock', () => {
    const hubs = buildGuidedDiscoveryHubs([
      listing({ id: '1', name: 'Thali', category: 'home_food' }),
      listing({ id: '2', name: 'Burger', category: 'restaurant' }),
      listing({ id: '3', name: 'Mango pickle', category: 'pickles' }),
      listing({ id: '4', name: 'Atta', category: 'groceries' }),
      listing({ id: '5', name: 'Haircut', category: 'salon', action_type: 'book' }),
      listing({ id: '6', name: 'Maths tuition', category: 'tuition', action_type: 'book' }),
      listing({ id: '7', name: 'Saree', category: 'clothing', action_type: 'contact_seller' }),
      listing({ id: '8', name: 'Tax filing', category: 'tax_consultant', action_type: 'request_service' }),
    ], { categoryConfigs: configs });
    expect(hubs.map((hub) => hub.id)).toEqual([
      'home_food',
      'restaurant_food',
      'pickles_homemade',
      'daily_needs',
      'services',
      'book_enquire',
      'contact_seller',
    ]);
  });

  it('does not put contact_seller listings on the Services hub', () => {
    const hubs = buildGuidedDiscoveryHubs([
      listing({ id: '7', name: 'Saree', category: 'clothing', action_type: 'contact_seller' }),
    ], { categoryConfigs: configs });
    expect(hubs.map((hub) => hub.id)).toEqual(['contact_seller']);
  });

  it('uses live listing photos, not a stock URL', () => {
    const hubs = buildGuidedDiscoveryHubs([
      listing({ id: '1', name: 'Thali', category: 'home_food', image_url: 'https://img/thali.jpg' }),
    ], { categoryConfigs: configs });
    expect(hubs[0].imageUrl).toBe('https://img/thali.jpg');
    expect(hubs[0].href).toBe('/explore/home_food');
  });
});

describe('guided discovery tiles', () => {
  it('maps Home Food breakfast to the meal facet, not breakfast_items', () => {
    expect(homeFoodMealHref('breakfast')).toContain('meal=breakfast');
    expect(homeFoodMealHref('breakfast')).toContain('sub=home_food');
    expect(homeFoodMealHref('breakfast')).not.toContain('breakfast_items');

    const tiles = buildGuidedDiscoveryTiles('home_food', [
      listing({ id: '1', name: 'Idli', category: 'home_food', tags: ['meal:breakfast'] }),
      listing({ id: '2', name: 'Thali', category: 'home_food', tags: ['meal:lunch'] }),
    ], { categoryConfigs: configs });
    const breakfast = tiles.find((tile) => tile.id === 'meal:breakfast');
    expect(breakfast?.href).toContain('meal=breakfast');
    expect(breakfast?.href).toContain('sub=home_food');
    expect(breakfast?.href).not.toContain('breakfast_items');
    expect(tiles.some((tile) => tile.id === 'tiffin')).toBe(false);
    expect(guidedDiscoveryPageSubtitle('home_food', breakfast)).toBe('Fresh homemade breakfast options');
  });

  it('uses real prep times for meal ETAs and stays empty when none exist', () => {
    const withTimes = buildGuidedDiscoveryTiles('home_food', [
      listing({ id: '1', name: 'Idli', category: 'home_food', tags: ['meal:breakfast'], prep_time_minutes: 15 }),
      listing({ id: '2', name: 'Dosa', category: 'home_food', tags: ['meal:breakfast'], prep_time_minutes: 30 }),
    ], { categoryConfigs: configs });
    expect(withTimes[0].eta).toBe('Delivers in 15-30 min');

    const fromLead = buildGuidedDiscoveryTiles('home_food', [
      listing({ id: '1', name: 'Cheese Paratha', category: 'home_food', tags: ['meal:breakfast'], lead_time_hours: 0.33 }),
      listing({ id: '2', name: 'Aloo Paratha', category: 'home_food', tags: ['meal:breakfast'], lead_time_hours: 0.67 }),
    ], { categoryConfigs: configs });
    expect(fromLead[0].eta).toBe('Delivers in 20-40 min');

    const withoutTimes = buildGuidedDiscoveryTiles('home_food', [
      listing({ id: '1', name: 'Idli', category: 'home_food', tags: ['meal:breakfast'] }),
    ], { categoryConfigs: configs });
    expect(withoutTimes[0].eta).toBeNull();
    expect(guidedCollectionEta([])).toBeNull();
  });

  it('adds a Tiffin tile only when daily_tiffin or tiffin listings exist', () => {
    const without = buildGuidedDiscoveryTiles('home_food', [
      listing({ id: '1', name: 'Idli', category: 'home_food', tags: ['meal:breakfast'] }),
    ], { categoryConfigs: configs });
    expect(without.some((tile) => tile.id === 'tiffin')).toBe(false);

    const withSlug = buildGuidedDiscoveryTiles('home_food', [
      listing({
        id: '9',
        name: 'Weekly meals',
        category: 'home_food',
        subcategory: 'daily_tiffin',
        tags: ['meal:lunch'],
      }),
    ], { categoryConfigs: configs });
    expect(withSlug.some((tile) => tile.id === 'tiffin')).toBe(true);
    expect(isTiffinListing({ name: 'Daily Tiffin', category: 'home_food' })).toBe(true);
  });

  it('builds restaurant cuisine tiles from live facets only', () => {
    const tiles = buildGuidedDiscoveryTiles('restaurant_food', [
      listing({ id: '1', name: 'Masala Dosa', category: 'restaurant', tags: ['cuisine:south_indian'] }),
      listing({ id: '2', name: 'Filter coffee', category: 'cafe', tags: ['cuisine:south_indian'] }),
    ], { categoryConfigs: configs });
    expect(tiles.map((tile) => tile.id)).toEqual(['cuisine:south_indian']);
    expect(tiles[0].href).toContain('cuisine=south_indian');
  });

  it('uses mockup labels for live Book tiles and prefers salon, beauty, tuition, fitness', () => {
    const tiles = buildGuidedDiscoveryTiles('book_enquire', [
      listing({ id: '1', name: 'Haircut', category: 'salon', action_type: 'book' }),
      listing({ id: '2', name: 'Checkup', category: 'medical_specialist', action_type: 'book' }),
      listing({ id: '3', name: 'Maths', category: 'tuition', action_type: 'book' }),
      listing({ id: '4', name: 'Facial', category: 'beauty', action_type: 'book' }),
    ], { categoryConfigs: configs });
    expect(tiles.map((tile) => tile.id)).toEqual([
      'category:salon',
      'category:beauty',
      'category:tuition',
      'category:medical_specialist',
    ]);
    expect(tiles[0].label).toBe(BOOK_TILE_COPY.salon.label);
    expect(tiles[0].subtitle).toBe(BOOK_TILE_COPY.salon.subtitle);
    expect(tiles[1].label).toBe('Beauty at Home');
    expect(tiles.some((tile) => tile.label === 'Fitness')).toBe(false);
  });

  it('filters hub listings by the selected tile', () => {
    const listings = [
      listing({ id: '1', name: 'Idli', category: 'home_food', tags: ['meal:breakfast'] }),
      listing({ id: '2', name: 'Thali', category: 'home_food', tags: ['meal:lunch'] }),
    ];
    const breakfast = filterGuidedDiscoveryListings('home_food', listings, {
      tileId: 'meal:breakfast',
      categoryConfigs: configs,
    });
    expect(breakfast.map((item) => item.id)).toEqual(['1']);
  });
});

describe('guided discovery wiring', () => {
  it('adds the rail to home without removing chips, popular rails or banners', () => {
    const home = read('src/components/home/MarketplaceSection.tsx');
    expect(home).toMatch(/<GuidedDiscoveryRail/);
    expect(home).toMatch(/buildGuidedDiscoveryHubs/);
    expect(home).toMatch(/<DiscoveryChipRail/);
    expect(home).toMatch(/<NeighborMakesBanner/);
    expect(home.indexOf('<NeighborMakesBanner')).toBeGreaterThan(home.indexOf('<DiscoveryChipRail'));
    expect(home.indexOf('<NeighborMakesBanner')).toBeLessThan(home.indexOf('<GuidedDiscoveryRail'));
    expect(home.indexOf('<GuidedDiscoveryRail')).toBeLessThan(home.indexOf('home-selling-well'));
    expect(home.indexOf('home-selling-well')).toBeLessThan(home.indexOf('<ShopByStoreDiscovery'));
    expect(home).not.toMatch(/<BuyAgainRow/);
    expect(home.indexOf('<ShopByStoreDiscovery')).toBeLessThan(home.indexOf('home-popular-rail'));
    expect(home.indexOf('home-popular-rail')).toBeLessThan(home.lastIndexOf('<FeaturedBanners'));
  });

  it('keeps the spec heading, NEW badge and tinted overlay cards on the rail', () => {
    expect(GUIDED_DISCOVERY_HEADING).toBe('What are you looking for today?');
    const rail = read('src/components/home/GuidedDiscoveryRail.tsx');
    expect(rail).toContain('GUIDED_DISCOVERY_HEADING');
    expect(rail).toContain('NEW');
    expect(rail).toContain('See all');
    expect(rail).toContain('bg-primary text-primary-foreground');
    expect(rail).toContain('GUIDED_DISCOVERY_HUB_PANEL');
    expect(rail).toContain('aspect-[4/5]');
    expect(GUIDED_DISCOVERY_HUBS.find((hub) => hub.id === 'book_enquire')?.title).toBe('Discover services near you');
    expect(GUIDED_DISCOVERY_HUBS.find((hub) => hub.id === 'contact_seller')?.title).toBe('Discover listings');
    expect(GUIDED_DISCOVERY_HUB_PANEL.home_food).toContain('bg-amber');
  });

  it('defaults the app to light theme and keeps a dark-mode toggle', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(/defaultTheme="light"/);
    expect(app).toMatch(/storageKey="sociva-theme"/);
    expect(read('index.html')).not.toMatch(/class="dark"/);
    expect(read('src/pages/ProfilePage.tsx')).toMatch(/setTheme\(checked \? 'dark' : 'light'\)/);
    expect(read('src/lib/capacitor.ts')).toMatch(/storedTheme === 'dark'/);
  });

  it('uses list rows, meal tiles, Book now and Contact seller cards on hub pages', () => {
    const page = read('src/pages/GuidedDiscoveryHubPage.tsx');
    expect(page).toContain('GuidedDiscoveryProductRow');
    expect(page).toContain('GuidedDiscoverySellerCard');
    expect(page).toContain('Browse by meal time');
    expect(page).toContain('Popular Today');
    expect(read('src/components/discovery/GuidedDiscoveryProductRow.tsx')).toContain('Book now');
    expect(read('src/components/discovery/GuidedDiscoveryProductRow.tsx')).toContain('rounded-[20px]');
    expect(read('src/components/discovery/GuidedDiscoverySellerCard.tsx')).toContain('Contact');
    expect(read('src/components/discovery/GuidedDiscoverySellerCard.tsx')).toContain('TOP RATED');
    expect(read('src/components/discovery/GuidedDiscoverySellerCard.tsx')).toContain('rounded-[20px]');
    expect(page).toContain('GuidedDiscoveryOverlayTile');
    expect(page).toContain('POPULAR SERVICES');
    expect(page).toContain('Popular services');
    expect(page).toContain('Browse listings');
    const bookContact = read('src/pages/CommerceModePage.tsx');
    expect(bookContact).toContain('Book and Enquire');
    expect(bookContact).toContain('Contact Seller');
    expect(bookContact).toContain('POPULAR SERVICES');
    expect(bookContact).toContain('Popular services');
    expect(bookContact).toContain('Browse listings');
    expect(bookContact).toContain('GuidedDiscoveryProductRow');
    expect(bookContact).toContain('GuidedDiscoverySellerCard');
    const header = read('src/components/layout/Header.tsx');
    expect(header).toMatch(/rounded-b-\[2\.5rem\]/);
    expect(header).toMatch(/bg-background/);
    expect(header).toMatch(/<SearchAutocomplete/);
    expect(header).toMatch(/data-testid="home-header-search"/);
    expect(header).not.toMatch(/home-header-shortcuts/);
    expect(header).not.toMatch(/New Sellers/);
    expect(page).toContain('NeighborMakesBanner');
    const banner = read('src/components/home/NeighborMakesBanner.tsx');
    expect(banner).toContain('Order Now');
    expect(banner).toContain('What Your Neighbor Makes, No App Can Deliver.');
    expect(banner).toContain('neighbor-banner-punch');
    expect(banner).toContain('useNeighborTypewriter');
    expect(banner).toContain('neighbor-type-cursor');
    expect(read('src/index.css')).toContain('neighbor-punch-shine');
    expect(read('src/components/home/MarketplaceSection.tsx')).toContain('NeighborMakesBanner');
    expect(read('src/pages/HomePage.tsx')).not.toMatch(/SocietyLeaderboard/);
    expect(read('src/components/home/RichSellerCard.tsx')).toMatch(/pickDishListingPhoto\(topProducts\)/);
    expect(read('src/components/home/RichSellerCard.tsx')).toMatch(/heroSources = \[productFallbackImage, coverImage, profileImage\]/);
    expect(guidedDiscoverySeeAllHref('home_food')).toContain('sub=home_food');
    expect(guidedDiscoverySeeAllHref('book_enquire')).toBe('/book');
  });

  it('registers /explore as a guest browse hub route', () => {
    expect(isGuestBrowsePath('/explore/home_food')).toBe(true);
    expect(isGuestBrowsePath('/explore/contact_seller')).toBe(true);
    const app = read('src/App.tsx');
    expect(app).toMatch(/path="\/explore\/:hubId"/);
    expect(app).toMatch(/GuidedDiscoveryHubPage/);
    expect(read('src/lib/navigation-stack.ts')).toMatch(/path\.startsWith\('\/explore'\)/);
    expect(read('src/lib/visibilityEngine.ts')).toMatch(/\/explore/);
  });
});
