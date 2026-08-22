import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('festival marketplace experience', () => {
  it('inverts participation to auto-eligible with opt-out', () => {
    const sql = read('supabase/migrations/20260822111953_festival_marketplace_eligibility.sql');
    expect(sql).toMatch(/festival_product_exclusions/);
    expect(sql).toMatch(/opted_in = false/);
    expect(sql).toMatch(/festival_product_matches_rule/);
    expect(sql).toMatch(/preview_festival_section_inventory/);
    expect(sql).toMatch(/festival_seller_matches/);
    expect(sql).toMatch(/notify_eligible_sellers_festival_published/);
    expect(sql).toMatch(/plainto_tsquery/);
    expect(sql).not.toMatch(/EXISTS \(\s*SELECT 1 FROM public\.festival_seller_participation fsp\s*WHERE fsp\.banner_id = p_banner_id AND fsp\.seller_id = sp\.id AND fsp\.opted_in = true/);
  });

  it('home festival is a destination with product rails, not Coming soon chips', () => {
    const moduleSrc = read('src/components/home/FestivalBannerModule.tsx');
    const homeSrc = read('src/components/home/MarketplaceSection.tsx');
    const tabsSrc = read('src/components/home/ParentGroupTabs.tsx');
    expect(moduleSrc).toMatch(/ProductCarousel/);
    expect(moduleSrc).toMatch(/GroupedSellerRow/);
    expect(moduleSrc).toMatch(/From sellers in your community/);
    expect(moduleSrc).toMatch(/FestivalStringLights/);
    expect(moduleSrc).toMatch(/festival-merch-card/);
    expect(moduleSrc).toMatch(/festival-offer-strip/);
    expect(moduleSrc).toMatch(/tone="festival"/);
    expect(moduleSrc).not.toMatch(/Coming soon/);
    expect(homeSrc).toMatch(/FestivalBannerModule/);
    expect(homeSrc).toMatch(/FESTIVAL_TAB_VALUE/);
    expect(tabsSrc).toMatch(/festivalTabs/);
    expect(tabsSrc).toMatch(/useFestivalTakeover/);
  });

  it('header and rails pick up festival takeover chrome', () => {
    const headerSrc = read('src/components/layout/Header.tsx');
    const carouselSrc = read('src/components/product/ProductCarousel.tsx');
    const hookSrc = read('src/hooks/queries/useActiveFestivals.ts');
    expect(headerSrc).toMatch(/useFestivalTakeover/);
    expect(headerSrc).toMatch(/festival-takeover-search/);
    expect(carouselSrc).toMatch(/tone === 'festival'/);
    expect(hookSrc).toMatch(/export function useFestivalTakeover/);
    expect(hookSrc).toMatch(/hasInventory/);
    expect(hookSrc).toMatch(/resolveBannerSections/);
  });

  it('festival collection reuses ProductListingCard', () => {
    const src = read('src/pages/FestivalCollectionPage.tsx');
    expect(src).toMatch(/ProductListingCard/);
    expect(src).toMatch(/toProductWithSeller/);
    expect(src).toMatch(/FestivalStringLights/);
    expect(src).toMatch(/font-serif/);
  });

  it('sellers default in and can exclude products from the dashboard', () => {
    const seller = read('src/components/seller/SellerFestivalParticipation.tsx');
    const dash = read('src/pages/SellerDashboardPage.tsx');
    expect(seller).toMatch(/participation \? participation\.opted_in : true/);
    expect(seller).toMatch(/festival_product_exclusions/);
    expect(seller).toMatch(/festival_seller_matches/);
    expect(dash).toMatch(/SellerFestivalParticipation/);
  });

  it('admin preview shows inventory counts and does not block empty inventory', () => {
    const admin = read('src/components/admin/AdminBannerManager.tsx');
    expect(admin).toMatch(/preview_festival_section_inventory/);
    expect(admin).toMatch(/Every section needs a category or keyword mapping/);
    expect(admin).toMatch(/stay hidden until/);
    expect(admin).toMatch(/notify_eligible_sellers_festival_published/);
    expect(admin).toMatch(/FestivalStringLights/);
    expect(admin).toMatch(/festival-merch-card/);
    expect(admin).toMatch(/festival-offer-strip/);
  });
});
