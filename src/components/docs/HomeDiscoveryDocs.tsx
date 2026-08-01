// @ts-nocheck
import { DocHero, DocSection, DocSubSection, DocStep, DocInfoCard, DocList, DocTable } from './DocPrimitives';
import { Home } from 'lucide-react';

export function HomeDiscoveryDocs() {
  return (
    <div>
      <DocHero
        icon={Home}
        title="Home & Discovery"
        subtitle="Main dashboard, full-text search with filters, category browsing, and favorites management."
      />

      {/* ─── HomePage ─── */}
      <DocSection title="HomePage — Main Dashboard" id="home-page">
        <p>The Home page (/) is the primary entry point for authenticated, approved users. Renders inside AppLayout with bottom navigation and notification header.</p>

        <DocSubSection title="Pre-Conditions & Guards">
          <DocList items={[
            'If user is approved AND showOnboarding flag is true → shows OnboardingWalkthrough',
            'If user is NOT approved AND has profile → shows VerificationPendingScreen',
            'If profile is null (loading) → shows skeleton with animated pulse placeholders',
          ]} />
        </DocSubSection>

        <DocSubSection title="Incomplete Profile Banner">
          <p>Shown when profile exists but flat_number is empty. Displays alert icon with "Complete your profile to enable delivery orders" and an "Update" link to /profile.</p>
        </DocSubSection>

        <DocSubSection title="Page Sections (top to bottom)">
          <DocTable
            headers={['Component', 'Description', 'Data Source']}
            rows={[
              ['ReorderLastOrder', 'One-tap reorder card showing the user\'s most recent completed order with item summary, total, and "Reorder" button', 'orders table (last completed/delivered order)'],
              ['SocietyQuickLinks', 'Grid of feature quick-access cards (Visitors, Parking, Workforce, Parcels, Society Dashboard, etc.)', 'Conditional on society feature flags via useEffectiveFeatures'],
              ['MarketplaceSection', 'Main marketplace: category group chips (horizontal scroll), FeaturedBanners carousel inside it, product grids organized by parent groups, trending products', 'products, seller_profiles, parent_groups, featured_banners tables'],
              ['CommunityTeaser', 'Preview of recent bulletin posts with engagement counts to encourage community participation', 'bulletin_posts table'],
            ]}
          />
        </DocSubSection>

        <DocInfoCard variant="tip" title="Feature Gating">
          SocietyQuickLinks are dynamically rendered based on the society's enabled features. Each link checks useEffectiveFeatures for feature keys like resident_identity_verification, visitor_management, vehicle_parking, workforce_management, parcel_management, etc.
        </DocInfoCard>
      </DocSection>

      {/* ─── SearchPage ─── */}
      <DocSection title="SearchPage — Full-Text Search" id="search-page">
        <p>The /search page provides comprehensive product and seller search with advanced filtering.</p>

        <DocSubSection title="Search Header (Sticky)">
          <DocList items={[
            'Back button (circular, returns to previous page)',
            'Search input with magnifying glass icon, auto-focus on load',
            'TypewriterPlaceholder — animated placeholder text cycling through search suggestions when input is empty',
            'Clear (X) button appears when query is not empty',
          ]} />
        </DocSubSection>

        <DocSubSection title="Filter Bar (Horizontal Scroll)">
          <DocList items={[
            'SearchFilters component — expandable filter panel with price range',
            'Veg filter toggle — green border when active, filters to is_veg = true products',
            'Non-veg filter toggle — red/destructive border when active, filters to is_veg = false products',
            'Sort buttons: "Top Rated" (by rating), "Price ↑" (ascending), "Price ↓" (descending) — toggle on/off',
          ]} />
        </DocSubSection>

        <DocSubSection title="Browse Beyond Toggle">
          <DocList items={[
            '"Nearby societies" toggle with Globe icon and Switch component',
            'When enabled, search expands to nearby societies within a configurable radius',
            'Radius slider appears (1-10 km range, 1 km steps) — adjustable with drag',
            'Products from other societies show distance_km and society_name badges',
          ]} />
        </DocSubSection>

        <DocSubSection title="Category Bubbles">
          <p>Horizontal scrollable row of category icons. Each bubble shows the category emoji and name. Tapping filters results to that category. Active category has primary color background with scale animation.</p>
        </DocSubSection>

        <DocSubSection title="Filter Presets">
          <p>FilterPresets component provides quick-select options (e.g., "New Arrivals", "Best Sellers"). Active preset shows as highlighted pill.</p>
        </DocSubSection>

        <DocSubSection title="Active Filter Pills">
          <p>When filters are active, small pills appear showing current filters (e.g., "Veg", "Under ₹500", "Top Rated"). "Clear" button removes all filters.</p>
        </DocSubSection>

        <DocSubSection title="Results Display">
          <DocList items={[
            'Loading state: 6 skeleton cards in a 2-column grid',
            'Results: ProductGridByCategory — groups products by category with section headers showing category icon, name, and count',
            'Each product renders as a ProductListingCard with image, name, price, seller info, veg/non-veg badge, and action button',
            'Tapping a product opens ProductDetailSheet (bottom drawer)',
            'Empty search state: "No results" with option to enable Browse Beyond if not already active',
            'Empty marketplace state: shown when no products exist at all',
          ]} />
        </DocSubSection>
      </DocSection>

      {/* ─── CategoriesPage ─── */}
      <DocSection title="CategoriesPage — Browse All Categories" id="categories-page">
        <p>The /categories route displays all active parent groups as visual cards.</p>
        <DocList items={[
          'Each parent group card shows: icon (from parent_groups table), display name, description, color theme',
          'Cards are arranged in a responsive grid layout',
          'Tapping a card navigates to /category/:groupSlug (CategoryGroupPage)',
          'Only groups with is_active = true are displayed',
          'Groups ordered by display_order from parent_groups table',
        ]} />
      </DocSection>

      {/* ─── CategoryGroupPage ─── */}
      <DocSection title="CategoryGroupPage — Filtered View" id="category-group-page">
        <p>The /category/:category route shows all sellers and products within a specific parent group.</p>
        <DocList items={[
          'Header shows the group name and icon',
          'Sellers displayed as store cards with: business name, rating, review count, fulfillment mode, operating status',
          'Products use ListingCard component with category-specific action buttons (Add to Cart, Book, Contact, Request Quote, etc.)',
          'Action button type is determined by the product\'s action_type field (inherited from category_config)',
          'Category sub-filters available if the parent group has multiple child categories',
          'Products can be sorted by popularity, price, or rating',
        ]} />
      </DocSection>

      {/* ─── FavoritesPage ─── */}
      <DocSection title="FavoritesPage — Saved Items" id="favorites-page">
        <p>The /favorites route shows all products the user has saved/favorited.</p>
        <DocList items={[
          'Heart icon button on product cards toggles favorite status',
          'Favorites stored in the favorites table (user_id, product_id)',
          'Products displayed in a grid similar to search results',
          'Each item shows product image, name, price, seller name, and action button',
          'Tapping a product opens the ProductDetailSheet',
          'Empty state: "No favorites yet" with link to explore marketplace',
          'FavoriteButton component used across the app (search, seller store, product detail)',
        ]} />
      </DocSection>

      {/* ─── Navigation ─── */}
      <DocSection title="Navigation Architecture" id="navigation">
        <DocSubSection title="Bottom Tab Bar">
          <DocTable
            headers={['Tab', 'Route', 'Icon']}
            rows={[
              ['Home', '/', 'Home icon'],
              ['Categories', '/categories', 'Grid icon'],
              ['Community', '/community', 'Users icon'],
              ['Cart', '/cart', 'Shopping cart with item count badge'],
              ['Profile', '/profile', 'User icon'],
            ]}
          />
        </DocSubSection>

        <DocSubSection title="Header">
          <DocList items={[
            'Society name display (configurable)',
            'Notification bell icon with unread count badge — links to /notifications/inbox',
            'Search icon — links to /search',
          ]} />
        </DocSubSection>

        <DocInfoCard variant="info" title="Deep Linking">
          All 70+ routes use HashRouter for compatibility with Capacitor mobile wrapper. This enables deep linking from push notifications and external URLs.
        </DocInfoCard>
      </DocSection>
    </div>
  );
}
