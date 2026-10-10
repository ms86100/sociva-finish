import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COMMERCE_MODE_TILES_HEIGHT_PX,
  CommerceModeTiles,
  countListingsByMode,
  modeCountsAreComplete,
} from '@/components/home/CommerceModeTiles';

const society = vi.hoisted(() => ({ visible: false }));

vi.mock('@/hooks/useSocietyEntryVisible', () => ({
  useSocietyEntryVisible: () => society.visible,
}));

const read = (p: string) => readFileSync(resolve(process.cwd(), 'src', p), 'utf8');

function renderTiles(
  counts = { shop: 12, book: 4, services: 0 },
  complete = { shop: true, book: true, services: true },
) {
  return render(
    <MemoryRouter>
      <CommerceModeTiles counts={counts} complete={complete} />
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

  it('hides a mode count when a seller in that mode hit the page cap', () => {
    const cappedBook = Array.from({ length: 60 }, () => ({ action_type: 'book', category: 'medical_specialist' }));
    expect(modeCountsAreComplete([
      { matching_products: cappedBook },
      { matching_products: [{ action_type: 'add_to_cart', category: 'home_food' }, { action_type: 'contact_seller', category: 'salon' }] },
    ])).toEqual({ shop: true, book: false, services: true });
    expect(modeCountsAreComplete([
      { matching_products: [{ action_type: 'book', category: 'medical_specialist' }] },
    ]).book).toBe(true);
  });

  it('does not render an incomplete count as if it were the mode total', () => {
    renderTiles({ shop: 123, book: 84, services: 20 }, { shop: true, book: false, services: true });
    expect(screen.getByTestId('commerce-mode-tile-count-shop')).toHaveTextContent('123');
    expect(screen.getByTestId('commerce-mode-tile-count-services')).toHaveTextContent('20');
    expect(screen.queryByTestId('commerce-mode-tile-count-book')).toBeNull();
    expect(screen.getByTestId('commerce-mode-tile-shop').className).toMatch(/bg-card/);
    expect(screen.getByTestId('commerce-mode-tile-book').className).not.toMatch(/bg-mode-book(?!-)/);
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

  it('keeps mode tiles off Home and limits Home to add-to-cart listings', () => {
    const home = read('components/home/MarketplaceSection.tsx');
    const populated = home.slice(home.lastIndexOf('return ('));
    expect(home).not.toMatch(/CommerceModeTiles/);
    expect(home).toMatch(/filterByMode\(group\.products, 'shop', categoryConfigs\)/);
    expect(populated.indexOf('home-popular-rail')).toBeLessThan(populated.indexOf('<FeaturedBanners'));
    expect(populated.indexOf('<FeaturedBanners')).toBeLessThan(populated.indexOf('<CategoryImageGrid'));
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
