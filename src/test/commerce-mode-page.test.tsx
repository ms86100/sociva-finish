import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveListingAction, modeForAction, type CategoryActionConfig } from '@/lib/commerce-mode';
import { buildProductDetailPayload } from '@/lib/product-detail-payload';
import { isGuestBrowsePath } from '@/lib/guest-browse-routes';

const state = vi.hoisted(() => ({
  market: null as any,
  configs: [] as any[],
  configsLoading: false,
  location: { lat: 13.07, lng: 77.75 } as { lat: number | null; lng: number | null } | null,
  topUpResults: [] as Array<{ data: any[] | null; error: any }>,
  topUpCalls: 0,
}));

vi.mock('@/hooks/queries/useMarketplaceData', () => ({
  useMarketplaceData: () => state.market,
}));

vi.mock('@/hooks/useCategoryBehavior', () => ({
  useCategoryConfigs: () => ({ configs: state.configs, isLoading: state.configsLoading }),
}));

vi.mock('@/integrations/supabase/client', () => {
  const builder: any = {};
  for (const m of ['from', 'select', 'eq', 'order']) builder[m] = () => builder;
  builder.range = () => {
    state.topUpCalls += 1;
    return Promise.resolve(state.topUpResults.shift() ?? { data: [], error: null });
  };
  return { supabase: builder };
});

vi.mock('@/hooks/queries/useProductFacets', () => ({
  useProductFacets: () => ({ data: {} }),
  applyProductFacetRow: (p: any) => p,
}));

vi.mock('@/contexts/BrowsingLocationContext', () => ({
  useBrowsingLocation: () => ({ browsingLocation: state.location }),
}));

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/location/PreciseLocationRequiredCard', () => ({
  PreciseLocationRequiredCard: () => <div data-testid="precise-location" />,
}));

vi.mock('@/components/home/ParentGroupTabs', () => ({
  ParentGroupTabs: ({ activeCategories, onCategoryChange }: any) => (
    <div data-testid="category-rail">
      {[...activeCategories].sort().map((c: string) => (
        <button key={c} data-testid={`chip-${c}`} onClick={() => onCategoryChange(c)}>{c}</button>
      ))}
    </div>
  ),
}));

vi.mock('@/components/discovery/CommerceFacetRail', () => ({
  CommerceFacetRail: () => <div data-testid="facet-rail" />,
}));

vi.mock('@/components/product/ProductCardSkeleton', () => ({
  ProductCardSkeleton: () => <div data-testid="skeleton" />,
}));

vi.mock('@/components/product/ProductListingCard', () => ({
  ProductListingCard: ({ product, onTap, categoryConfigs }: any) => (
    <button
      data-testid={`card-${product.id}`}
      data-action={resolveListingAction(product.action_type, product.category, categoryConfigs)}
      onClick={() => onTap(product)}
    >
      {product.name}
    </button>
  ),
}));

vi.mock('@/components/product/ProductDetailSheet', () => ({
  ProductDetailSheet: ({ product, open }: any) => (open
    ? <pre data-testid="detail-sheet">{JSON.stringify(product)}</pre>
    : null),
}));

import CommerceModePage from '@/pages/CommerceModePage';

const configs: CategoryActionConfig[] = [
  { category: 'home_food', transactionType: 'cart_purchase', behavior: { supportsCart: true, enquiryOnly: false } },
  { category: 'yoga', transactionType: 'book_slot', behavior: { supportsCart: false, enquiryOnly: false } },
  { category: 'salon', transactionType: 'service_booking', behavior: { supportsCart: false, enquiryOnly: false } },
  { category: 'plumbing', transactionType: 'request_quote', behavior: { supportsCart: false, enquiryOnly: false } },
  { category: 'tuition', transactionType: 'contact_enquiry', behavior: { supportsCart: false, enquiryOnly: true } },
];

const item = (id: string, category: string, action_type: string | null, price = 120) => ({
  id, name: `Item ${id}`, price, category, action_type, image_url: null, is_veg: true, is_available: true,
});

const seller = (id: string, items: any[]) => ({
  seller_id: id,
  business_name: `Seller ${id}`,
  rating: 4.2,
  total_reviews: 3,
  distance_km: 1.2,
  is_featured: true,
  matching_products: items,
}) as any;

const baseSellers = () => [
  seller('s1', [
    item('biryani', 'home_food', 'add_to_cart'),
    item('cake', 'home_food', null),
    item('yoga-class', 'yoga', 'book'),
    item('haircut', 'salon', null),
    item('leak-fix', 'plumbing', 'request_quote', 1),
  ]),
  seller('s2', [
    item('maths', 'tuition', 'contact_seller', 0),
    item('stale-cart', 'tuition', 'add_to_cart'),
    item('visit', 'salon', 'schedule_visit'),
    item('chai', 'home_food', 'buy_now'),
  ]),
];

function setMarket(overrides: Record<string, unknown> = {}) {
  const data = (overrides.data as any[]) ?? baseSellers();
  state.market = {
    data,
    sellers: data,
    isLoading: false,
    error: null,
    sellersReady: true,
    fetchNextSellers: vi.fn(),
    hasMoreSellers: false,
    fetchNextProducts: vi.fn(),
    hasMoreProducts: false,
    ...overrides,
  };
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/shop" element={<CommerceModePage />} />
          <Route path="/book" element={<CommerceModePage />} />
          <Route path="/services" element={<CommerceModePage />} />
          <Route path="/search" element={<div data-testid="search-page" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const renderedIds = () => screen.queryAllByTestId(/^card-/).map((el) => el.getAttribute('data-testid')!.slice(5)).sort();

beforeEach(() => {
  state.configs = configs;
  state.configsLoading = false;
  state.location = { lat: 13.07, lng: 77.75 };
  state.topUpResults = [];
  state.topUpCalls = 0;
  setMarket();
});

describe('CommerceModePage listing partitions', () => {
  it('Shop shows only cart-enabled offerings', async () => {
    renderAt('/shop');
    expect(await screen.findByTestId('commerce-mode-shop')).toBeInTheDocument();
    expect(renderedIds()).toEqual(['biryani', 'cake', 'chai']);
  });

  it('Book shows only booking-enabled offerings', async () => {
    renderAt('/book');
    await screen.findByTestId('commerce-mode-book');
    expect(renderedIds()).toEqual(['haircut', 'visit', 'yoga-class']);
  });

  it('Services shows only enquiry and contact offerings, including a stale cart action in an enquiry-only category', async () => {
    renderAt('/services');
    await screen.findByTestId('commerce-mode-services');
    expect(renderedIds()).toEqual(['leak-fix', 'maths', 'stale-cart']);
  });

  it('every rendered card resolves to the page mode', async () => {
    for (const mode of ['shop', 'book', 'services'] as const) {
      const { unmount } = renderAt(`/${mode}`);
      await screen.findByTestId(`commerce-mode-${mode}`);
      for (const card of screen.getAllByTestId(/^card-/)) {
        expect(modeForAction(card.getAttribute('data-action') as any), card.getAttribute('data-testid')!).toBe(mode);
      }
      unmount();
    }
  });

  it('classifies null action types by category fallback, not the cart default', async () => {
    renderAt('/book');
    await screen.findByTestId('commerce-mode-book');
    expect(screen.getByTestId('card-haircut').getAttribute('data-action')).toBe('book');
    renderAt('/shop');
    expect((await screen.findAllByTestId('card-cake'))[0].getAttribute('data-action')).toBe('add_to_cart');
  });

  it('scopes the category rail to categories that have listings in the mode and filters by chip', async () => {
    renderAt('/book');
    await screen.findByTestId('commerce-mode-book');
    expect(screen.getAllByTestId(/^chip-/).map((el) => el.textContent)).toEqual(['salon', 'yoga']);
    fireEvent.click(screen.getByTestId('chip-yoga'));
    expect(renderedIds()).toEqual(['yoga-class']);
  });

  it('shows the total listing count for the mode', async () => {
    renderAt('/services');
    expect(await screen.findByTestId('commerce-mode-count')).toHaveTextContent('3 listings');
  });
});

describe('CommerceModePage states', () => {
  it('shows a skeleton while marketplace data loads', async () => {
    setMarket({ isLoading: true, data: [] });
    renderAt('/shop');
    expect(await screen.findByTestId('commerce-mode-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('commerce-mode-grid')).toBeNull();
    expect(screen.queryByTestId('commerce-mode-empty')).toBeNull();
  });

  it('keeps loading and pages sellers until every seller page is in', async () => {
    const fetchNextSellers = vi.fn();
    setMarket({ hasMoreSellers: true, fetchNextSellers });
    renderAt('/book');
    expect(await screen.findByTestId('commerce-mode-loading')).toBeInTheDocument();
    expect(fetchNextSellers).toHaveBeenCalled();
  });

  it('shows a mode-specific empty state with a search exit', async () => {
    setMarket({ data: [seller('s1', [item('biryani', 'home_food', 'add_to_cart')])] });
    renderAt('/book');
    expect(await screen.findByTestId('commerce-mode-empty')).toHaveTextContent('Nothing to book nearby yet');
    fireEvent.click(screen.getByRole('button', { name: 'Search Sociva' }));
    expect(await screen.findByTestId('search-page')).toBeInTheDocument();
  });

  it('asks for a precise location instead of showing an empty list', async () => {
    state.location = null;
    setMarket({ data: [] });
    renderAt('/services');
    expect(await screen.findByTestId('precise-location')).toBeInTheDocument();
    expect(screen.queryByTestId('commerce-mode-empty')).toBeNull();
  });

  it('tops up a seller capped at 60 listings so none are silently omitted', async () => {
    const capped = Array.from({ length: 60 }, (_, i) => item(`slot-${i}`, 'yoga', 'book'));
    setMarket({ data: [seller('big', capped)] });
    state.topUpResults = [{
      data: [...capped, item('slot-60', 'yoga', 'book'), item('slot-61', 'yoga', 'book')].map((p) => ({ ...p, seller_id: 'big' })),
      error: null,
    }];
    renderAt('/book');
    expect(await screen.findByTestId('commerce-mode-count')).toHaveTextContent('62 listings');
    expect(screen.getByTestId('card-slot-61')).toBeInTheDocument();
  });

  it('shows a real error with retry when the top-up fails, keeping the listings it has', async () => {
    const capped = Array.from({ length: 60 }, (_, i) => item(`slot-${i}`, 'yoga', 'book'));
    setMarket({ data: [seller('big', capped)] });
    state.topUpResults = [
      { data: null, error: { message: 'statement timeout' } },
      { data: [item('slot-60', 'yoga', 'book')].map((p) => ({ ...p, seller_id: 'big' })), error: null },
    ];
    renderAt('/book');
    expect(await screen.findByTestId('commerce-mode-error')).toHaveTextContent('Some listings could not load');
    expect(screen.getAllByTestId(/^card-/)).toHaveLength(60);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    await waitFor(() => expect(screen.queryByTestId('commerce-mode-error')).toBeNull());
    expect(screen.getByTestId('card-slot-60')).toBeInTheDocument();
    expect(state.topUpCalls).toBe(2);
  });
});

describe('CommerceModePage detail sheet', () => {
  it('opens the shared ProductDetailSheet with the same payload Home builds', async () => {
    renderAt('/services');
    fireEvent.click(await screen.findByTestId('card-maths'));
    const payload = JSON.parse((await screen.findByTestId('detail-sheet')).textContent!);
    const tapped = state.market.data[1].matching_products[0];
    const { mapProduct } = await import('@/hooks/queries/useNearbyProducts');
    const expected = JSON.parse(JSON.stringify(buildProductDetailPayload(mapProduct(tapped, state.market.data[1]), configs as any)));
    expect(payload).toEqual(expected);
    expect(payload.action_type).toBe('contact_seller');
    expect(payload.seller_name).toBe('Seller s2');
  });
});

describe('CommerceModePage guest access', () => {
  it('mode routes are public browse routes inside the app shell gate', () => {
    for (const path of ['/shop', '/book', '/services']) {
      expect(isGuestBrowsePath(path), path).toBe(true);
    }
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const gateStart = app.indexOf('<Route element={<AppShellGate />}>');
    const gateEnd = app.indexOf('</Route>', gateStart);
    const gate = app.slice(gateStart, gateEnd);
    for (const path of ['/shop', '/book', '/services']) {
      expect(gate, path).toMatch(new RegExp(`path="${path}" element={<RouteErrorBoundary[^>]*><CommerceModePage />`));
    }
    expect(app).not.toMatch(/path="\/(shop|book|services)"[^\n]*ProtectedRoute/);
  });
});
