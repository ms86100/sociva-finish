import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOOK_TILE_COPY,
  buildGuidedDiscoveryHubs,
  buildGuidedDiscoveryTiles,
  buildGuidedListingSnapshot,
  filterGuidedDiscoveryListings,
  GUIDED_DISCOVERY_HEADING,
  GUIDED_DISCOVERY_HUB_PANEL,
  GUIDED_DISCOVERY_HUBS,
  guidedCollectionEta,
  guidedDiscoveryPageSubtitle,
  guidedDiscoverySeeAllHref,
  guidedListingHeadline,
  guidedListingSubline,
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
    expect(guidedDiscoveryPageSubtitle('home_food', breakfast)).toBe(
      breakfast?.eta || (breakfast && breakfast.count > 0
        ? (breakfast.count === 1 ? '1 dish nearby' : `${breakfast.count} dishes nearby`)
        : breakfast?.subtitle),
    );
  });

  it('builds listing snapshot from live dishes only', () => {
    const snapshot = buildGuidedListingSnapshot([
      {
        id: '1',
        name: 'Dal',
        price: 120,
        seller_id: 's1',
        seller_name: 'A Kitchen',
        seller_is_available: true,
        prep_time_minutes: 30,
        completed_order_count: 4,
        image_url: 'https://img/dal.jpg',
      },
      {
        id: '2',
        name: 'Rice',
        price: 80,
        seller_id: 's2',
        seller_name: 'B Kitchen',
        seller_is_available: false,
        prep_time_minutes: 20,
        completed_order_count: 1,
        image_url: 'https://img/rice.jpg',
      },
    ]);
    expect(snapshot.dishCount).toBe(2);
    expect(snapshot.kitchenCount).toBe(2);
    expect(snapshot.openKitchenCount).toBe(1);
    expect(snapshot.priceFrom).toBe(80);
    expect(snapshot.priceTo).toBe(120);
    expect(snapshot.fastestPrepMinutes).toBe(20);
    expect(snapshot.prepLabel).toBe('from 20 min');
    expect(snapshot.totalOrders).toBe(5);
    expect(guidedListingHeadline(snapshot)).toBe('2 dishes · 2 kitchens');
    expect(guidedListingSubline(snapshot, { cuisineLabel: 'North Indian' })).toContain('North Indian');
    expect(guidedListingSubline(snapshot)).toContain('1 open now');
    expect(buildGuidedListingSnapshot([]).dishCount).toBe(0);
    expect(buildGuidedListingSnapshot([{ id: 'x', seller_is_available: null }]).openKitchenCount).toBe(0);
  });

  it('shows kitchen counts on meal tiles instead of wild prep ranges', () => {
    const withKitchens = buildGuidedDiscoveryTiles('home_food', [
      listing({
        id: '1',
        name: 'Idli',
        category: 'home_food',
        tags: ['meal:breakfast'],
        seller_id: 's1',
        prep_time_minutes: 15,
      }),
      listing({
        id: '2',
        name: 'Dosa',
        category: 'home_food',
        tags: ['meal:breakfast'],
        seller_id: 's2',
        prep_time_minutes: 360,
      }),
    ], { categoryConfigs: configs });
    expect(withKitchens[0].eta).toBe('2 kitchens');
    expect(withKitchens[0].eta).not.toMatch(/360/);
    expect(withKitchens[0].imageUrl).toContain('unsplash.com');

    const oneKitchen = buildGuidedDiscoveryTiles('home_food', [
      listing({ id: '1', name: 'Idli', category: 'home_food', tags: ['meal:breakfast'], seller_id: 's1' }),
      listing({ id: '2', name: 'Dosa', category: 'home_food', tags: ['meal:breakfast'], seller_id: 's1' }),
    ], { categoryConfigs: configs });
    expect(oneKitchen[0].eta).toBe('1 kitchen');
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
    expect(home).toMatch(/<CookingNearbyRail/);
    expect(home).toMatch(/buildCookingNearbyKitchens/);
    expect(home.indexOf('<DiscoveryChipRail')).toBeLessThan(home.indexOf('<CommerceFacetRail'));
    expect(home.indexOf('<CommerceFacetRail')).toBeLessThan(home.indexOf('<NeighborMakesBanner'));
    expect(home.indexOf('<NeighborMakesBanner')).toBeLessThan(home.indexOf('<GuidedDiscoveryRail'));
    expect(home.indexOf('<GuidedDiscoveryRail')).toBeLessThan(home.indexOf('home-selling-well'));
    expect(home.indexOf('home-selling-well')).toBeLessThan(home.indexOf('<CookingNearbyRail'));
    expect(home.indexOf('home-selling-well')).toBeLessThan(home.indexOf('<ShopByStoreDiscovery'));
    expect(home).toMatch(/variant="selling-well"/);
    expect(home).toMatch(/SellingWellProductCard|variant="selling-well"/);
    expect(home).not.toMatch(/<BuyAgainRow/);
    expect(home.indexOf('<ShopByStoreDiscovery')).toBeLessThan(home.indexOf('home-popular-rail'));
    expect(home.indexOf('home-popular-rail')).toBeLessThan(home.lastIndexOf('<FeaturedBanners'));
  });

  it('keeps the NEW What are you looking for today heading and mockup white-on-photo cards', () => {
    expect(GUIDED_DISCOVERY_HEADING).toBe('What are you looking for today?');
    const rail = read('src/components/home/GuidedDiscoveryRail.tsx');
    expect(rail).toContain('GUIDED_DISCOVERY_HEADING');
    expect(rail).toContain('NEW');
    expect(rail).toContain('See all');
    expect(rail).toContain('bg-primary text-primary-foreground');
    expect(rail).not.toContain('GUIDED_DISCOVERY_HUB_PANEL');
    expect(rail).toContain('grid grid-cols-2');
    expect(rail).toContain('aspect-[4/5]');
    expect(rail).toContain('text-white');
    expect(rail).toContain('from-black/85');
    expect(rail).toContain('home_food');
    expect(rail).toContain('restaurant_food');
    expect(GUIDED_DISCOVERY_HUBS.find((hub) => hub.id === 'book_enquire')?.title).toBe('Discover services near you');
    expect(GUIDED_DISCOVERY_HUBS.find((hub) => hub.id === 'contact_seller')?.title).toBe('Discover listings');
    expect(GUIDED_DISCOVERY_HUB_PANEL.home_food).toContain('bg-amber');
    expect(read('src/components/home/SellingWellProductCard.tsx')).toContain('Serves');
    expect(read('src/components/home/SellingWellProductCard.tsx')).toContain('Pickup + drop');
    expect(read('src/components/home/SellingWellProductCard.tsx')).not.toContain('% OFF');
  });

  it('defaults the app to light theme and keeps a dark-mode toggle', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(/defaultTheme="light"/);
    expect(app).toMatch(/storageKey="sociva-theme"/);
    expect(read('index.html')).not.toMatch(/class="dark"/);
    expect(read('src/pages/ProfilePage.tsx')).toMatch(/setTheme\(checked \? 'dark' : 'light'\)/);
    expect(read('src/lib/capacitor.ts')).toMatch(/storedTheme === 'dark'/);
    const css = read('src/index.css');
    const darkBlock = css.slice(css.indexOf('.dark {'), css.indexOf('--mode-shop:', css.indexOf('.dark {')));
    expect(darkBlock).toMatch(/--border:\s*220 10% 28%/);
    expect(darkBlock).toMatch(/--muted-foreground:\s*220 8% 72%/);
    expect(darkBlock).toMatch(/--card:\s*220 10% 13%/);
    expect(read('src/components/discovery/CommerceFacetRail.tsx')).toMatch(/dark:border-white\/18/);
    expect(read('src/components/layout/BottomNav.tsx')).toMatch(/dark:border-white\/15/);
  });

  it('uses list rows, meal tiles, Book now and Contact seller cards on hub pages', () => {
    const page = read('src/pages/GuidedDiscoveryHubPage.tsx');
    expect(page).toContain('GuidedDiscoveryProductRow');
    expect(page).toContain('GuidedDiscoverySellerCard');
    expect(page).toContain('GUIDED_DISCOVERY_AISLE_HEADING');
    expect(page).toContain('GUIDED_DISCOVERY_SHELF_HEADING');
    expect(page).toContain('Browse by cuisine');
    expect(page).toContain('RESTAURANT_FOOD_HERO_ART');
    expect(read('src/components/discovery/GuidedDiscoveryProductRow.tsx')).toContain('Book now');
    expect(read('src/components/discovery/GuidedDiscoveryProductRow.tsx')).toContain('rounded-[20px]');
    expect(read('src/components/discovery/GuidedDiscoveryProductRow.tsx')).toContain('listingTrustLabel');
    expect(read('src/components/discovery/GuidedDiscoveryProductRow.tsx')).toContain('food-listing-card');
    expect(page).toContain('guided-listing-result-meta');
    expect(page).toContain('guided-listing-page');
    expect(page).toContain('buildGuidedListingSnapshot');
    expect(page).toContain('guided-listing-hero');
    expect(page).not.toContain('Fresh homemade');
    expect(page).not.toContain('Tap a dish to see');
    expect(read('src/components/discovery/GuidedDiscoverySellerCard.tsx')).toContain('Contact');
    expect(read('src/components/discovery/GuidedDiscoverySellerCard.tsx')).toContain('TOP RATED');
    expect(read('src/components/discovery/GuidedDiscoverySellerCard.tsx')).toContain('rounded-[20px]');
    expect(read('src/components/discovery/GuidedDiscoverySellerCard.tsx')).toContain('sellerAvatarCandidates');
    expect(read('src/components/discovery/GuidedDiscoverySellerCard.tsx')).toContain('seller_cover_image_url');
    expect(page).toContain('GuidedDiscoveryOverlayTile');
    expect(page).toContain('POPULAR SERVICES');
    expect(page).toContain('Popular services');
    expect(page).toContain('Browse listings');
    expect(page).toContain('guided-aisle-heading');
    expect(page).toContain('text-zinc-900');
    const bookContact = read('src/pages/CommerceModePage.tsx');
    expect(bookContact).toContain('Book and Enquire');
    expect(bookContact).toContain('Contact Seller');
    expect(bookContact).toContain('POPULAR SERVICES');
    expect(bookContact).toContain('Book a slot');
    expect(bookContact).toContain('Browse neighbors');
    expect(bookContact).toContain('contact-seller-page');
    expect(bookContact).toContain('book-enquire-page');
    expect(bookContact).toContain('NEIGHBORS NEARBY');
    expect(bookContact).toContain('BOOK NEARBY');
    expect(bookContact).toContain('book-hero-punch');
    expect(bookContact).toContain('cinematic');
    expect(bookContact).toContain('Browse by need');
    expect(bookContact).toContain('Pros to book');
    expect(bookContact).toContain('ContactNeighborsRail');
    expect(bookContact).toContain('contact-search-hints');
    expect(bookContact).toContain('book-search-hints');
    expect(bookContact).toContain('buildGuidedDiscoveryTiles');
    expect(bookContact).toContain('contact_seller');
    expect(bookContact).toContain('GuidedDiscoveryProductRow');
    expect(bookContact).toContain('GuidedDiscoverySellerCard');
    expect(read('src/components/discovery/ContactNeighborsRail.tsx')).toContain('Neighbors to message');
    expect(read('src/components/discovery/GuidedDiscoverySellerCard.tsx')).toContain('contact-seller-');
    expect(read('src/components/discovery/GuidedDiscoveryProductRow.tsx')).toContain('book-listing-');
    expect(read('src/components/discovery/GuidedDiscoveryOverlayTile.tsx')).toContain('book-tile-sheen');
    const header = read('src/components/layout/Header.tsx');
    expect(header).toMatch(/rounded-b-\[2\.5rem\]/);
    expect(header).toMatch(/bg-background/);
    expect(header).toMatch(/<SearchAutocomplete/);
    expect(header).toMatch(/data-testid="home-header-search"/);
    expect(header).not.toMatch(/home-header-shortcuts/);
    expect(header).not.toMatch(/New Sellers/);
    expect(page).toContain('GuidedRoomHero');
    expect(page).toContain('HOME_FOOD_HERO_ART');
    expect(page).toContain('CookingNearbyRail');
    expect(page).toContain('GuidedRoomSwipeRail');
    expect(page).toContain('Keep exploring');
    expect(read('src/components/discovery/GuidedRoomHero.tsx')).toContain('Order Now');
    expect(read('src/components/home/MarketplaceSection.tsx')).toContain('NeighborMakesBanner');
    const aisleTile = read('src/components/discovery/GuidedDiscoveryOverlayTile.tsx');
    expect(aisleTile).toContain('aspect-[4/5]');
    expect(aisleTile).toContain('w-[7.25rem]');
    expect(aisleTile).toContain('curatedMealArt');
    expect(aisleTile).toContain('curatedCuisineArt');
    expect(aisleTile).toContain('rounded-[20px]');

    const banner = read('src/components/home/NeighborMakesBanner.tsx');
    expect(banner).toContain('Order Now');
    expect(banner).toContain('What Your Neighbor Makes,');
    expect(banner).toContain('No App Can Deliver.');
    expect(banner).toContain('sociva-neighbor-hero');
    expect(banner).toContain('aspect-[2/1]');
    expect(banner).toContain('useNeighborTypewriter');
    expect(banner).toContain('neighbor-type-cursor');
    expect(banner).toContain('neighbor-banner-punch');
    expect(read('src/index.css')).toContain('neighbor-punch-shine');
    expect(read('src/components/home/MarketplaceSection.tsx')).toContain('NeighborMakesBanner');
    expect(read('src/components/search/TypewriterPlaceholder.tsx')).toContain(
      'Search neighbors, kitchens, dishes',
    );
    expect(read('src/components/home/SellingWellProductCard.tsx')).toContain('h-full');
    expect(read('src/components/home/SellingWellProductCard.tsx')).toContain('min-h-[2.5rem]');
    expect(read('src/components/home/CookingNearbyRail.tsx')).toContain('bg-emerald-500');
    expect(read('src/components/home/CookingNearbyRail.tsx')).toContain('pt-1.5');
    expect(read('src/components/home/CookingNearbyRail.tsx')).toContain('cooking-nearby-open-pulse');
    expect(read('src/index.css')).toContain('guided-room-ken-burns');
    expect(read('src/pages/GuidedDiscoveryHubPage.tsx')).toContain('variant="room"');
    expect(read('src/pages/GuidedDiscoveryHubPage.tsx')).toContain('tone="warm"');

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
