// @ts-nocheck
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, CheckCircle, AlertTriangle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="flex items-center gap-1.5 group cursor-pointer mb-2">
        <ChevronDown size={14} className="text-muted-foreground group-data-[state=closed]:rotate-[-90deg] transition-transform" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-5 pb-4 text-sm text-muted-foreground leading-relaxed space-y-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function TH({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-3 py-2 font-semibold">{children}</th>;
}
function TD({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2', className)}>{children}</td>;
}
function Code({ children }: { children: React.ReactNode }) {
  return <code className="text-[10px] bg-muted px-1 rounded font-mono">{children}</code>;
}

export function CategoryManagementDocs() {
  return (
    <div className="space-y-2">
      {/* Intro */}
      <div className="bg-gradient-to-br from-purple-500/10 to-primary/10 rounded-2xl p-5 mb-4">
        <h2 className="text-lg font-bold text-foreground mb-1">Category Management System</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Complete reference guide for the Admin → Category Management system. Covers the three-level taxonomy,
          transaction types, attribute blocks, behavior flags, and how configurations flow through to sellers and buyers.
        </p>
        <p className="text-[10px] text-muted-foreground/70 mt-2">Last updated: March 2026 · v1.0</p>
      </div>

      {/* 1. System Overview */}
      <Sub title="1. System Overview">
        <p>The Category Management system is the <strong>central configuration hub</strong> that controls how products and services are listed, displayed, and transacted on the platform.</p>
        <p>Every listing's UI/UX — from the seller's product creation form to the buyer's action button — is driven by the category configuration.</p>
        <p><strong>Admin Interface Location:</strong> Admin Panel → Catalog Manager (<Code>AdminCatalogManager</Code>)</p>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
            <thead><tr className="bg-muted/50"><TH>Tab</TH><TH>Purpose</TH></tr></thead>
            <tbody className="divide-y divide-border">
              <tr><TD>Overview</TD><TD>Read-only view of all categories with linked attribute blocks</TD></tr>
              <tr><TD>Categories</TD><TD>Full CRUD for Sections, Categories, and Subcategories</TD></tr>
              <tr><TD>Attributes</TD><TD>Manage the Attribute Block Library</TD></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2">A <strong>Taxonomy Overview</strong> collapsible tree shows the full Section → Category → Subcategory hierarchy at a glance, with counts. A <strong>universal search bar</strong> filters across all tabs.</p>
      </Sub>

      {/* 2. Three-Level Taxonomy */}
      <Sub title="2. Three-Level Taxonomy">
        <div className="bg-card border border-border rounded-lg p-3 font-mono text-xs mb-2">
          <p>Section (Parent Group)</p>
          <p className="pl-4">└── Category</p>
          <p className="pl-10">└── Subcategory</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
            <thead><tr className="bg-muted/50"><TH>Level</TH><TH>DB Table</TH><TH>Example</TH><TH>Purpose</TH></tr></thead>
            <tbody className="divide-y divide-border">
              <tr><TD className="font-semibold">Section</TD><TD><Code>parent_groups</Code></TD><TD>"Food & Beverages"</TD><TD>Visual grouping for buyers on home page</TD></tr>
              <tr><TD className="font-semibold">Category</TD><TD><Code>category_config</Code></TD><TD>"Home Food"</TD><TD>Core configuration unit — defines behavior, form hints, transaction type</TD></tr>
              <tr><TD className="font-semibold">Subcategory</TD><TD><Code>subcategories</Code></TD><TD>"North Indian"</TD><TD>Buyer-facing filter within a category</TD></tr>
            </tbody>
          </table>
        </div>
        <div className="mt-2 space-y-1 text-xs">
          <p>• A Section can contain <strong>zero or more</strong> Categories</p>
          <p>• A Category belongs to <strong>exactly one</strong> Section (via <Code>parent_group</Code> FK)</p>
          <p>• A Category can have <strong>zero or more</strong> Subcategories</p>
          <p>• Disabling a Section <strong>cascades</strong> to disable all its Categories</p>
          <p>• Deleting a Section with active sellers <strong>soft-disables</strong> instead of hard-deleting</p>
        </div>
      </Sub>

      {/* 3. Sections (Parent Groups) */}
      <Sub title="3. Sections (Parent Groups)">
        <p><strong>DB Table:</strong> <Code>parent_groups</Code></p>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
            <thead><tr className="bg-muted/50"><TH>Field</TH><TH>Type</TH><TH>Purpose</TH></tr></thead>
            <tbody className="divide-y divide-border">
              {[
                ['slug', 'TEXT (unique)', 'URL-safe identifier, auto-generated from name'],
                ['name', 'TEXT', 'Display name shown to buyers and in admin'],
                ['icon', 'TEXT', 'Emoji icon (e.g., 🍲)'],
                ['color', 'TEXT', 'Tailwind CSS class pair'],
                ['is_active', 'BOOLEAN', 'Whether visible to buyers'],
                ['sort_order', 'INT', 'Display ordering (drag-and-drop reorderable)'],
                ['layout_type', 'TEXT', 'One of: ecommerce, food, service'],
                ['requires_license', 'BOOLEAN', 'Whether sellers need a license'],
                ['license_type_name', 'TEXT', 'Label for the license field (e.g., "FSSAI License")'],
              ].map(([f, t, p]) => (
                <tr key={f}><TD><Code>{f}</Code></TD><TD>{t}</TD><TD>{p}</TD></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2"><strong>Admin Actions:</strong> Add, Edit, Delete (soft if active sellers), Toggle Active/Inactive (cascades), Drag-and-Drop Reorder.</p>
        <p><strong>Where Sections Appear:</strong> Buyer Home Page tabs, Category Group Grid, Seller Registration, Welcome Carousel.</p>
      </Sub>

      {/* 4. Categories */}
      <Sub title="4. Categories (category_config)">
        <p>This is the <strong>most important table</strong> in the system. Each row defines the complete behavior for a product/service category.</p>

        <h4 className="text-xs font-bold text-foreground mt-3 mb-1">Identity Fields</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
            <thead><tr className="bg-muted/50"><TH>Field</TH><TH>Purpose</TH></tr></thead>
            <tbody className="divide-y divide-border">
              {[
                ['category', 'Unique machine-readable key (ENUM)'],
                ['display_name', 'Human-readable name shown everywhere'],
                ['icon / color', 'Visual branding'],
                ['parent_group', 'FK → parent_groups.slug'],
                ['display_order', 'Sort position within section'],
                ['is_active', 'Whether category is live'],
                ['image_url', 'AI-generated or uploaded category image'],
              ].map(([f, p]) => (
                <tr key={f}><TD><Code>{f}</Code></TD><TD>{p}</TD></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="text-xs font-bold text-foreground mt-3 mb-1">Transaction Type (Master Field)</h4>
        <p>The <Code>transaction_type</Code> field is the <strong>single most important configuration</strong>. It determines the action button, checkout flow, behavior flags, and order status flow.</p>

        <h4 className="text-xs font-bold text-foreground mt-3 mb-1">Behavior Flags (Auto-Derived)</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
            <thead><tr className="bg-muted/50"><TH>Flag</TH><TH>Purpose</TH></tr></thead>
            <tbody className="divide-y divide-border">
              {[
                ['supports_cart', 'Item can be added to multi-item cart'],
                ['has_quantity', 'Buyer can select quantity'],
                ['requires_time_slot', 'Buyer must pick a time slot'],
                ['has_duration', 'Service has a time duration'],
                ['has_date_range', 'Rental-style date range selection'],
                ['enquiry_only', 'No direct purchase; enquiry-based'],
                ['is_negotiable', 'Price is negotiable'],
                ['layout_type', 'UI layout: ecommerce, food, or service'],
              ].map(([f, p]) => (
                <tr key={f}><TD><Code>{f}</Code></TD><TD>{p}</TD></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="text-xs font-bold text-foreground mt-3 mb-1">Service Feature Flags</h4>
        <div className="space-y-1.5 mt-1">
          {[
            ['supports_addons', 'Sellers can add optional extras for buyers during booking'],
            ['supports_recurring', 'Buyers can set up weekly/monthly recurring bookings'],
            ['supports_staff_assignment', 'Sellers can assign staff members to bookings'],
          ].map(([flag, desc]) => (
            <div key={flag} className="flex items-start gap-2 text-xs">
              <CheckCircle size={12} className="text-emerald-500 mt-0.5 shrink-0" />
              <div><Code>{flag}</Code> — {desc}</div>
            </div>
          ))}
        </div>

        <h4 className="text-xs font-bold text-foreground mt-3 mb-1">Seller Form Hints</h4>
        <p>Customize the seller's product creation form per category: <Code>name_placeholder</Code>, <Code>description_placeholder</Code>, <Code>price_label</Code>, <Code>duration_label</Code>, <Code>price_prefix</Code>, <Code>show_veg_toggle</Code>, <Code>show_duration_field</Code>, <Code>primary_button_label</Code>.</p>

        <h4 className="text-xs font-bold text-foreground mt-3 mb-1">Display Configuration</h4>
        <p><Code>supports_brand_display</Code>, <Code>supports_warranty_display</Code>, <Code>image_aspect_ratio</Code>, <Code>image_object_fit</Code> — control how product cards render for buyers.</p>

        <p className="mt-2"><strong>Admin Actions:</strong> Add, Edit (full dialog), Delete (soft if active sellers), Toggle Active/Inactive, Drag-and-Drop Reorder, Generate AI Image.</p>
      </Sub>

      {/* 5. Subcategories */}
      <Sub title="5. Subcategories">
        <p><strong>DB Table:</strong> <Code>subcategories</Code></p>
        <p>Subcategories <strong>inherit</strong> their parent category's transaction type and behavior flags. They can <strong>override</strong> form hints (placeholders, labels, toggles) — if a field is <Code>null</Code>, the parent's value is used.</p>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
            <thead><tr className="bg-muted/50"><TH>Field</TH><TH>Purpose</TH></tr></thead>
            <tbody className="divide-y divide-border">
              {[
                ['slug', 'URL-safe identifier'],
                ['display_name', 'Shown as filter chips to buyers'],
                ['display_order', 'Sort position'],
                ['icon / color', 'Visual branding'],
                ['is_active', 'Visibility flag'],
                ['name_placeholder', 'Override parent\'s placeholder'],
                ['price_label', 'Override parent\'s price label'],
                ['show_veg_toggle', 'Override parent\'s veg toggle setting'],
              ].map(([f, p]) => (
                <tr key={f}><TD><Code>{f}</Code></TD><TD>{p}</TD></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2"><strong>Admin Actions:</strong> Add (from category row or Subcategory Manager), Edit, Delete (hard delete), Filter by Parent Category, Generate AI Image.</p>
      </Sub>

      {/* 6. Attribute Blocks */}
      <Sub title="6. Attribute Block Library">
        <p><strong>DB Table:</strong> <Code>attribute_block_library</Code></p>
        <p>Attribute blocks define <strong>structured data fields</strong> that sellers fill in when creating a listing. They provide buyers with standardized, category-relevant information.</p>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
            <thead><tr className="bg-muted/50"><TH>Field</TH><TH>Purpose</TH></tr></thead>
            <tbody className="divide-y divide-border">
              {[
                ['block_type', 'Unique machine key (e.g., food_details)'],
                ['display_name', 'Human name (e.g., "Food Details")'],
                ['category_hints', 'Array of category keys this block is available for'],
                ['schema', 'JSONB field definitions (see below)'],
                ['renderer_type', 'How data is displayed: key_value, tags, table, badge_list, text'],
              ].map(([f, p]) => (
                <tr key={f}><TD><Code>{f}</Code></TD><TD>{p}</TD></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="text-xs font-bold text-foreground mt-3 mb-1">Schema Field Types</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
            <thead><tr className="bg-muted/50"><TH>Type</TH><TH>Widget</TH></tr></thead>
            <tbody className="divide-y divide-border">
              {[
                ['text', 'Text input'],
                ['number', 'Number input'],
                ['select', 'Dropdown with predefined options'],
                ['tag_input', 'Freeform tag input'],
                ['boolean', 'Toggle switch'],
                ['textarea', 'Textarea'],
                ['date', 'Date picker'],
              ].map(([t, w]) => (
                <tr key={t}><TD><Code>{t}</Code></TD><TD>{w}</TD></tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2"><strong>Category Linking:</strong> Blocks are linked to categories via <Code>category_hints</Code>. Only blocks matching the selected category appear in the seller form.</p>
        <p><strong>Admin Actions:</strong> Create, Edit, Toggle Active/Inactive, Deactivate (soft-delete only), Filter by Category, Visual Schema Builder.</p>
      </Sub>

      {/* 7. Transaction Types */}
      <Sub title="7. Transaction Types & Action Buttons">
        <p>The <Code>transaction_type</Code> determines the buyer's primary CTA and checkout flow:</p>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
            <thead><tr className="bg-muted/50"><TH>Transaction Type</TH><TH>Buyer Button</TH><TH>Cart?</TH><TH>Buyer Flow</TH></tr></thead>
            <tbody className="divide-y divide-border">
              {[
                ['cart_purchase', 'Add to Cart (ADD)', '✅', 'Browse → Add to Cart → Checkout'],
                ['buy_now', 'Buy Now (BUY)', '❌', 'Browse → Buy Now → Payment'],
                ['book_slot', 'Book Now (Book)', '❌', 'Browse → Select Slot → Book'],
                ['request_service', 'Request (Request)', '❌', 'Browse → Request → Seller Responds'],
                ['request_quote', 'Quote (Quote)', '❌', 'Browse → Request Quote → Negotiate'],
                ['contact_only', 'Contact (Contact)', '❌', 'Browse → Contact → Offline'],
                ['schedule_visit', 'Visit (Visit)', '❌', 'Browse → Pick Date → Visit'],
              ].map(([tt, btn, cart, flow]) => (
                <tr key={tt}><TD><Code>{tt}</Code></TD><TD className="font-medium text-foreground">{btn}</TD><TD>{cart}</TD><TD>{flow}</TD></tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="text-xs font-bold text-foreground mt-3 mb-1">DB Triggers</h4>
        <p>• <strong>INSERT trigger</strong>: Auto-derives <Code>action_type</Code> from category's <Code>transaction_type</Code> when a product is created.</p>
        <p>• <strong>UPDATE trigger</strong>: When admin changes a category's <Code>transaction_type</Code>, all existing products in that category are updated.</p>
      </Sub>

      {/* 8. Behavior Flag Derivation */}
      <Sub title="8. Behavior Flag Derivation Matrix">
        <p>When an admin selects a <Code>transaction_type</Code>, behavior flags are auto-derived:</p>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[10px] border border-border rounded-lg overflow-hidden">
            <thead><tr className="bg-muted/50"><TH>Type</TH><TH>cart</TH><TH>qty</TH><TH>slot</TH><TH>duration</TH><TH>date_range</TH><TH>enquiry</TH><TH>negotiate</TH><TH>layout</TH></tr></thead>
            <tbody className="divide-y divide-border">
              {[
                ['cart_purchase', '✅', '✅', '—', '—', '—', '—', '—', 'ecommerce'],
                ['buy_now', '—', '✅', '—', '—', '—', '—', '—', 'ecommerce'],
                ['book_slot', '—', '—', '✅', '✅', '—', '—', '—', 'service'],
                ['request_service', '—', '—', '—', '—', '—', '✅', '—', 'service'],
                ['request_quote', '—', '—', '—', '—', '—', '✅', '✅', 'service'],
                ['contact_only', '—', '—', '—', '—', '—', '✅', '—', 'service'],
                ['schedule_visit', '—', '—', '✅', '—', '✅', '—', '—', 'service'],
              ].map(([type, ...vals]) => (
                <tr key={type}><TD><Code>{type}</Code></TD>{vals.map((v, i) => <TD key={i}>{v}</TD>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sub>

      {/* 9. Config Flow */}
      <Sub title="9. How Configurations Flow Through the Platform">
        <div className="bg-card border border-border rounded-lg p-3 font-mono text-[10px] space-y-0.5 mb-2">
          <p>Admin configures category_config</p>
          <p className="pl-2">↓ Row saved with transaction_type + derived behavior flags</p>
          <p className="pl-2">↓ DB trigger updates existing products' action_type</p>
          <p className="pl-2">↓ Frontend cache invalidated (['category-configs'])</p>
          <p className="pl-2">↓ Seller Form: useCategoryBehavior() → shows/hides fields</p>
          <p className="pl-2">↓ Seller Form: AttributeBlockBuilder → category-specific blocks</p>
          <p className="pl-2">↓ Product saved with action_type + specifications</p>
          <p className="pl-2">↓ Buyer View: deriveActionType() → resolves action button</p>
          <p className="pl-2">↓ Buyer View: ACTION_CONFIG → renders correct label/icon</p>
          <p className="pl-2">↓ Buyer clicks → appropriate flow (cart, booking, enquiry)</p>
        </div>
        <p className="text-xs text-primary flex items-center gap-1">
          <Sparkles size={12} /> Changes take effect immediately — no code changes or deployments needed.
        </p>
      </Sub>

      {/* 10. Impact on Seller */}
      <Sub title="10. Impact on Seller Experience">
        <h4 className="text-xs font-bold text-foreground mb-1">Product Creation Form</h4>
        <div className="space-y-1 text-xs">
          <p>1. <strong>Category Selection</strong>: Seller picks from allowed categories</p>
          <p>2. <strong>Form Fields</strong>: <Code>show_veg_toggle</Code> and <Code>show_duration_field</Code> control optional fields</p>
          <p>3. <strong>Placeholders</strong>: Customized per category via form hints</p>
          <p>4. <strong>Attribute Blocks</strong>: Only matching blocks shown via <Code>category_hints</Code></p>
          <p>5. <strong>Service Fields</strong>: If <Code>layout_type = service</Code>, additional fields appear (duration, buffer, location)</p>
        </div>
        <h4 className="text-xs font-bold text-foreground mt-3 mb-1">Dashboard & Settings</h4>
        <div className="space-y-1 text-xs">
          <p>• <strong>Service Availability Config</strong>: Only if <Code>hasServiceLayout</Code></p>
          <p>• <strong>Staff Manager</strong>: Only if <Code>supports_staff_assignment</Code></p>
          <p>• <strong>Bookings Calendar</strong>: Only for service categories</p>
          <p>• <strong>Schedule Warning Banner</strong>: Shown if service seller hasn't configured availability</p>
        </div>
        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-2">
          <AlertTriangle size={12} /> <Code>useSellerCategoryFlags(categories)</Code> merges flags across ALL seller's categories — if ANY supports a feature, the seller sees it.
        </p>
      </Sub>

      {/* 11. Impact on Buyer */}
      <Sub title="11. Impact on Buyer Experience">
        <div className="space-y-2 text-xs">
          <div>
            <p className="font-semibold text-foreground">Home Page</p>
            <p>• Section Tabs (ParentGroupTabs) for filtering</p>
            <p>• Category Image Grid organized by section</p>
            <p>• Product card action button derived from <Code>deriveActionType()</Code></p>
          </div>
          <div>
            <p className="font-semibold text-foreground">Category Page</p>
            <p>• Subcategory filter chips at top</p>
            <p>• Sort order from <Code>default_sort</Code> config</p>
          </div>
          <div>
            <p className="font-semibold text-foreground">Product Detail</p>
            <p>• Primary CTA from <Code>ACTION_CONFIG[actionType]</Code></p>
            <p>• Attribute blocks rendered per <Code>renderer_type</Code></p>
            <p>• Booking flow (book_slot), Cart (cart_purchase/buy_now), or Enquiry (request/quote/contact)</p>
          </div>
        </div>

        <h4 className="text-xs font-bold text-foreground mt-3 mb-1">Action Button Reference</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
            <thead><tr className="bg-muted/50"><TH>Transaction Type</TH><TH>Full Label</TH><TH>Short</TH></tr></thead>
            <tbody className="divide-y divide-border">
              {[
                ['cart_purchase', 'Add to Cart', 'ADD'],
                ['buy_now', 'Buy Now', 'BUY'],
                ['book_slot', 'Book Now', 'Book'],
                ['request_service', 'Request Service', 'Request'],
                ['request_quote', 'Request Quote', 'Quote'],
                ['contact_only', 'Contact Seller', 'Contact'],
                ['schedule_visit', 'Schedule Visit', 'Visit'],
              ].map(([tt, full, short]) => (
                <tr key={tt}><TD><Code>{tt}</Code></TD><TD>{full}</TD><TD className="font-semibold text-foreground">{short}</TD></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sub>

      {/* 12. Safety Mechanisms */}
      <Sub title="12. Safety Mechanisms">
        <div className="space-y-2 text-xs">
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="font-semibold text-foreground mb-1">Transaction Type Change Protection</p>
            <p>When changing a category's <Code>transaction_type</Code>, a confirmation dialog shows the count of affected products. DB trigger auto-updates all products after confirmation.</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="font-semibold text-foreground mb-1">Deletion Protection</p>
            <p>Categories with active sellers are <strong>soft-disabled</strong>. Attribute blocks are <strong>soft-deactivated</strong> (never hard-deleted). Existing product data is preserved.</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="font-semibold text-foreground mb-1">Cart Validation</p>
            <p><Code>useCart</Code> rejects items whose <Code>action_type</Code> is not <Code>add_to_cart</Code> or <Code>buy_now</Code>. DB trigger validates product availability and seller store status.</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="font-semibold text-foreground mb-1">Data Integrity</p>
            <p>CHECK constraints prevent invalid <Code>action_type</Code> values. Triggers validate <Code>layout_type</Code>. Category key uses ENUM type.</p>
          </div>
        </div>
      </Sub>

      {/* 13. Current Category Inventory */}
      <Sub title="13. Current Category Inventory (~54 Categories)">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
            <thead><tr className="bg-muted/50"><TH>Section</TH><TH>Categories</TH><TH>Default Transaction Type</TH></tr></thead>
            <tbody className="divide-y divide-border">
              {[
                ['Food & Beverages', 'home_food, bakery, snacks, groceries, beverages', 'cart_purchase'],
                ['Education', 'tuition, daycare, coaching', 'book_slot'],
                ['Fitness & Wellness', 'yoga, dance, music, art_craft, language, fitness', 'book_slot'],
                ['Home Services', 'electrician, plumber, carpenter, ac_service, pest_control, appliance_repair', 'request_service / book_slot'],
                ['Personal Care', 'tailoring, laundry, beauty, mehendi, salon', 'book_slot / cart_purchase'],
                ['Domestic Help', 'maid, cook, driver, nanny', 'contact_only'],
                ['Events', 'catering, decoration, photography, dj_music', 'request_quote / book_slot'],
                ['Professional', 'tax_consultant, it_support, tutoring, resume_writing', 'book_slot / request_service'],
                ['Pets', 'pet_food, pet_grooming, pet_sitting, dog_walking', 'cart_purchase / book_slot'],
                ['Rentals', 'equipment_rental, vehicle_rental, party_supplies, baby_gear', 'contact_only / cart_purchase'],
                ['Shopping', 'furniture, electronics, books, toys, kitchen, clothing', 'cart_purchase / buy_now'],
                ['Real Estate', 'flat_rent, roommate, parking', 'schedule_visit / contact_only'],
              ].map(([section, cats, tt]) => (
                <tr key={section}><TD className="font-medium text-foreground">{section}</TD><TD className="text-[10px]">{cats}</TD><TD>{tt}</TD></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sub>

      {/* 14. Key Hooks & Components Reference */}
      <Sub title="14. Key Frontend Hooks & Components">
        <h4 className="text-xs font-bold text-foreground mb-1">Hooks</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
            <thead><tr className="bg-muted/50"><TH>Hook</TH><TH>Purpose</TH></tr></thead>
            <tbody className="divide-y divide-border">
              {[
                ['useCategoryConfigs()', 'All configs + grouped by section'],
                ['useCategoryBehavior(cat)', 'Behavior for a specific category'],
                ['useCategoryFlags(cat)', 'Feature flags for one category'],
                ['useSellerCategoryFlags(cats)', 'Merged flags across seller\'s categories'],
                ['useParentGroups()', 'Section data + layout map'],
                ['useSubcategories(configId?)', 'Subcategories, optionally filtered'],
                ['useBlockLibrary()', 'All active attribute blocks'],
                ['useCategoryManagerData()', 'Admin CRUD operations state machine'],
              ].map(([hook, purpose]) => (
                <tr key={hook}><TD><Code>{hook}</Code></TD><TD>{purpose}</TD></tr>
              ))}
            </tbody>
          </table>
        </div>
        <h4 className="text-xs font-bold text-foreground mt-3 mb-1">Utilities</h4>
        <div className="space-y-1 text-xs">
          <p>• <Code>deriveActionType()</Code> — Resolves product action type with fallback chain</p>
          <p>• <Code>ACTION_CONFIG</Code> — Button labels, icons, cart eligibility per action type</p>
          <p>• <Code>TRANSACTION_TO_ACTION</Code> — Maps transaction_type → action_type</p>
          <p>• <Code>deriveBehaviorFlags()</Code> — Auto-derives behavior flags from transaction type</p>
        </div>
      </Sub>
    </div>
  );
}
