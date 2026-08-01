// @ts-nocheck
import { DocHero, DocSection, DocSubSection, DocStep, DocInfoCard, DocList, DocTable } from './DocPrimitives';
import { ShoppingCart } from 'lucide-react';

export function MarketplaceShoppingDocs() {
  return (
    <div>
      <DocHero
        icon={ShoppingCart}
        title="Marketplace & Shopping"
        subtitle="Seller stores, product details, contact seller hub, cart with multi-seller handling, orders, subscriptions, collective buying, trust directory, and favorites."
      />

      {/* ─── SellerDetailPage ─── */}
      <DocSection title="SellerDetailPage — Store View" id="seller-store">
        <p>The /seller/:id route shows an individual seller's complete store page.</p>

        <DocSubSection title="Store Header">
          <DocList items={[
            'Cover image (seller.cover_image_url) at the top',
            'Business name, rating (stars with decimal), review count',
            'FavoriteButton — heart icon to save/unsave seller',
            'Store status computed by compute_store_status() database function: open, closed, closed_today, paused',
            'Operating hours display with days of week (from seller_profiles.operating_days, availability_start, availability_end)',
            'Fulfillment mode badge: "Delivery", "Pickup", or both',
            'Society name and distance (if cross-society browsing is enabled)',
          ]} />
        </DocSubSection>

        <DocSubSection title="Tabs">
          <DocTable
            headers={['Tab', 'Content']}
            rows={[
              ['Menu/Products', 'Product grid filtered by category. Category filter chips (horizontal scroll). In-tab search field. Products sorted: bestsellers first, then recommended, then by category.'],
              ['Reviews', 'ReviewList component showing buyer reviews with star ratings, text, and date'],
              ['Reputation', 'SellerReputationTab — trust metrics, delivery scores, recommendation count, trust tier badges'],
            ]}
          />
        </DocSubSection>

        <DocSubSection title="Product Cards">
          <DocList items={[
            'ProductCard component shows: image, name, price (with MRP strikethrough if discounted), veg/non-veg badge, bestseller/recommended badges',
            'Action button determined by product.action_type: add_to_cart, book, contact_seller, request_service, request_quote, buy_now, schedule_visit',
            'Tapping a product opens ProductDetailSheet (bottom drawer)',
          ]} />
        </DocSubSection>

        <DocSubSection title="Report Seller">
          <DocList items={[
            'Flag icon button opens a report dialog',
            'Report type dropdown: "Misleading information", "Inappropriate content", "Spam", "Other"',
            'Description textarea for details',
            'Submits to seller_reports table with seller_id, reporter_id, report_type, description',
          ]} />
        </DocSubSection>

        <DocSubSection title="Society Scoping">
          <DocList items={[
            'By default, only sellers from the same society are visible',
            'If seller has sell_beyond_community = true, they appear in cross-society searches',
            'Cross-society sellers show distance and society name',
            'If seller is not approved (verification_status ≠ approved), store page shows empty',
          ]} />
        </DocSubSection>
      </DocSection>

      {/* ─── ProductDetailSheet ─── */}
      <DocSection title="ProductDetailSheet — Product Detail" id="product-detail">
        <p>Opens as a bottom sheet when tapping any product across the app.</p>
        <DocList items={[
          'Product image carousel',
          'Product name, price (with MRP and discount % if applicable)',
          'Veg/non-veg badge for food categories',
          'Description text',
          'Attribute blocks — dynamic fields configured per category (schema from attribute_block_library table)',
          'Preparation time display (if product.prep_time_minutes is set)',
          'Seller info: business name, rating, link to seller store',
          'Primary action button varies by category: "Add to Cart", "Book Now", "Contact Seller", "Request Quote", etc.',
          'Contact Seller modal — triggered for contact_seller action types',
        ]} />
        <DocInfoCard variant="info" title="Category-Driven Behavior">
          The action button type is inherited from the product's category configuration (category_config.transaction_type → product.action_type). When an admin changes a category's listing type, a database trigger (sync_products_action_type_on_category_tx_change) automatically updates ALL products in that category.
        </DocInfoCard>
      </DocSection>

      {/* ─── Contact Seller Hub ─── */}
      <DocSection title="Contact Seller Hub" id="contact-seller">
        <p>When a product's action type is "contact_seller", the ContactSellerModal opens with three interaction options:</p>

        <DocSubSection title="Call Now">
          <DocList items={[
            'Always visible — disabled with "Phone not available" if seller has no phone number',
            'Logs the interaction to seller_contact_interactions table (buyer_id, seller_id, product_id, interaction_type: "call")',
            'Opens device phone dialer via tel: link',
            'After 5 seconds, CallFeedbackModal appears automatically',
          ]} />
        </DocSubSection>

        <DocSubSection title="Post-Call Feedback (CallFeedbackModal)">
          <DocList items={[
            'Radio button selection with 6 predefined outcomes:',
            '  1. "Call connected and discussion happened"',
            '  2. "Call connected but no agreement"',
            '  3. "Seller did not answer"',
            '  4. "Number unreachable / incorrect"',
            '  5. "Agreement reached / service confirmed"',
            '  6. "Need more info / seller will call back"',
            'Submit stores to call_feedback table (interaction_id, buyer_id, seller_id, outcome)',
            'Quick one-tap flow — submit button confirms selection',
          ]} />
        </DocSubSection>

        <DocSubSection title="Message (Chat)">
          <DocList items={[
            'Opens SellerChatSheet — a bottom drawer with real-time messaging',
            'Product context shown at the top (name, price, image thumbnail)',
            'Message list with scrollable history, real-time subscription on seller_conversation_messages via Supabase Realtime',
            'Text input + send button at bottom',
            'On send: inserts message, updates conversation.last_message_at, enqueues push notification to seller via notification_queue',
            'Uses useSellerChat hook: getOrCreateConversation (upserts seller_conversations with UNIQUE buyer_id+seller_id+product_id), useMessages (query + realtime), sendMessage',
          ]} />
        </DocSubSection>

        <DocInfoCard variant="success" title="Database Tables">
          <DocList items={[
            'seller_contact_interactions — tracks every call/message/enquiry event',
            'call_feedback — post-call feedback with predefined outcomes',
            'seller_conversations — one thread per buyer+seller+product combination',
            'seller_conversation_messages — individual messages with read status, realtime enabled',
          ]} />
        </DocInfoCard>
      </DocSection>

      {/* ─── CartPage ─── */}
      <DocSection title="CartPage — Shopping Cart & Checkout" id="cart-page">
        <p>The /cart route is a comprehensive checkout page with multi-seller support.</p>

        <DocSubSection title="Header">
          <DocList items={[
            'Sticky header with back button, "Checkout" title, item count',
            '"Clear" button — opens AlertDialog confirmation before clearing entire cart',
          ]} />
        </DocSubSection>

        <DocSubSection title="Preparation & Timing Banners">
          <DocList items={[
            'Preparation time banner: "Ready in ~X minutes" (shown when maxPrepTime > 0)',
            'Urgent order warning: "Time-sensitive order — Seller must respond within 3 min or auto-cancelled" (for urgent items)',
            'Minimum order warning per seller: "Seller: Minimum order ₹X. Add ₹Y more to place this order"',
          ]} />
        </DocSubSection>

        <DocSubSection title="Cart Items (Grouped by Seller)">
          <DocList items={[
            'Each seller group has a header: store icon, seller name, item count',
            'Cross-society indicator: "Seller from another community" (when seller society_id differs)',
            'Per item: product image (14x14 thumbnail), veg/non-veg badge, name, unit price × quantity, total price',
            'Quantity controls: - / count / + buttons with haptic feedback',
            'Delete button (Trash2 icon) — removes item with undo toast (4 second window with "Undo" action)',
          ]} />
        </DocSubSection>

        <DocSubSection title="Order Customization">
          <DocList items={[
            'Instructions textarea: "e.g., Less spicy, no onions..."',
            'Payment Method selector (PaymentMethodSelector component): UPI and/or Cash on Delivery options, availability depends on seller settings',
            'Fulfillment selector (FulfillmentSelector component): Delivery vs Self Pickup, shows delivery fee and free delivery threshold',
            'Fulfillment conflict warning if sellers don\'t support chosen mode',
            'Coupon input (CouponInput component) — only for single-seller carts. Multi-seller carts show "Coupons are not available for multi-seller carts"',
          ]} />
        </DocSubSection>

        <DocSubSection title="Bill Details">
          <DocList items={[
            'Per-seller subtotal breakdown',
            'Coupon discount line (if applied): "-₹X (CODE)"',
            'Delivery fee line: amount, "FREE" if above threshold, "Self Pickup" if pickup selected',
            'Total "To Pay" in bold',
          ]} />
        </DocSubSection>

        <DocSubSection title="Address & Trust Section">
          <DocList items={[
            'Delivery address card: user name, block, flat number, society name',
            'Or pickup address: seller name, society name',
            'Refund Promise banner: configurable text from system settings',
            'Neighborhood Guarantee banner: configurable emoji + text from marketplace labels',
          ]} />
        </DocSubSection>

        <DocSubSection title="Sticky Footer & Checkout">
          <DocList items={[
            'No payment method warning if neither UPI nor COD is available',
            'Community support message: "Supporting X local business(es)"',
            'Apple compliance disclaimer about payments',
            'Total amount display and "Place Order" button',
            'Place Order → opens confirmation AlertDialog with: item count, payment method, delivery/pickup address, multi-seller notice, total',
            'On confirm: OrderProgressOverlay shows step-by-step progress animation',
            'Multi-seller carts create separate orders per seller',
            'If payment method is UPI: RazorpayCheckout component handles payment flow',
          ]} />
        </DocSubSection>
      </DocSection>

      {/* ─── OrdersPage ─── */}
      <DocSection title="OrdersPage — Order History" id="orders-page">
        <p>The /orders route shows all orders with buyer/seller view switching.</p>
        <DocList items={[
          'Tabs: Active Orders / Past Orders',
          'SellerSwitcher component — if user is a seller, can switch between buyer and seller view',
          'Infinite scroll pagination (20 orders per page, "Load More" button)',
          'OrderCard shows: seller/buyer thumbnail, business name, status badge (color-coded via useStatusLabels), date, item count, total amount, delivery badge',
          'Seller view shows buyer address (block, flat number)',
          'Completed orders show checkmark icon and ReorderButton',
          'Tapping any order navigates to /orders/:id',
        ]} />
      </DocSection>

      {/* ─── OrderDetailPage ─── */}
      <DocSection title="OrderDetailPage — Order Details & Tracking" id="order-detail">
        <p>The /orders/:id route shows comprehensive order information.</p>

        <DocSubSection title="Header">
          <DocList items={[
            'Back button, "Order Summary" title',
            'Order ID with copy button (copies to clipboard, shows first 8 chars)',
            'Chat button with unread message count badge — opens OrderChat sheet',
          ]} />
        </DocSubSection>

        <DocSubSection title="Order Content">
          <DocList items={[
            'UrgentOrderTimer — countdown for urgent orders with auto-cancel deadline',
            'Status timeline — visual progression through order statuses (defined by category_status_flows table)',
            'DeliveryStatusCard — when delivery is assigned: rider info (name, phone, photo), delivery code',
            'LiveDeliveryTracker — real-time GPS map showing rider location (from delivery_locations table)',
            'Order items list — OrderItemCard for each item with image, name, quantity, price, per-item status',
            'Seller/buyer info card with phone call button',
            'Payment summary: payment method, payment status badge, itemized breakdown',
            'OrderCancellation component — cancel/return actions based on order status and category rules',
            'OrderRejectionDialog — for sellers to reject with reason',
            'Status action buttons for sellers: Accept, Mark Ready, Mark Completed (from get_allowed_transitions function)',
            'ReviewForm — appears after order completion for buyer to rate',
            'ReorderButton — for completed orders',
            'FeedbackSheet — post-order feedback prompt',
          ]} />
        </DocSubSection>
      </DocSection>

      {/* ─── MySubscriptionsPage ─── */}
      <DocSection title="MySubscriptionsPage — Recurring Orders" id="subscriptions">
        <p>The /subscriptions route manages recurring delivery subscriptions.</p>
        <DocList items={[
          'Fetches from subscriptions table: joins product (name, price, image) and seller (business_name)',
          'Each subscription card shows: product image, name, seller name, frequency, quantity, delivery days, next delivery date, status',
          'Status badges: active (green), paused (yellow), cancelled (red)',
          'Pause button (PauseCircle icon) — sets status to "paused", shows pause_until date if set',
          'Resume button (PlayCircle icon) — reactivates paused subscription',
          'Cancel button (X icon) — opens AlertDialog confirmation: "Cancel subscription? You won\'t receive any more deliveries for this item."',
          'Refresh button to reload subscription data',
          'Empty state if no subscriptions exist',
        ]} />
      </DocSection>

      {/* ─── CollectiveBuyPage ─── */}
      <DocSection title="CollectiveBuyPage — Group Buying" id="collective-buy">
        <p>The /group-buys route enables community-powered group purchasing.</p>
        <DocList items={[
          'Fetches from collective_buy_requests table filtered by society_id, status in (active, fulfilled)',
          'Joins product details (name, price, image) and creator profile (name)',
          'Checks user participation via collective_buy_participants table',
          'Each request card shows: product image/icon, product name, creator name, target vs current quantity with Progress bar',
          'Status badges: "Active" (yellow), "Fulfilled" (green)',
          'Time remaining: "Expires in X days/hours" using formatDistanceToNowStrict',
          'Join button — adds user as participant (inserts into collective_buy_participants)',
          'Leave button — removes participation',
          'Create new request: Plus button opens creation form (product selection, target quantity, expiry date)',
          'Participant count display: "X joined"',
          'Configurable labels via useMarketplaceLabels hook',
        ]} />
      </DocSection>

      {/* ─── TrustDirectoryPage ─── */}
      <DocSection title="TrustDirectoryPage — Skill Sharing & Endorsements" id="trust-directory">
        <p>The /directory route is a community skill-sharing and endorsement system (not a seller directory).</p>
        <DocList items={[
          'Search input to filter skills by name (ilike query with escape)',
          '"Add Skill" button (Plus icon) opens a Sheet with: Skill Name input, Description textarea, Availability input, Save button',
          'Skill cards show: user avatar, name, block/flat number, skill name, description, availability',
          'Trust score display with Award icon',
          'Endorsement count with ThumbsUp icon',
          'Endorse button (Star icon) — users can endorse others\' skills (one endorsement per user per skill)',
          'Endorsement stored in skill_endorsements table, increments endorsement_count and trust_score',
          'User\'s own endorsements tracked to prevent duplicate endorsing',
          'Skills sorted by trust_score (descending) — higher endorsed skills appear first',
          'Displayed on user ProfilePage as skill badges (up to 5)',
        ]} />
      </DocSection>
    </div>
  );
}
