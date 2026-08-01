// @ts-nocheck
import { DocHero, DocSection, DocInfoCard, DocTable, DocFlowStep } from './DocPrimitives';
import { GitBranch } from 'lucide-react';

export function WorkflowEngineDocs() {
  return (
    <div className="space-y-2">
      <DocHero
        icon={GitBranch}
        title="Dynamic Workflow Engine"
        description="A fully database-driven, admin-configurable workflow system that controls order and booking lifecycles. Supports actor-based transitions, per-category pipelines, category-specific overrides, fallback resolution, seller/buyer hints, and real-time validation via database triggers."
        badges={['Admin', 'DB-Driven', 'Actor Validation', '5 Actors', '6 Workflow Types', 'Category Overrides']}
      />

      {/* ─── TABLE OF CONTENTS ─── */}
      <DocSection title="Table of Contents">
        <div className="space-y-0.5">
          <p>1. How the Workflow System Works — End-to-End Overview</p>
          <p>2. Actors & Their Roles</p>
          <p>3. Workflow Types & Their Pipelines</p>
          <p>4. Where Workflows Are Linked — Category Management</p>
          <p>5. Which Action Triggers Which Workflow</p>
          <p>6. Override System — Category-Specific Overrides</p>
          <p>7. Fallback & Resolution Logic</p>
          <p>8. Behavioral Flags — is_transit, requires_otp, is_success</p>
          <p>9. What Happens When an Order is Created</p>
          <p>10. Status-by-Status Deep Dive</p>
          <p>11. Data Model Reference</p>
          <p>12. DB Trigger — How Validation Works</p>
          <p>13. Frontend Integration — Hooks & UI</p>
          <p>14. Admin Workflow Manager — User Manual</p>
          <p>15. OTP Verification & Delivery Gate</p>
          <p>16. Notification Templates</p>
          <p>17. Cross-System Integration</p>
          <p>18. Troubleshooting Guide</p>
        </div>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 1. END-TO-END OVERVIEW */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="1. How the Workflow System Works — End-to-End Overview">
        <DocInfoCard title="The Big Picture" icon="🗺️">
          <p>Every order, booking, or enquiry on the platform follows a <strong>workflow</strong> — a sequence of statuses with rules about who can move the order to the next status. These workflows are 100% database-driven. No status names, no transition rules, and no UI labels are hardcoded in the frontend or backend code.</p>
          <p className="mt-2"><strong>The system has three layers:</strong></p>
          <p>1. <strong>Pipeline Definition</strong> (<code className="text-[10px] bg-muted px-1 rounded">category_status_flows</code>) — Defines what statuses exist, in what order, with what labels and behavior flags.</p>
          <p>2. <strong>Transition Rules</strong> (<code className="text-[10px] bg-muted px-1 rounded">category_status_transitions</code>) — Defines which actor can move from status A to status B. Non-linear moves (cancellation, rescheduling) are explicitly configured here.</p>
          <p>3. <strong>Category Linkage</strong> (<code className="text-[10px] bg-muted px-1 rounded">category_config.transaction_type</code>) — Links each product category to its workflow type.</p>
        </DocInfoCard>

        <DocInfoCard title="Resolution Chain (How the system picks a workflow)" icon="🔗">
          <p>When the system needs to determine which workflow applies to an order, it follows this chain:</p>
          <DocFlowStep number={1} title="Check stored transaction_type on the order" desc="New orders have transaction_type set at creation time. If present, this is the single source of truth — no further resolution needed." />
          <DocFlowStep number={2} title="Legacy fallback: Resolve from order attributes" desc="For older orders without stored transaction_type, the system uses resolveTransactionType() which examines order_type, fulfillment_type, delivery_handled_by, and listing_type to determine the correct workflow key." />
          <DocFlowStep number={3} title="Load flow steps with override cascade" desc="Query category_status_flows WHERE parent_group = seller's primary_group AND transaction_type = resolved key. If no rows found, retry with parent_group = 'default'." />
          <DocFlowStep number={4} title="Load transition rules with same cascade" desc="Same override-then-default logic applies to category_status_transitions." />
        </DocInfoCard>

        <DocInfoCard title="Key Principle: Override → Default Fallback" icon="⚡">
          <p>This is the most important concept to understand:</p>
          <p className="mt-1">• A workflow is identified by the pair: <strong>(parent_group, transaction_type)</strong></p>
          <p>• <code className="text-[10px] bg-muted px-1 rounded">parent_group = 'default'</code> is the base workflow that applies to all sellers</p>
          <p>• Category-specific overrides (e.g., <code className="text-[10px] bg-muted px-1 rounded">parent_group = 'food_beverages'</code>) take priority over default</p>
          <p>• If a seller belongs to the <code className="text-[10px] bg-muted px-1 rounded">food_beverages</code> group and a food_beverages override exists for the transaction_type, the <strong>override is used, not the default</strong></p>
          <p>• Editing the default workflow does NOT affect overridden categories</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 2. ACTORS */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="2. Actors & Their Roles">
        <p>The workflow engine recognizes <strong>five distinct actors</strong>. Every status transition is gated by which actor is performing the action.</p>

        <DocInfoCard title="Buyer (Resident / Customer)" icon="🛍️">
          <p><strong>Identity:</strong> Any authenticated user browsing the marketplace.</p>
          <p><strong>Can trigger:</strong></p>
          <p>• <strong>Order creation</strong> — Places an order, books a service, or sends an enquiry.</p>
          <p>• <strong>Cancellation</strong> — Can cancel from early statuses where allowed by transitions.</p>
          <p>• <strong>Completion confirmation</strong> — Marks delivered → completed to confirm receipt.</p>
          <p>• <strong>Rescheduling</strong> — For bookings, can trigger rescheduling (side action).</p>
          <p><strong>Cannot do:</strong> Accept orders, mark as preparing/ready, assign delivery, or change system statuses.</p>
          <p><strong>UI:</strong> Sees <code className="text-[10px] bg-muted px-1 rounded">buyer_hint</code> messages. Action buttons built from transitions filtered by actor=buyer.</p>
        </DocInfoCard>

        <DocInfoCard title="Seller (Vendor / Service Provider)" icon="🏪">
          <p><strong>Identity:</strong> User with an active seller_profiles record linked to the order.</p>
          <p><strong>Can trigger:</strong></p>
          <p>• <strong>Accept</strong> — placed → accepted</p>
          <p>• <strong>Prepare</strong> — accepted → preparing</p>
          <p>• <strong>Ready</strong> — preparing → ready</p>
          <p>• <strong>Confirm booking</strong> — booking_requested → confirmed</p>
          <p>• <strong>Respond to enquiry</strong> — inquiry_sent → seller_responded</p>
          <p>• <strong>Cancel</strong> — Only from statuses where transition rules allow it</p>
          <p><strong>When delivery_handled_by = 'seller':</strong> The seller also acts as the delivery actor — they can trigger transit steps (picked_up, on_the_way) and complete delivery via OTP.</p>
        </DocInfoCard>

        <DocInfoCard title="Delivery Partner" icon="🚚">
          <p><strong>Identity:</strong> A rider from delivery_partner_pool assigned via delivery_assignments.</p>
          <p><strong>Can trigger:</strong> Pickup → At gate → Deliver (with OTP) → Failed delivery</p>
          <p><strong>When seller handles delivery:</strong> The seller's transitions include delivery-actor transitions.</p>
        </DocInfoCard>

        <DocInfoCard title="System (Automated)" icon="🤖">
          <p><strong>Identity:</strong> Database triggers, edge functions, and scheduled jobs.</p>
          <p><strong>Can trigger:</strong> Auto-cancellation (timeout), no-show detection, stalled delivery alerts, auto-completion.</p>
        </DocInfoCard>

        <DocInfoCard title="Admin (Platform Admin)" icon="🛡️">
          <p><strong>Identity:</strong> User with admin role in user_roles table.</p>
          <p><strong>Can trigger:</strong> Force status override, workflow configuration, dispute resolution.</p>
          <p>All admin actions logged in audit_log.</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 3. WORKFLOW TYPES */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="3. Workflow Types & Their Pipelines">
        <DocInfoCard title="Overview of All Workflow Types" icon="📦">
          <p>Each workflow type represents a distinct transaction lifecycle. The <code className="text-[10px] bg-muted px-1 rounded">transaction_type</code> column is the key identifier.</p>
        </DocInfoCard>

        <DocTable
          headers={['transaction_type', 'Display Name', 'Use Case', 'Typical Steps']}
          rows={[
            ['cart_purchase', 'Cart Purchase', 'Platform-delivered product orders (food, groceries, retail)', 'placed → accepted → preparing → ready → picked_up → delivered → completed'],
            ['seller_delivery', 'Seller Delivery', 'Seller handles delivery themselves', 'placed → accepted → preparing → on_the_way → delivered → completed'],
            ['self_fulfillment', 'Self Pickup', 'Buyer picks up from seller', 'placed → accepted → preparing → ready → completed'],
            ['service_booking', 'Service Booking', 'Appointments (wellness, education, home services)', 'booking_requested → confirmed → scheduled → in_progress → completed'],
            ['request_service', 'Request Service', 'Quote-based enquiries (interior, custom services)', 'inquiry_sent → seller_responded → negotiation → confirmed → completed'],
            ['contact_enquiry', 'Contact Enquiry', 'Simple contact-only listings', 'inquiry_sent → seller_responded → closed'],
          ]}
        />

        <DocInfoCard title="Cart Purchase Pipeline (Platform Delivery)" icon="🛒">
          <DocTable
            headers={['Step', 'Status', 'Actor', 'Buyer Hint', 'Seller Hint', 'System Action']}
            rows={[
              ['1', 'placed', 'buyer', 'Waiting for seller', 'New order — review it', 'Buzzer + timer starts'],
              ['2', 'accepted', 'seller', 'Seller confirmed', 'Start preparing', 'Timer cleared'],
              ['3', 'preparing', 'seller', 'Being prepared', 'Prepare order items', 'Stall detection active'],
              ['4', 'ready', 'seller', 'Ready for pickup', 'Hand to delivery', 'Delivery assignment created'],
              ['5', 'picked_up', 'delivery', 'On the way!', '—', 'GPS tracking starts'],
              ['6', 'delivered', 'delivery', 'Delivered!', '—', 'OTP verified, review prompt'],
              ['7', 'completed', 'buyer', 'Complete', '—', 'Settlement eligible'],
              ['—', 'cancelled', 'any', 'Order cancelled', 'Order cancelled', 'Refund triggered'],
            ]}
          />
        </DocInfoCard>

        <DocInfoCard title="Seller Delivery Pipeline" icon="🏍️">
          <p>When <code className="text-[10px] bg-muted px-1 rounded">delivery_handled_by = 'seller'</code>, the seller acts as both preparer and delivery partner.</p>
          <DocTable
            headers={['Step', 'Status', 'Actor', 'Key Flags', 'System Action']}
            rows={[
              ['1', 'placed', 'buyer', '—', 'Buzzer + timer starts'],
              ['2', 'accepted', 'seller', '—', 'Timer cleared'],
              ['3', 'preparing', 'seller', 'is_transit: true/false (configurable)', 'GPS tracking if is_transit=true'],
              ['4', 'on_the_way', 'seller', 'is_transit: true', 'GPS tracking active, map visible'],
              ['5', 'delivered', 'seller', 'requires_otp: true', 'OTP verified via verify_delivery_otp_and_complete'],
              ['6', 'completed', 'system', 'is_terminal + is_success', 'Settlement + review eligible'],
              ['—', 'cancelled', 'any', 'is_terminal', 'Refund triggered'],
            ]}
          />
        </DocInfoCard>

        <DocInfoCard title="Self-Fulfillment Pipeline (Pickup)" icon="📦">
          <DocTable
            headers={['Step', 'Status', 'Actor', 'Buyer Hint', 'System Action']}
            rows={[
              ['1', 'placed', 'buyer', 'Waiting for seller', 'Buzzer'],
              ['2', 'accepted', 'seller', 'Confirmed', '—'],
              ['3', 'preparing', 'seller', 'Being prepared', '—'],
              ['4', 'ready', 'seller', 'Ready for pickup!', 'Buyer notified + location shared'],
              ['5', 'completed', 'buyer', 'Picked up', 'Review prompt'],
              ['—', 'cancelled', 'any', 'Cancelled', 'Refund if applicable'],
            ]}
          />
        </DocInfoCard>

        <DocInfoCard title="Service Booking Pipeline" icon="📅">
          <DocTable
            headers={['Step', 'Status', 'Actor', 'System Action']}
            rows={[
              ['1', 'booking_requested', 'buyer', 'Slot soft-locked'],
              ['2', 'confirmed', 'seller', 'Reminders scheduled'],
              ['3', 'scheduled', 'system', '24h + 1h reminders'],
              ['4', 'in_progress', 'seller', '—'],
              ['5', 'completed', 'seller', 'Review prompt'],
              ['—', 'rescheduled', 'any (side action)', 'Old slot released, new slot booked'],
              ['—', 'cancelled', 'any', 'Slot released + fee check'],
              ['—', 'no_show', 'system', 'No-show fee applied'],
            ]}
          />
        </DocInfoCard>

        <DocInfoCard title="Request Service & Contact Enquiry Pipelines" icon="💬">
          <p><strong>Request Service:</strong> inquiry_sent → seller_responded → quoted → accepted → in_progress → completed</p>
          <p><strong>Contact Enquiry:</strong> inquiry_sent → seller_responded → closed (lightweight, 3-step)</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 4. WHERE WORKFLOWS ARE LINKED */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="4. Where Workflows Are Linked — Category Management">
        <DocInfoCard title="The Linkage Chain" icon="🔗">
          <p>Understanding how a product's category connects to its workflow is critical:</p>
          <DocFlowStep number={1} title="Product → Category" desc="Every product has a 'category' field (e.g., home_food, yoga_classes, plumbing)." />
          <DocFlowStep number={2} title="Category → category_config table" desc="The category_config table maps each category to its parent_group and transaction_type. Example: home_food → parent_group='food_beverages', transaction_type='cart_purchase'." />
          <DocFlowStep number={3} title="category_config → Workflow" desc="The transaction_type field directly maps to a workflow in category_status_flows. Example: transaction_type='cart_purchase' loads the cart purchase pipeline." />
          <DocFlowStep number={4} title="Seller's primary_group → Override Resolution" desc="The seller_profiles.primary_group field determines which parent_group to use when loading the workflow. If a specific override exists for that parent_group, it takes priority over the 'default' workflow." />
        </DocInfoCard>

        <DocInfoCard title="Category Config Fields That Control Workflow" icon="⚙️">
          <DocTable
            headers={['Field', 'Purpose', 'Example']}
            rows={[
              ['parent_group', 'Groups related categories (food_beverages, services, retail)', 'food_beverages'],
              ['transaction_type', 'Directly links to the workflow key in category_status_flows', 'cart_purchase'],
              ['requires_delivery', 'If true, delivery infrastructure is activated', 'true for food delivery'],
              ['enquiry_only', 'Forces contact_enquiry workflow regardless of transaction_type', 'true for contact-only listings'],
              ['is_negotiable', 'Enables quote/negotiation flow steps', 'true for custom services'],
              ['supports_cart', 'Enables cart-based checkout (cart_purchase / seller_delivery)', 'true for food, groceries'],
            ]}
          />
        </DocInfoCard>

        <DocInfoCard title="How to Change a Category's Workflow" icon="📝">
          <p><strong>Via Admin → Categories:</strong></p>
          <p>1. Open the category editor for the target category</p>
          <p>2. Find the <strong>"Linked Workflow"</strong> dropdown (populated from available transaction_types in category_status_flows)</p>
          <p>3. Select the desired workflow (e.g., change from cart_purchase to seller_delivery)</p>
          <p>4. Save — the change takes effect for all NEW orders in that category</p>
          <p className="mt-1"><strong>⚠️ Important:</strong> Changing a category's transaction_type does NOT affect existing orders. Existing orders retain their original workflow.</p>
        </DocInfoCard>

        <DocInfoCard title="listing_type_workflow_map — Advanced Mapping" icon="🗂️">
          <p>For categories where the same category can have multiple listing types (e.g., a yoga studio that offers both bookable classes and contact-only enquiries), the <code className="text-[10px] bg-muted px-1 rounded">listing_type_workflow_map</code> table provides fine-grained mapping:</p>
          <DocTable
            headers={['listing_type', 'Maps To transaction_type', 'When Used']}
            rows={[
              ['buy_now', 'cart_purchase', 'Standard product purchase'],
              ['add_to_cart', 'cart_purchase', 'Cart-based multi-item purchase'],
              ['schedule_visit', 'service_booking', 'Bookable appointment'],
              ['bookable_service', 'service_booking', 'Recurring service booking'],
              ['contact_only', 'contact_enquiry', 'Simple contact/enquiry'],
              ['request_callback', 'request_service', 'Request for quote/call'],
            ]}
          />
          <p className="mt-1">The UI button label the buyer sees (e.g., "Book Now", "Contact", "Add to Cart") is determined by the listing_type, which in turn determines which workflow is used.</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 5. WHICH ACTION TRIGGERS WHICH WORKFLOW */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="5. Which Action Triggers Which Workflow">
        <DocInfoCard title="Buyer Action → Workflow Mapping" icon="🎯">
          <p>When a buyer interacts with a listing, the <strong>button they tap</strong> determines which workflow is triggered:</p>
          <DocTable
            headers={['UI Button', 'listing_type', 'transaction_type', 'Initial Status']}
            rows={[
              ['Add to Cart / Buy Now', 'add_to_cart / buy_now', 'cart_purchase or seller_delivery', 'placed'],
              ['Book Now / Schedule Visit', 'schedule_visit / bookable_service', 'service_booking', 'booking_requested'],
              ['Contact Seller', 'contact_only', 'contact_enquiry', 'inquiry_sent'],
              ['Request Call / Request Service', 'request_callback', 'request_service', 'inquiry_sent'],
            ]}
          />
        </DocInfoCard>

        <DocInfoCard title="How fulfillment_type Splits cart_purchase" icon="🔀">
          <p>When a buyer places a cart order, the <strong>fulfillment type</strong> determines the sub-variant:</p>
          <p>• <code className="text-[10px] bg-muted px-1 rounded">fulfillment_type = 'delivery'</code> + <code className="text-[10px] bg-muted px-1 rounded">delivery_handled_by = 'platform'</code> → <strong>cart_purchase</strong> workflow (platform delivery with dedicated riders)</p>
          <p>• <code className="text-[10px] bg-muted px-1 rounded">fulfillment_type = 'delivery'</code> + <code className="text-[10px] bg-muted px-1 rounded">delivery_handled_by = 'seller'</code> → <strong>seller_delivery</strong> workflow (seller delivers themselves)</p>
          <p>• <code className="text-[10px] bg-muted px-1 rounded">fulfillment_type = 'self_pickup'</code> → <strong>self_fulfillment</strong> workflow (buyer picks up)</p>
          <p className="mt-1">This sub-variant resolution happens at order creation time and the result is stored in the order's <code className="text-[10px] bg-muted px-1 rounded">transaction_type</code> column.</p>
        </DocInfoCard>

        <DocInfoCard title="The resolveTransactionType() Function" icon="🔧">
          <p>This is the centralized resolution function used by both frontend and backend:</p>
          <p><strong>Priority order:</strong></p>
          <p>1. <strong>Stored transaction_type</strong> on the order → used as-is (new orders always have this)</p>
          <p>2. <strong>listing_type = 'contact_enquiry'</strong> → returns 'contact_enquiry'</p>
          <p>3. <strong>order_type = 'enquiry'</strong> → returns 'request_service' (or 'service_booking' for classes/events)</p>
          <p>4. <strong>order_type = 'booking'</strong> → returns 'service_booking'</p>
          <p>5. <strong>fulfillment_type = 'self_pickup'</strong> → returns 'self_fulfillment'</p>
          <p>6. <strong>fulfillment_type = 'seller_delivery' OR delivery_handled_by = 'seller'</strong> → returns 'seller_delivery'</p>
          <p>7. <strong>fulfillment_type = 'delivery' + delivery_handled_by = 'platform'</strong> → returns 'cart_purchase'</p>
          <p>8. <strong>Default</strong> → returns 'self_fulfillment'</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 6. OVERRIDE SYSTEM */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="6. Override System — Category-Specific Overrides">
        <DocInfoCard title="What Are Overrides?" icon="🎭">
          <p>The override system allows you to customize a workflow for a specific category group without affecting other categories.</p>
          <p className="mt-1"><strong>Example:</strong> The <code className="text-[10px] bg-muted px-1 rounded">default/seller_delivery</code> workflow has 6 steps. But for <code className="text-[10px] bg-muted px-1 rounded">food_beverages</code> sellers, you might want different steps (e.g., is_transit enabled on 'preparing' for live tracking during food prep).</p>
          <p className="mt-1">You create a <code className="text-[10px] bg-muted px-1 rounded">food_beverages/seller_delivery</code> override with the customized steps. Now all sellers with <code className="text-[10px] bg-muted px-1 rounded">primary_group = 'food_beverages'</code> use this override, while all other sellers continue using the default.</p>
        </DocInfoCard>

        <DocInfoCard title="Override Resolution Rules" icon="📐">
          <p><strong>When loading a workflow for an order:</strong></p>
          <DocFlowStep number={1} title="Get the seller's primary_group" desc="From seller_profiles.primary_group (e.g., 'food_beverages')." />
          <DocFlowStep number={2} title="Query for exact match" desc="Look for category_status_flows WHERE parent_group = 'food_beverages' AND transaction_type = 'seller_delivery'." />
          <DocFlowStep number={3} title="If rows found → USE THE OVERRIDE" desc="The override is a complete replacement, not a merge. All steps come from the override. The default is completely ignored." />
          <DocFlowStep number={4} title="If NO rows found → FALL BACK to default" desc="Query category_status_flows WHERE parent_group = 'default' AND transaction_type = 'seller_delivery'." />
          <p className="mt-2"><strong>⚠️ Critical implication:</strong> If you edit the <code className="text-[10px] bg-muted px-1 rounded">default/seller_delivery</code> workflow (e.g., enabling is_transit on 'preparing'), that change will NOT affect sellers in the <code className="text-[10px] bg-muted px-1 rounded">food_beverages</code> group if a <code className="text-[10px] bg-muted px-1 rounded">food_beverages/seller_delivery</code> override exists. You must edit the override directly.</p>
        </DocInfoCard>

        <DocInfoCard title="When Does an Override Take Priority?" icon="🏆">
          <DocTable
            headers={['Seller primary_group', 'Override Exists?', 'Workflow Used', 'Editing Default Affects This Seller?']}
            rows={[
              ['food_beverages', 'Yes (food_beverages/seller_delivery)', 'food_beverages override', '❌ No — override takes priority'],
              ['food_beverages', 'No', 'default/seller_delivery', '✅ Yes — no override, falls back to default'],
              ['retail', 'No', 'default/seller_delivery', '✅ Yes — falls back to default'],
              ['retail', 'Yes (retail/seller_delivery)', 'retail override', '❌ No — override takes priority'],
            ]}
          />
        </DocInfoCard>

        <DocInfoCard title="How to Identify Overrides in the Admin UI" icon="👁️">
          <p>In the <strong>Admin → Workflows</strong> page:</p>
          <p>• Each default workflow card shows override badges below it (e.g., <strong>"Override: Food Beverages · 10 steps"</strong>)</p>
          <p>• Override badges have an amber/warning color with a ⚠️ icon to make them prominent</p>
          <p>• Below each override badge: <em>"category override — these take priority over default"</em></p>
          <p>• When editing a default workflow that has overrides, a <strong>warning banner</strong> appears at the top of the editor listing which categories have overrides and won't be affected</p>
        </DocInfoCard>

        <DocInfoCard title="How to Create, Edit, or Delete an Override" icon="✏️">
          <p><strong>To create an override:</strong></p>
          <p>1. Go to Admin → Workflows</p>
          <p>2. Open the default workflow you want to override</p>
          <p>3. Click "Clone as Override" (if available) or create a new workflow with the target parent_group</p>
          <p className="mt-1"><strong>To edit an existing override:</strong></p>
          <p>1. Find the override badge under the default workflow card</p>
          <p>2. Click the badge (e.g., "Override: Food Beverages · 10")</p>
          <p>3. Edit the steps, flags, and transitions as needed</p>
          <p>4. Save</p>
          <p className="mt-1"><strong>To delete an override:</strong></p>
          <p>1. Click the override badge to open the editor</p>
          <p>2. Click the "Delete" button in the editor header</p>
          <p>3. Confirm deletion — sellers in that group will now fall back to the default workflow</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 7. FALLBACK & RESOLUTION LOGIC */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="7. Fallback & Resolution Logic">
        <DocInfoCard title="Complete Fallback Chain" icon="🔄">
          <p>The system has multiple fallback layers to ensure every order ALWAYS has a valid workflow:</p>
          <DocFlowStep number={1} title="Exact override match" desc="parent_group = seller's primary_group AND transaction_type = resolved workflow key. Example: food_beverages + seller_delivery." />
          <DocFlowStep number={2} title="Default fallback" desc="parent_group = 'default' AND transaction_type = resolved workflow key. Example: default + seller_delivery." />
          <DocFlowStep number={3} title="Frontend safe default" desc="If no flow loaded (race condition during async loading), frontend helpers use safe defaults: stepRequiresOtp defaults to TRUE for terminal delivery statuses (matching the DB trigger's safe default)." />
          <DocFlowStep number={4} title="DB trigger rejection" desc="If no valid transition exists in either override or default, the DB trigger rejects the status change with an error. The frontend catches this and re-fetches the order state." />
        </DocInfoCard>

        <DocInfoCard title="When Fallback Kicks In" icon="🔍">
          <DocTable
            headers={['Scenario', 'What Happens', 'Which Workflow Used']}
            rows={[
              ['New category created, no workflow configured', 'Falls back to default group', 'default/{transaction_type}'],
              ['Seller has no primary_group set', 'primary_group defaults to "default"', 'default/{transaction_type}'],
              ['Override exists but is empty (no steps)', 'Uses the empty override (this is a misconfiguration — fix it!)', '⚠️ Empty override blocks all transitions'],
              ['Seller changes primary_group', 'Next order uses new group workflow', 'New group override or default'],
              ['transaction_type column is NULL on order', 'Frontend resolves via resolveTransactionType()', 'Resolved dynamically from order attributes'],
            ]}
          />
        </DocInfoCard>

        <DocInfoCard title="Common Pitfall: Override Masks Default Changes" icon="⚠️" variant="warning">
          <p><strong>Problem:</strong> Admin edits the default seller_delivery workflow (e.g., enables is_transit on 'preparing'). But food_beverages sellers still don't see the map during preparing.</p>
          <p><strong>Cause:</strong> A food_beverages/seller_delivery override exists. Overrides are complete replacements — they don't merge with the default. The override still has is_transit=false on preparing.</p>
          <p><strong>Fix:</strong> Edit the override directly, or delete the override if you want all sellers to use the default.</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 8. BEHAVIORAL FLAGS */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="8. Behavioral Flags — is_transit, requires_otp, is_success">
        <DocInfoCard title="is_transit — Enables Live GPS Tracking" icon="🚚">
          <p>When a flow step has <code className="text-[10px] bg-muted px-1 rounded">is_transit = true</code>:</p>
          <p>• The <strong>Google Map</strong> with live rider/seller tracking is shown to the buyer</p>
          <p>• <strong>SellerGPSTracker</strong> activates for seller self-delivery (broadcasts seller's location)</p>
          <p>• <strong>ETA calculations</strong> begin based on distance to buyer</p>
          <p>• <strong>Dynamic Island / Live Activity</strong> updates on iOS</p>
          <p>• The step appears as a transit node in the timeline with a truck icon</p>
          <p className="mt-1"><strong>Configurable per override:</strong> You might want is_transit=true on 'preparing' for food delivery (so buyers see the map early) but is_transit=false for retail sellers (where preparation doesn't involve movement).</p>
        </DocInfoCard>

        <DocInfoCard title="requires_otp — Delivery Verification Gate" icon="🔐">
          <p>When a flow step has <code className="text-[10px] bg-muted px-1 rounded">requires_otp = true</code>:</p>
          <p>• The action button changes to <strong>"Verify & Deliver"</strong> instead of the normal "Mark {'{status}'}"</p>
          <p>• Clicking opens the <strong>OTP verification dialog</strong> where the delivery person enters the buyer's 4-digit code</p>
          <p>• The <strong>DB trigger</strong> (<code className="text-[10px] bg-muted px-1 rounded">enforce_delivery_otp_gate</code>) blocks direct status updates — only the <code className="text-[10px] bg-muted px-1 rounded">verify_delivery_otp_and_complete</code> RPC can transition through OTP-protected steps</p>
          <p>• <strong>Bulletproof frontend gate:</strong> If a delivery assignment exists and the next status is terminal, the OTP dialog is forced regardless of the requires_otp flag (catches race conditions). If the DB rejects with an OTP error, the dialog auto-opens.</p>
        </DocInfoCard>

        <DocInfoCard title="is_success — Terminal Success State" icon="✅">
          <p>When a flow step has <code className="text-[10px] bg-muted px-1 rounded">is_terminal = true AND is_success = true</code>:</p>
          <p>• The order is considered <strong>successfully completed</strong></p>
          <p>• <strong>Review prompt</strong> appears for the buyer</p>
          <p>• <strong>Settlement eligibility</strong> — payment can be released to seller</p>
          <p>• <strong>Celebration banner</strong> shown to buyer with delivery duration</p>
          <p>• <strong>Reorder button</strong> becomes available</p>
        </DocInfoCard>

        <DocInfoCard title="is_deprecated — Legacy Step Handling" icon="🏚️">
          <p>When a flow step has <code className="text-[10px] bg-muted px-1 rounded">is_deprecated = true</code>:</p>
          <p>• The step is <strong>hidden from new orders'</strong> timelines</p>
          <p>• If an existing order is IN this status, it still displays correctly</p>
          <p>• Used for graceful evolution: add new steps, deprecate old ones, existing orders can still complete their original flow via escape transitions</p>
        </DocInfoCard>

        <DocInfoCard title="creates_tracking_assignment — Auto-Create Delivery Assignment" icon="📍">
          <p>When a step has <code className="text-[10px] bg-muted px-1 rounded">creates_tracking_assignment = true</code>:</p>
          <p>• Transitioning to this step automatically creates a <code className="text-[10px] bg-muted px-1 rounded">delivery_assignments</code> row</p>
          <p>• OTP is generated, delivery fee calculated, and rider assignment begins</p>
        </DocInfoCard>

        <DocInfoCard title="is_side_action — Non-Linear Transitions" icon="↩️">
          <p>In the <code className="text-[10px] bg-muted px-1 rounded">category_status_transitions</code> table, some transitions are marked <code className="text-[10px] bg-muted px-1 rounded">is_side_action = true</code>:</p>
          <p>• These are <strong>not part of the primary forward progression</strong> (e.g., cancellation, rescheduling, no-show)</p>
          <p>• They appear as <strong>secondary buttons</strong> in the UI, not the primary CTA</p>
          <p>• The primary CTA only considers non-side-action transitions for determining the next step</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 9. WHAT HAPPENS WHEN ORDER IS CREATED */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="9. What Happens When an Order is Created">
        <DocInfoCard title="Step 1: Order Row Inserted" icon="📝">
          <p><strong>Actor:</strong> Buyer (via frontend)</p>
          <p>• A new row is inserted into <code className="text-[10px] bg-muted px-1 rounded">orders</code> with status = first step of the workflow</p>
          <p>• <code className="text-[10px] bg-muted px-1 rounded">transaction_type</code> is resolved and stored on the order at creation time</p>
          <p>• For cart purchases: <code className="text-[10px] bg-muted px-1 rounded">order_items</code> created, <code className="text-[10px] bg-muted px-1 rounded">cart_items</code> cleared</p>
          <p>• For bookings: <code className="text-[10px] bg-muted px-1 rounded">service_bookings</code> row created via atomic <code className="text-[10px] bg-muted px-1 rounded">book_service_slot()</code></p>
        </DocInfoCard>

        <DocInfoCard title="Step 2: Workflow Resolution" icon="🔍">
          <p><strong>Actor:</strong> System</p>
          <p>1. Product's category → category_config → parent_group + transaction_type</p>
          <p>2. Fulfillment type sub-variant applied (delivery vs pickup vs seller delivery)</p>
          <p>3. Stored on order as <code className="text-[10px] bg-muted px-1 rounded">transaction_type</code> (single source of truth for future queries)</p>
          <p>4. If category override exists for seller's primary_group → override used</p>
          <p>5. If no override → default workflow used</p>
        </DocInfoCard>

        <DocInfoCard title="Step 3: Notification Cascade" icon="🔔">
          <p>• Push notification to seller via FCM/APNs</p>
          <p>• NewOrderAlertOverlay activated (full-screen buzzer)</p>
          <p>• In-app notification queued</p>
          <p>• Seller response timer starts (auto-cancel if no response)</p>
          <p>• Notification content sourced from workflow step's notification_title and notification_body</p>
        </DocInfoCard>

        <DocInfoCard title="Step 4: Delivery Setup (for delivery orders)" icon="📍">
          <p>• Delivery address resolved from buyer's selected/default address</p>
          <p>• Delivery assignment NOT created yet (waits for seller to mark 'ready' or trigger step with creates_tracking_assignment=true)</p>
          <p>• For self_fulfillment: no delivery infrastructure involved</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 10. STATUS-BY-STATUS DEEP DIVE */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="10. Status-by-Status Deep Dive">
        <DocInfoCard title="placed / booking_requested / inquiry_sent (Initial)" icon="1️⃣">
          <p><strong>Triggered by:</strong> Buyer</p>
          <p><strong>Buyer sees:</strong> Confirmation + buyer_hint. Timeline step 1 highlighted.</p>
          <p><strong>Seller sees:</strong> Full-screen buzzer. Action buttons: Accept + Reject.</p>
          <p><strong>System:</strong> Response timer running. Audit log entry.</p>
        </DocInfoCard>

        <DocInfoCard title="accepted / confirmed" icon="2️⃣">
          <p><strong>Triggered by:</strong> Seller</p>
          <p><strong>Side effects:</strong> Push to buyer, timer cleared, preparation may start.</p>
          <p><strong>For bookings:</strong> Slot permanently locked. Calendar entry available.</p>
        </DocInfoCard>

        <DocInfoCard title="preparing" icon="3️⃣">
          <p><strong>Triggered by:</strong> Seller</p>
          <p><strong>If is_transit=true:</strong> Live map + GPS tracking activated (common for food delivery where seller is also delivering).</p>
          <p><strong>System:</strong> Stall detection active. Preparation time tracking if configured.</p>
        </DocInfoCard>

        <DocInfoCard title="ready / on_the_way / picked_up (Transit Steps)" icon="4️⃣">
          <p>Steps with <code className="text-[10px] bg-muted px-1 rounded">is_transit = true</code> activate GPS tracking and map view.</p>
          <p><strong>ready:</strong> Triggers delivery_assignment creation (if creates_tracking_assignment=true). Rider assigned.</p>
          <p><strong>picked_up / on_the_way:</strong> GPS broadcasting active. ETA calculations. Stall detection.</p>
        </DocInfoCard>

        <DocInfoCard title="delivered (OTP Verification)" icon="5️⃣">
          <p><strong>Triggered by:</strong> Delivery partner or seller (if self-delivery)</p>
          <p><strong>Process:</strong> OTP entered → verified against hash → status update → gate entry logged.</p>
          <p><strong>Bulletproof OTP:</strong> Even if frontend misses the requires_otp flag, the DB trigger blocks direct updates.</p>
        </DocInfoCard>

        <DocInfoCard title="completed (Terminal Success)" icon="✅">
          <p>Settlement eligible. Review prompt. Analytics updated. Coupon finalized.</p>
        </DocInfoCard>

        <DocInfoCard title="cancelled / failed / no_show (Terminal Failures)" icon="❌">
          <p><strong>cancelled:</strong> Refund triggered. Slot released (bookings). Both parties notified.</p>
          <p><strong>failed:</strong> Delivery failure. Reason + owner recorded. Re-delivery possible.</p>
          <p><strong>no_show:</strong> No-show fee applied. Rebook option offered.</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 11. DATA MODEL */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="11. Data Model Reference">
        <DocInfoCard title="category_status_flows — Pipeline Definition" icon="📊">
          <p>Each row = one status step in a workflow. Uniquely identified by (parent_group, transaction_type, status_key).</p>
        </DocInfoCard>
        <DocTable
          headers={['Column', 'Type', 'Purpose']}
          rows={[
            ['parent_group', 'text', 'Category group (default, food_beverages, services, retail, etc.)'],
            ['transaction_type', 'text', 'Workflow key (cart_purchase, seller_delivery, service_booking, etc.)'],
            ['status_key', 'text', 'Machine-readable status identifier (placed, accepted, preparing, etc.)'],
            ['sort_order', 'integer', 'Pipeline position — controls timeline display order'],
            ['display_label', 'text', 'Human-readable label shown in UI'],
            ['color', 'text', 'Badge color for UI rendering'],
            ['icon', 'text', 'Lucide icon name for timeline nodes'],
            ['actor', 'text', 'Primary actor(s) — supports comma-separated (e.g., "seller,delivery")'],
            ['is_terminal', 'boolean', 'If true, no further transitions allowed'],
            ['is_success', 'boolean', 'If true AND is_terminal, marks successful completion'],
            ['is_transit', 'boolean', 'If true, enables GPS tracking and map UI'],
            ['requires_otp', 'boolean', 'If true, requires OTP verification to transition through this step'],
            ['is_deprecated', 'boolean', 'If true, hidden from new orders but visible for existing ones'],
            ['creates_tracking_assignment', 'boolean', 'If true, auto-creates delivery_assignments row on transition'],
            ['buyer_hint', 'text', 'Contextual guidance shown to buyers at this status'],
            ['seller_hint', 'text', 'Contextual guidance shown to sellers'],
            ['notify_buyer', 'boolean', 'Whether to send push notification to buyer on transition'],
            ['notification_title', 'text', 'Push notification title for buyer'],
            ['notification_body', 'text', 'Push notification body for buyer'],
            ['notify_seller', 'boolean', 'Whether to send push notification to seller'],
          ]}
        />

        <DocInfoCard title="category_status_transitions — Transition Rules" icon="🔀">
          <p>Each row = one allowed status change. Multiple rows per status enable non-linear flows.</p>
        </DocInfoCard>
        <DocTable
          headers={['Column', 'Type', 'Purpose']}
          rows={[
            ['parent_group', 'text', 'Scoped to workflow group'],
            ['transaction_type', 'text', 'Scoped to workflow type'],
            ['from_status', 'text', 'Current status'],
            ['to_status', 'text', 'Target status'],
            ['allowed_actor', 'text', 'Who can perform this (buyer/seller/delivery/system/admin/any)'],
            ['is_side_action', 'boolean', 'If true, appears as secondary button, not primary CTA'],
          ]}
        />

        <DocInfoCard title="Workflow Resolution Priority" icon="🎯">
          <p>When the system needs to validate a transition:</p>
          <p>1. <strong>Exact match:</strong> (parent_group=food_beverages, transaction_type=seller_delivery, from→to)</p>
          <p>2. <strong>Default fallback:</strong> (parent_group=default, transaction_type=seller_delivery, from→to)</p>
          <p>3. <strong>Reject:</strong> No match → UPDATE rolled back with error</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 12. DB TRIGGER */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="12. DB Trigger — How Validation Works">
        <DocInfoCard title="validate_order_status_transition" icon="⚙️">
          <p>Fires on every UPDATE to orders where the status column changes.</p>
          <DocFlowStep number={1} title="Detect Change" desc="OLD.status ≠ NEW.status → trigger fires." />
          <DocFlowStep number={2} title="Resolve Workflow" desc="JOIN orders → products → category_config to get parent_group and transaction_type." />
          <DocFlowStep number={3} title="Query Override" desc="SELECT from transitions WHERE parent_group = [seller's group] AND from_status = OLD AND to_status = NEW." />
          <DocFlowStep number={4} title="Fallback Query" desc="If no rows: retry with parent_group = 'default'." />
          <DocFlowStep number={5} title="Decision" desc="Row found → ALLOW. No row → RAISE EXCEPTION and rollback." />
        </DocInfoCard>

        <DocInfoCard title="enforce_delivery_otp_gate" icon="🔐">
          <p>Separate trigger for OTP enforcement on delivery completion:</p>
          <p>1. Checks if delivery_assignment exists with non-null delivery_code</p>
          <p>2. Checks if the target step has requires_otp in the workflow</p>
          <p>3. If no workflow step found, <strong>defaults to requiring OTP</strong> (safe default)</p>
          <p>4. If OTP required, checks for <code className="text-[10px] bg-muted px-1 rounded">app.otp_verified</code> session flag</p>
          <p>5. If flag not set → REJECT the update</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 13. FRONTEND INTEGRATION */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="13. Frontend Integration — Hooks & UI">
        <DocInfoCard title="useCategoryStatusFlow(parentGroup, orderType, fulfillmentType, ...)" icon="🪝">
          <p>Loads the ordered status pipeline. Uses React Query with 5-minute staleTime for caching.</p>
          <p><strong>Override cascade:</strong> Fetches for exact parent_group first, falls back to 'default'.</p>
          <p><strong>Returns:</strong> flowSteps[] — array of step objects with all flags and labels.</p>
        </DocInfoCard>

        <DocInfoCard title="useStatusTransitions(parentGroup, transactionType)" icon="🪝">
          <p>Loads transition rules. Same override cascade as flow steps.</p>
          <p><strong>Used for:</strong> Determining action buttons, cancellation availability, side actions.</p>
        </DocInfoCard>

        <DocInfoCard title="Key Helper Functions" icon="🔧">
          <p>• <code className="text-[10px] bg-muted px-1 rounded">getNextStatusForActor(flow, currentStatus, actor, transitions)</code> — Returns the next valid status for a given actor</p>
          <p>• <code className="text-[10px] bg-muted px-1 rounded">getNextStatusForActors(flow, currentStatus, actors[], transitions)</code> — Multi-actor variant (seller who also delivers)</p>
          <p>• <code className="text-[10px] bg-muted px-1 rounded">getStepOtpType(flow, statusKey)</code> — Returns the typed OTP intent ('delivery' | null). Used by action bars to decouple delivery OTP from generic OTP.</p>
          <p>• <code className="text-[10px] bg-muted px-1 rounded">stepRequiresOtp(flow, statusKey)</code> — Thin wrapper: returns true if any OTP type is set. DB trigger is the safety net.</p>
          <p>• <code className="text-[10px] bg-muted px-1 rounded">isTerminalStatus(flow, status)</code> — Checks if status is terminal</p>
          <p>• <code className="text-[10px] bg-muted px-1 rounded">isSuccessfulTerminal(flow, status)</code> — Checks if terminal AND successful</p>
          <p>• <code className="text-[10px] bg-muted px-1 rounded">canActorCancel(transitions, currentStatus, actor)</code> — Checks cancellation availability</p>
          <p>• <code className="text-[10px] bg-muted px-1 rounded">getSideActionsForActor(transitions, currentStatus, actor)</code> — Returns side actions (reschedule, no-show, etc.)</p>
        </DocInfoCard>

        <DocInfoCard title="Where UI Reads Workflow Data" icon="🎨">
          <p>• <strong>OrderDetailPage</strong> — Timeline, step labels, buyer/seller hints, action bar, OTP dialog — all from workflow data</p>
          <p>• <strong>Seller Dashboard</strong> — Action buttons from transitions filtered by actor=seller</p>
          <p>• <strong>DeliveryActionCard</strong> — Delivery partner actions driven by workflow steps</p>
          <p>• <strong>Status Badges</strong> — Colors and icons from flow data, no hardcoded styling</p>
          <p>• <strong>Notifications</strong> — Title/body from workflow step's notification_title/notification_body</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 14. ADMIN WORKFLOW MANAGER — USER MANUAL */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="14. Admin Workflow Manager — Complete User Manual">
        <DocInfoCard title="Accessing the Workflow Manager" icon="🏠">
          <p><strong>Path:</strong> Profile → Admin Panel → Commerce section → Workflows</p>
          <p>Or navigate directly to the admin page and find the Workflows card.</p>
        </DocInfoCard>

        <DocInfoCard title="Workflow List View" icon="📋">
          <p>The main view shows all configured workflows as cards:</p>
          <p>• Each card shows the <strong>workflow name</strong> (e.g., "Cart Purchase"), <strong>parent_group</strong>, and <strong>step count</strong></p>
          <p>• <strong>Default workflows</strong> (parent_group='default') are the base configurations</p>
          <p>• <strong>Override badges</strong> appear below default cards — amber-colored badges with ⚠️ icon showing category-specific overrides</p>
          <p>• Click a default card to edit it. Click an override badge to edit that override specifically.</p>
        </DocInfoCard>

        <DocInfoCard title="Step Editor" icon="🔧">
          <p>When you open a workflow, you see a list of steps in order. For each step you can configure:</p>
          <DocTable
            headers={['Field', 'What It Does', 'Example']}
            rows={[
              ['status_key', 'Machine identifier (snake_case, cannot change after creation)', 'preparing'],
              ['display_label', 'What buyers/sellers see in timeline', 'Preparing Your Order'],
              ['sort_order', 'Position in pipeline (drag to reorder)', '3'],
              ['actor', 'Who triggers this step (supports comma-separated)', 'seller,delivery'],
              ['buyer_hint', 'Message shown to buyer at this status', 'Your food is being prepared'],
              ['seller_hint', 'Message shown to seller at this status', 'Prepare the items'],
              ['color', 'Badge color in UI', 'amber'],
              ['icon', 'Lucide icon name', 'flame'],
              ['is_terminal', 'Order cannot progress further', 'true for completed/cancelled'],
              ['is_success', 'Terminal + successful (enables review/settlement)', 'true for completed'],
              ['is_transit', 'Enables GPS tracking + map', 'true for on_the_way'],
              ['otp_type', 'OTP type: "delivery" (requires assignment + code) or null', '"delivery" for delivered step'],
              ['creates_tracking_assignment', 'Auto-creates delivery assignment', 'true for ready'],
              ['is_deprecated', 'Hide from new orders (legacy support)', 'false normally'],
            ]}
          />
        </DocInfoCard>

        <DocInfoCard title="Notification Configuration Per Step" icon="🔔">
          <p>Each step has notification settings:</p>
          <p>• <strong>notify_buyer</strong> — Toggle push notification to buyer</p>
          <p>• <strong>notification_title</strong> — Push title (e.g., "Order on the way!")</p>
          <p>• <strong>notification_body</strong> — Push body (e.g., "Your Dal Makhani is being delivered")</p>
          <p>• <strong>notification_action</strong> — Deep link action (e.g., open order detail page)</p>
          <p>• <strong>notify_seller</strong> — Toggle push notification to seller</p>
          <p>• <strong>seller_notification_title/body</strong> — Seller-specific notification content</p>
          <p className="mt-1">New categories automatically inherit notification settings from the default group via the <code className="text-[10px] bg-muted px-1 rounded">trg_inherit_notification_defaults</code> trigger.</p>
        </DocInfoCard>

        <DocInfoCard title="Transition Matrix" icon="🔀">
          <p>Below the step editor, the <strong>transition matrix</strong> shows all allowed transitions:</p>
          <p>• Each row represents a from_status → to_status combination</p>
          <p>• Configure which <strong>actor</strong> can perform each transition</p>
          <p>• Toggle <strong>is_side_action</strong> for secondary actions (cancel, reschedule)</p>
          <p>• The save process auto-generates missing forward transitions (sort_order N → N+1) so the pipeline always has a valid forward path</p>
        </DocInfoCard>

        <DocInfoCard title="Save Validations" icon="✅">
          <p>On save, the editor checks:</p>
          <p>• ✅ <strong>Terminal required</strong> — At least one step must be terminal</p>
          <p>• ✅ <strong>No duplicate keys</strong> — Each status_key must be unique</p>
          <p>• ⚠️ <strong>Orphan warning</strong> — Non-terminal step with no outgoing transitions</p>
          <p>• ⚠️ <strong>Backward flow warning</strong> — Transition from higher to lower sort_order (valid for reschedule, warning only)</p>
          <p>• 🔄 <strong>Transit status sync</strong> — Any change to is_transit flags auto-updates the system_settings.transit_statuses list</p>
        </DocInfoCard>

        <DocInfoCard title="Warning Banner for Default Workflows" icon="⚠️" variant="warning">
          <p>When editing a <strong>default</strong> workflow that has overrides, a warning banner appears:</p>
          <p><em>"This workflow has category overrides for: food_beverages, retail. Changes here won't affect those categories."</em></p>
          <p>This prevents the common mistake of editing the default and expecting it to affect overridden categories.</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 15. OTP VERIFICATION & DELIVERY GATE */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="15. OTP Verification & Delivery Gate">
        <DocInfoCard title="How OTP Works End-to-End" icon="🔐">
          <DocFlowStep number={1} title="OTP Generated" desc="When a delivery_assignment is created, a 4-digit delivery_code is generated and hashed. The plaintext code is visible to the buyer in their order detail page." />
          <DocFlowStep number={2} title="Buyer Shares Code" desc="The buyer sees a prominent OTP card in their order detail. They share the code with the delivery person only after receiving their items." />
          <DocFlowStep number={3} title="Delivery Person Enters Code" desc="The seller/rider taps 'Verify & Deliver' and enters the 4-digit code in the OTP dialog." />
          <DocFlowStep number={4} title="Atomic Verification" desc="The verify_delivery_otp_and_complete RPC: sets app.otp_verified flag, verifies the code against the hash, updates order status to 'completed', and clears the delivery assignment — all atomically." />
        </DocInfoCard>

        <DocInfoCard title="Three Layers of OTP Protection" icon="🛡️">
          <p><strong>Layer 1 — Typed OTP intent:</strong> <code className="text-[10px] bg-muted px-1 rounded">getStepOtpType(flow, nextStatus)</code> checks the <code className="text-[10px] bg-muted px-1 rounded">otp_type</code> column. If <code className="text-[10px] bg-muted px-1 rounded">'delivery'</code>, the action bar shows the OTP dialog ONLY when a <code className="text-[10px] bg-muted px-1 rounded">deliveryAssignmentId</code> exists. If no delivery context, a normal advance button is shown (DB trigger is safety net).</p>
          <p><strong>Layer 2 — Frontend delivery gate:</strong> If a delivery_assignment exists AND the next status is terminal (delivered/completed), the OTP dialog is forced regardless of the otp_type flag.</p>
          <p><strong>Layer 3 — DB trigger:</strong> <code className="text-[10px] bg-muted px-1 rounded">enforce_delivery_otp_gate</code> blocks any direct status update to delivered/completed if a delivery_code exists and app.otp_verified is not set. The <code className="text-[10px] bg-muted px-1 rounded">requires_otp</code> boolean column is auto-synced from <code className="text-[10px] bg-muted px-1 rounded">otp_type</code> for backward compatibility with this trigger.</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 16. NOTIFICATION TEMPLATES */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="16. Notification Templates">
        <DocInfoCard title="Database-Driven Notifications" icon="🔔">
          <p>Every workflow step can have notification templates configured directly in the workflow editor:</p>
          <p>• <strong>Buyer notifications:</strong> notify_buyer, notification_title, notification_body, notification_action</p>
          <p>• <strong>Seller notifications:</strong> notify_seller, seller_notification_title, seller_notification_body</p>
          <p>• Templates support variable interpolation (order ID, amounts, names)</p>
          <p>• The <code className="text-[10px] bg-muted px-1 rounded">trg_inherit_notification_defaults</code> trigger ensures new category overrides automatically inherit notification settings from the default group</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 17. CROSS-SYSTEM INTEGRATION */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="17. Cross-System Integration">
        <DocInfoCard title="Delivery System" icon="🚚">
          <p>• <strong>creates_tracking_assignment step</strong> → creates delivery_assignments row with OTP, fee, and rider assignment</p>
          <p>• <strong>is_transit steps</strong> → activate GPS tracking in delivery_locations</p>
          <p>• <strong>requires_otp steps</strong> → OTP verification, gate entry logging</p>
          <p>• <strong>Seller self-delivery:</strong> Seller acts as both seller and delivery actor. SellerGPSTracker broadcasts location during is_transit steps.</p>
        </DocInfoCard>

        <DocInfoCard title="Payment & Settlement" icon="💳">
          <p>• Orders become settlement-eligible at terminal success status (is_terminal + is_success)</p>
          <p>• Cancellations trigger refund logic</p>
          <p>• COD confirmation available after successful delivery</p>
        </DocInfoCard>

        <DocInfoCard title="Review System" icon="⭐">
          <p>• Reviews enabled after successful terminal status</p>
          <p>• Delivery-specific feedback also available for delivery orders</p>
          <p>• Review dimensions are category-specific (from category_config.review_dimensions)</p>
        </DocInfoCard>

        <DocInfoCard title="Audit Logging" icon="📝">
          <p>Every status transition logged in audit_log with: action type, actor_id, target_id, metadata (old/new status), timestamp.</p>
        </DocInfoCard>
      </DocSection>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* 18. TROUBLESHOOTING */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <DocSection title="18. Troubleshooting Guide">
        <DocInfoCard title="'Invalid status transition' error" icon="🔴">
          <p><strong>Cause:</strong> The transition from_status → to_status doesn't exist in the transitions table for the resolved workflow.</p>
          <p><strong>Fix:</strong> Check the transition matrix in the workflow editor. Ensure the transition exists for the correct actor. Verify the correct override/default is being used by checking the seller's primary_group.</p>
        </DocInfoCard>

        <DocInfoCard title="'Delivery OTP verification required' error" icon="🔴">
          <p><strong>Cause:</strong> The seller tried to mark an order as delivered/completed directly without going through OTP verification.</p>
          <p><strong>Why it happens:</strong> Frontend stepRequiresOtp returned false (flow not loaded or override mismatch), but the DB trigger defaults to requiring OTP. With the bulletproof fix, the frontend now auto-opens the OTP dialog when this error occurs.</p>
          <p><strong>Permanent fix:</strong> Ensure the delivered/completed step has requires_otp=true in the workflow. Check BOTH the default and any overrides.</p>
        </DocInfoCard>

        <DocInfoCard title="Edited default but sellers don't see the change" icon="🟡">
          <p><strong>Cause:</strong> An override exists for the seller's primary_group. Overrides completely replace the default — they don't merge.</p>
          <p><strong>Fix:</strong> Check for override badges under the default workflow card. Edit the override directly, or delete it to fall back to default.</p>
        </DocInfoCard>

        <DocInfoCard title="Map/GPS tracking not showing for seller" icon="🟡">
          <p><strong>Cause:</strong> The current step doesn't have is_transit=true in the workflow that applies to this seller.</p>
          <p><strong>Fix:</strong> Check which workflow is being used (default or override). Enable is_transit on the appropriate step. Remember to check the override if the seller belongs to a specific category group.</p>
        </DocInfoCard>

        <DocInfoCard title="New category has no workflow" icon="🟡">
          <p><strong>Cause:</strong> Normal and expected — the fallback to 'default' parent_group handles this automatically.</p>
          <p><strong>The system ensures every order always has a valid workflow.</strong> If you want a custom workflow for the new category, create an override in the workflow editor.</p>
        </DocInfoCard>

        <DocInfoCard title="Order stuck — no action buttons visible" icon="🟡">
          <p><strong>Possible causes:</strong></p>
          <p>1. No transition exists for the current actor from the current status → add it in the transition matrix</p>
          <p>2. Flow is still loading (async) → wait a moment, or check network errors</p>
          <p>3. The step is terminal → order is finished, no further actions</p>
          <p>4. Override is empty or misconfigured → check the override in the workflow editor</p>
        </DocInfoCard>

        <DocInfoCard title="Notifications not sending on status change" icon="🟡">
          <p><strong>Cause:</strong> The workflow step has notify_buyer=false or notification_title is empty.</p>
          <p><strong>Fix:</strong> Open the workflow step in the editor and configure the notification fields. For new overrides, check that notification settings were inherited from the default.</p>
        </DocInfoCard>
      </DocSection>
    </div>
  );
}
