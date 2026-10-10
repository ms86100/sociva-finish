import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COMMERCE_MODE_TILES_HEIGHT_PX,
  CommerceModeTiles,
  countListingsByMode,
} from '@/components/home/CommerceModeTiles';

const society = vi.hoisted(() => ({ visible: false }));

vi.mock('@/hooks/useSocietyEntryVisible', () => ({
  useSocietyEntryVisible: () => society.visible,
}));

const read = (p: string) => readFileSync(resolve(process.cwd(), 'src', p), 'utf8');

function renderTiles(counts = { shop: 12, book: 4, services: 0 }) {
  return render(
    <MemoryRouter>
      <CommerceModeTiles counts={counts} />
    </MemoryRouter>,
  );
}

describe('commerce mode tiles', () => {
  beforeEach(() => {
    society.visible = false;
  });

  it('counts listings with the shared resolver and treats a missing action by category', () => {
    const configs = [
      { category: 'tuition', transactionType: 'service_booking' },
    ];
    expect(countListingsByMode([
      { action_type: 'add_to_cart', category: 'home_food' },
      { action_type: 'buy_now', category: 'groceries' },
      { action_type: 'book', category: 'medical_specialist' },
      { action_type: null, category: 'tuition' },
      { action_type: 'contact_seller', category: 'salon' },
    ], configs)).toEqual({ shop: 2, book: 2, services: 1 });
  });

  it('keeps the bento short enough to leave room for a product row', () => {
    expect(COMMERCE_MODE_TILES_HEIGHT_PX).toBeLessThanOrEqual(168);
  });

  it('links Shop, Book and Services, and hides a zero count', () => {
    renderTiles();
    expect(screen.getByTestId('commerce-mode-tile-shop')).toHaveAttribute('href', '/shop');
    expect(screen.getByTestId('commerce-mode-tile-book')).toHaveAttribute('href', '/book');
    expect(screen.getByTestId('commerce-mode-tile-services')).toHaveAttribute('href', '/services');
    expect(screen.getByTestId('commerce-mode-tile-count-shop')).toHaveTextContent('12');
    expect(screen.getByTestId('commerce-mode-tile-count-book')).toHaveTextContent('4');
    expect(screen.queryByTestId('commerce-mode-tile-count-services')).toBeNull();
    expect(screen.queryByTestId('commerce-mode-tile-society')).toBeNull();
    expect(screen.getByTestId('commerce-mode-tiles')).toHaveStyle({ height: '152px' });
  });

  it('adds a Society tile only when the shared visibility rule says so', () => {
    society.visible = true;
    renderTiles({ shop: 0, book: 0, services: 0 });
    expect(screen.getByTestId('commerce-mode-tile-society')).toHaveAttribute('href', '/society');
    expect(screen.queryByTestId('commerce-mode-tile-count-shop')).toBeNull();
  });

  it('places tiles, then the product rail, then category grids, then banners', () => {
    const home = read('components/home/MarketplaceSection.tsx');
    const populated = home.slice(home.lastIndexOf('return ('));
    expect(populated.indexOf('<CommerceModeTiles')).toBeGreaterThan(-1);
    expect(populated.indexOf('<CommerceModeTiles')).toBeLessThan(populated.indexOf('<ParentGroupTabs'));
    expect(populated.indexOf('home-popular-rail')).toBeLessThan(populated.indexOf('<CategoryImageGrid'));
    expect(populated.indexOf('<CategoryImageGrid')).toBeLessThan(populated.indexOf('<FeaturedBanners'));
    expect(home).toMatch(/label_empty_marketplace_title/);
    expect(home).toMatch(/Home-cooked meals/);
    expect(home).toMatch(/bg-mode-shop\/15/);
    expect(home).not.toMatch(/SocietyQuickLinks/);
    expect(home).not.toMatch(/\/search\?q=/);
    expect(read('pages/HomePage.tsx')).toMatch(/stack-gap/);
    expect(read('pages/HomePage.tsx')).toMatch(/ActiveOrderStrip/);
    expect(read('pages/HomePage.tsx')).toMatch(/PreciseLocationRequiredCard/);
    expect(read('pages/HomePage.tsx')).toMatch(/SellerJourneyBanner/);
  });

  it('frames campaign banners at about 2.4:1', () => {
    const banners = read('components/home/FeaturedBanners.tsx');
    expect(banners).toMatch(/aspect-\[2\.4\/1\]/);
    expect(banners).not.toMatch(/h-36/);
  });
});
