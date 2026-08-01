// @ts-nocheck
import { DocHero, DocSection, DocSubSection, DocStep, DocInfoCard, DocList, DocTable } from './DocPrimitives';
import { Store } from 'lucide-react';

export function SellerToolsDocs() {
  return (
    <div>
      <DocHero
        icon={Store}
        title="Seller Tools"
        subtitle="6-step onboarding wizard, dashboard with performance metrics, product management with AI images, earnings tracking, and comprehensive store settings."
      />

      {/* ─── BecomeSellerPage ─── */}
      <DocSection title="BecomeSellerPage — Seller Onboarding" id="become-seller">
        <p>The /become-seller route is a 6-step wizard for residents to register as sellers. Uses useSellerApplication hook for state management.</p>

        <DocStep number={1} title="Category Group Selection">
          <DocList items={[
            'Displays parent groups from parent_groups table as selectable cards',
            'Each card shows: group icon, name, and description',
            'Only active groups shown (is_active = true)',
            'Selecting a group determines the store type and available sub-categories',
            'Progress bar at top shows "Category" label with LayoutGrid icon',
          ]} />
        </DocStep>

        <DocStep number={2} title="Specialization (Sub-Category Selection)">
          <DocList items={[
            'SubCategorySelector component shows categories within the chosen parent group',
            '2-column grid of category cards with icon and display name',
            'Multi-select: seller can choose multiple categories they serve',
            'Selected categories highlighted with primary border and background',
            'Categories fetched from category_config table filtered by parent_group',
          ]} />
        </DocStep>

        <DocStep number={3} title="Store Details">
          <DocList items={[
            'Store Name input (required)',
            'Store Description textarea',
            'Phone Number input with country code prefix',
            'Cover Image upload using CroppableImageUpload component (crop and adjust)',
            'Store Logo upload (optional)',
          ]} />
        </DocStep>

        <DocStep number={4} title="Store Configuration (Settings)">
          <DocList items={[
            'Fulfillment mode selection (RadioGroup): Self Pickup Only, I Deliver, Delivery Partner, Pickup + I Deliver, Pickup + Delivery Partner',
            'Operating days: checkboxes for each day of week (Mon-Sun)',
            'Operating hours: availability start and end time inputs',
            'Delivery radius slider (if delivery mode selected)',
            'Minimum order amount input',
            'Payment methods: UPI toggle, Cash on Delivery toggle',
            'Contact phone input',
          ]} />
        </DocStep>

        <DocStep number={5} title="Add First Products">
          <DocList items={[
            'DraftProductManager component — add initial products/services',
            'Product form: name, description, price, MRP (optional), image, category (from selected categories)',
            'Helper text: "Buyers will see these once your store is approved. Start with 1-2 items."',
            'Products saved as drafts until the application is approved',
          ]} />
        </DocStep>

        <DocStep number={6} title="Review & Submit">
          <DocList items={[
            'Summary of all entered information across all steps',
            'Declaration checkbox: seller agreement/terms acceptance',
            'LicenseUpload component — for regulated categories (e.g., FSSAI for food), check if parent group has requires_license = true',
            '"Save Draft & Exit" button — saves progress without submitting',
            '"Submit for Review" button — creates seller_profiles record with verification_status: "pending"',
            'submissionComplete state shows success screen after submission',
            'Existing seller check: if user already has a seller profile, shows appropriate message',
          ]} />
        </DocStep>

        <DocInfoCard variant="warning" title="Admin Approval Required">
          New seller applications require admin approval in Admin Panel → Sellers tab. The SellerApplicationReview component shows full application details including store info, categories, products, and license documents for review.
        </DocInfoCard>
      </DocSection>

      {/* ─── SellerDashboardPage ─── */}
      <DocSection title="SellerDashboardPage — Seller Home" id="seller-dashboard">
        <p>The /seller route is the main hub for active sellers.</p>

        <DocSubSection title="Store Status Card">
          <DocList items={[
            'StoreStatusCard component shows: store name, open/closed toggle, verification status',
            'Toggle availability button — flips is_available flag, logs audit event (store_opened/store_closed)',
            'SellerSwitcher — if user has multiple seller profiles, dropdown to switch between them',
          ]} />
        </DocSubSection>

        <DocSubSection title="Visibility Checklist">
          <p>SellerVisibilityChecklist — shows requirements for store visibility (products added, phone set, hours configured, etc.).</p>
        </DocSubSection>

        <DocSubSection title="Performance Section">
          <DocList items={[
            '"How buyers see your store" card: star rating (decimal with count), avg response time (minutes), orders fulfilled count, cancellation rate percentage',
            'Badge indicators: "New Seller" (if 0 completed orders), "0% Cancellation" (if cancellation_rate is 0 and >2 orders)',
            'Preview button — links to /seller/:id to see buyer view',
            'EarningsSummary: today earnings, week earnings, total earnings',
            'DashboardStats: total orders, pending orders, today orders, completed orders',
          ]} />
        </DocSubSection>

        <DocSubSection title="Tools & Promotions Section">
          <DocList items={[
            'QuickActions component — shortcut buttons to Products, Settings, Earnings pages',
            'CouponManager component — create and manage discount coupons with: code, discount type (percentage/fixed), discount value, usage limit, per-user limit, min order amount, max discount cap, date range, show_to_buyers toggle',
          ]} />
        </DocSubSection>

        <DocSubSection title="Analytics Section">
          <DocList items={[
            'SellerAnalytics component — revenue charts, order trends, top products',
            'DemandInsights component — shows what buyers are searching for in the seller\'s society (from search_demand_log table, via get_unmet_demand function)',
          ]} />
        </DocSubSection>

        <DocSubSection title="Orders Section">
          <DocList items={[
            'OrderFilters: All, Today, Enquiries, Pending, Preparing, Ready, Completed — each with count badge',
            'Infinite scroll pagination with "Load More" button',
            'SellerOrderCard — shows buyer info, items, status, action buttons for status transitions',
            'Uses React Query (useSellerOrderStats, useSellerOrdersInfinite, useSellerOrderFilterCounts) for data fetching',
            'NewOrderAlertOverlay — real-time alert overlay for new incoming orders with dismiss/snooze actions',
          ]} />
        </DocSubSection>
      </DocSection>

      {/* ─── SellerProductsPage ─── */}
      <DocSection title="SellerProductsPage — Product Management" id="seller-products">
        <p>The /seller/products route manages the seller's product catalog.</p>

        <DocSubSection title="Product List">
          <DocList items={[
            'Grid/list view of all products with: image, name, price (MRP with discount %), category, veg/non-veg badge',
            'Status indicators: approval status (approved, pending, rejected), stock toggle',
            'SellerSwitcher for multi-profile sellers',
          ]} />
        </DocSubSection>

        <DocSubSection title="Add/Edit Product Dialog">
          <DocList items={[
            'ProductImageUpload — AI-powered image upload with category-aware suggestions. Uses product name, category name, and description for AI context',
            'Product Name input with category-specific placeholder (from category_config.name_placeholder)',
            'Description textarea with category-specific placeholder',
            'Price input with currency symbol, MRP input (auto-calculates discount %)',
            'Duration/Prep time input (conditional: shown when category has show_duration_field)',
            'Category selector (dropdown if multiple categories, static display if single)',
            'Subcategory selector (from subcategories table, optional)',
            'Veg/Non-veg toggle (shown when category has show_veg_toggle)',
            'AttributeBlockBuilder — dynamic form fields per category schema (from attribute_block_library table)',
            'Service-specific fields for service categories: scheduling, staff assignment',
            'Bestseller toggle, Recommended toggle, Urgent toggle',
            'Stock availability switch (in-stock/out-of-stock)',
          ]} />
        </DocSubSection>

        <DocSubSection title="Bulk Upload">
          <p>BulkProductUpload component allows importing multiple products at once. Upload button opens the bulk upload dialog.</p>
        </DocSubSection>

        <DocSubSection title="Product Actions">
          <DocList items={[
            'Edit button — opens dialog pre-filled with product data',
            'Delete button — opens AlertDialog confirmation before permanent deletion',
            'Toggle availability — quick switch for in/out of stock',
            'Submit for review — for products in draft/rejected status',
          ]} />
        </DocSubSection>
      </DocSection>

      {/* ─── SellerEarningsPage ─── */}
      <DocSection title="SellerEarningsPage — Revenue Tracking" id="seller-earnings">
        <p>The /seller/earnings route shows financial data for the seller.</p>
        <DocList items={[
          'Summary cards: Today earnings, This Week, This Month, All Time, Pending Payout',
          'Stats calculated from payment_records table filtered by seller_id',
          'Tabs: All / Pending / Completed / Failed — filter payment records by status',
          'Payment record list shows: order reference, amount, buyer name, date, payment status badge',
          'Payment status uses useStatusLabels hook for consistent color-coding',
          'Currency formatting via useCurrency hook (configurable per society/platform)',
        ]} />
      </DocSection>

      {/* ─── SellerSettingsPage ─── */}
      <DocSection title="SellerSettingsPage — Store Configuration" id="seller-settings">
        <p>The /seller/settings route provides comprehensive store configuration.</p>

        <DocSubSection title="Store Profile">
          <DocList items={[
            'Business Name input',
            'Description textarea',
            'Cover Image upload (CroppableImageUpload with crop/adjust)',
            'Contact Phone input',
          ]} />
        </DocSubSection>

        <DocSubSection title="Operating Hours & Schedule">
          <DocList items={[
            'Operating days: checkboxes for each day (Mon-Sun, from DAYS_OF_WEEK constant)',
            'Availability start time and end time inputs',
            'Pause/Resume shop toggle: PauseCircle/PlayCircle icon — immediately closes or opens the store',
          ]} />
        </DocSubSection>

        <DocSubSection title="Fulfillment & Delivery">
          <DocList items={[
            'Fulfillment mode: RadioGroup with 5 options (Self Pickup, I Deliver, Delivery Partner, Pickup + I Deliver, Pickup + Delivery Partner)',
            'Delivery radius slider',
            'Minimum order amount input with currency symbol',
            'Delivery fee configuration',
            'Cross-community selling toggle (sell_beyond_community)',
          ]} />
        </DocSubSection>

        <DocSubSection title="Payment Methods">
          <DocList items={[
            'UPI accepted toggle (Switch)',
            'Cash on Delivery accepted toggle (Switch)',
          ]} />
        </DocSubSection>

        <DocSubSection title="Categories">
          <p>Category checkboxes from the seller's parent group — add/remove categories the seller serves.</p>
        </DocSubSection>

        <DocSubSection title="License Upload">
          <p>LicenseUploadSection — conditionally shown when the seller's parent group has requires_license = true. Fetches group config and renders LicenseUpload component for uploading certifications (e.g., FSSAI, trade license).</p>
        </DocSubSection>

        <DocSubSection title="Save">
          <p>Save button at bottom — calls handleSave to update seller_profiles record. Shows loading spinner during save.</p>
        </DocSubSection>
      </DocSection>

      {/* ─── New Order Alerts ─── */}
      <DocSection title="Real-Time Order Alerts" id="order-alerts">
        <DocInfoCard variant="info" title="Push & In-App Notifications">
          <DocList items={[
            'NewOrderAlertOverlay component renders a full-screen overlay with order details when new orders arrive',
            'Uses useNewOrderAlert hook with real-time subscription on orders table filtered by seller_id',
            'Alert shows: buyer name, item list, total amount, order time',
            'Two actions: Dismiss (close alert) and Snooze (remind later)',
            'Push notification also sent via notification_queue table → edge function delivery',
            'Sound/vibration via haptic feedback on mobile',
          ]} />
        </DocInfoCard>
      </DocSection>
    </div>
  );
}
