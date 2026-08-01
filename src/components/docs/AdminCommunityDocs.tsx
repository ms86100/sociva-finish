// @ts-nocheck
import { DocSection, DocHero, DocInfoCard, DocTable, DocFlowStep } from './DocPrimitives';

export function AdminCommunityDocs() {
  return (
    <div className="space-y-2">
      <DocHero
        title="Administration & Community"
        description="This module covers the platform Admin Panel for system-wide management, Society Admin tools for community oversight, and all community features including bulletin board, disputes, help requests, visitor management, domestic help tracking, and gate security."
        badges={['Admin', 'Society Admin', '10+ Pages']}
      />

      {/* ─── ADMIN PANEL ─── */}
      <DocSection title="1. Admin Panel (/admin)">
        <p>The <strong>Admin Panel</strong> is the central management hub for platform administrators. It provides full control over users, sellers, products, categories, and system settings.</p>

        <DocInfoCard title="Navigation Structure" icon="🧭">
          <p>The admin panel uses a sticky top navigation bar with tabs. Some tabs show urgency badges when pending actions exist:</p>
          <p>• <strong>Dashboard</strong> — Overview statistics, pending action items, and platform health metrics.</p>
          <p>• <strong>Users</strong> — User management with verification workflow and role assignment.</p>
          <p>• <strong>Sellers</strong> — Seller application review, profile management, and license verification.</p>
          <p>• <strong>Products</strong> — Product approval queue and catalog oversight.</p>
          <p>• <strong>Services</strong> — Platform-wide service booking overview and monitoring.</p>
          <p>• <strong>Catalog</strong> — Category management, parent groups, attribute blocks, and license configuration.</p>
          <p>• <strong>Settings</strong> — Partitioned into Platform, Notifications, and System sub-tabs.</p>
        </DocInfoCard>

        <DocInfoCard title="User Management" icon="👥">
          <p>View all registered users with: name, email, society, flat number, verification status, and assigned roles.</p>
          <p><strong>Approval workflow:</strong> Pending users can be approved or rejected. Approved users gain access to the platform. Rejected users see an appropriate status message.</p>
          <p><strong>Role management:</strong> Roles are stored in the <code className="text-[10px] bg-muted px-1 rounded">user_roles</code> table (separate from profiles for security). Available roles: buyer, seller, admin, society_admin, security_officer, delivery_partner.</p>
          <p><strong>Society assignment:</strong> Users can be moved between societies if needed.</p>
        </DocInfoCard>

        <DocInfoCard title="Seller Management" icon="🏪">
          <p>Review seller applications with full profile details: business name, description, category selections, images, fulfillment mode, payment preferences, and draft product previews.</p>
          <p><strong>Verification workflow:</strong> Approve, reject (with reason), or request changes. Approved sellers become visible in the marketplace.</p>
          <p><strong>Food license review:</strong> Dedicated section for reviewing FSSAI documentation with approve/reject actions and status tracking.</p>
          <p><strong>Seller analytics:</strong> Per-seller order volume, rating, response time, and cancellation rate.</p>
        </DocInfoCard>

        <DocInfoCard title="Product Approval" icon="📦">
          <p>Queue of products awaiting approval with: product details, images, pricing, category, seller info, and specification blocks.</p>
          <p>Admins can approve, reject (with reason), or flag products for further review.</p>
          <p>Approved products immediately become visible in the marketplace.</p>
        </DocInfoCard>

        <DocInfoCard title="Services Overview" icon="📅">
          <p>Platform-wide view of all service bookings showing: summary stats (total, pending, confirmed, completed, no-shows, cancelled), and a detailed booking list with buyer name, seller name, date, time, and status.</p>
          <p>Useful for identifying sellers with high no-show rates or pending confirmations piling up.</p>
        </DocInfoCard>

        <DocInfoCard title="Catalog Manager" icon="📚">
          <p>The most powerful admin tool — controls how every category behaves across the entire platform:</p>
          <p>• <strong>Parent Groups</strong> — Top-level category groupings (Food & Kitchen, Services, Retail, etc.) with icons, sort order, and license requirements.</p>
          <p>• <strong>Categories</strong> — Per-category configuration: transaction type (cart, contact, book, etc.), layout type (food, ecommerce, service), feature toggles (add-ons, veg toggle, duration field, staff management, recurring bookings), UI labels and placeholders.</p>
          <p>• <strong>Attribute Blocks</strong> — Define specification block templates that sellers can use on products (e.g., "Dimensions", "Materials", "Warranty").</p>
          <p>• <strong>License Configuration</strong> — Configure which parent groups require seller licensing.</p>
          <p>Changes to category configuration immediately affect all sellers in that category.</p>
        </DocInfoCard>

        <DocInfoCard title="System Settings" icon="⚙️">
          <p><strong>Platform Settings:</strong> Platform name, app version, default country code, address field labels (block/flat customization), currency symbol, and branding.</p>
          <p><strong>Notification Settings:</strong> Push notification templates, delivery notification preferences, and in-app alert configuration.</p>
          <p><strong>System Settings:</strong> Platform fee percentage, auto-approval toggles (for residents and sellers), maintenance mode, feature flags per society, seller response timeout, and marketplace labels customization.</p>
          <p><strong>Marketplace Labels:</strong> Customizable text for all marketplace-facing strings (checkout messages, empty states, community support text) — allows non-technical admins to adjust copy without code changes.</p>
        </DocInfoCard>
      </DocSection>

      {/* ─── SOCIETY ADMIN ─── */}
      <DocSection title="2. Society Administration">
        <p>Society-level management tools for community administrators.</p>

        <DocInfoCard title="Resident Management" icon="🏠">
          <p>View and manage all residents: approve pending registrations, update flat/block assignments, deactivate accounts, and view resident activity metrics.</p>
          <p>Society admins can only manage residents within their own society (enforced by RLS).</p>
        </DocInfoCard>

        <DocInfoCard title="Society Settings" icon="⚙️">
          <p>Configure: auto-approve residents toggle, invite code requirement and current code, maximum admins allowed, society location (lat/lng for distance calculations), and feature toggles for community features (delivery management, visitor management, parcel tracking, etc.).</p>
        </DocInfoCard>

        <DocInfoCard title="Admin Team" icon="👤">
          <p>Manage society admin team: add/remove admins, assign community roles (chairman, secretary, treasurer, committee member). Admin limit is configurable and enforced by a database trigger — attempting to add beyond the limit returns an error.</p>
        </DocInfoCard>

        <DocInfoCard title="Society Dashboard" icon="📊">
          <p>Overview metrics: total members, active sellers, order volume, revenue, and community activity stats.</p>
          <p>Quick links to society-specific management pages: deliveries, visitors, bulletin, disputes, parcels, and finances.</p>
        </DocInfoCard>
      </DocSection>

      {/* ─── BULLETIN BOARD ─── */}
      <DocSection title="3. Bulletin Board (/bulletin)">
        <p>A society-wide communication platform for announcements, polls, events, and discussions.</p>

        <DocInfoCard title="Post Types" icon="📣">
          <p>• <strong>Announcement</strong> — General notices from admins or residents.</p>
          <p>• <strong>Poll</strong> — Multiple choice voting with configurable deadline. Poll options are stored as JSON with vote tracking.</p>
          <p>• <strong>Event</strong> — With date, location, and RSVP functionality (going/maybe/not going).</p>
          <p>• <strong>Discussion</strong> — Open forum threads for community conversation.</p>
        </DocInfoCard>

        <DocInfoCard title="Post Features" icon="💬">
          <p>Posts support: upvoting/downvoting (stored in <code className="text-[10px] bg-muted px-1 rounded">bulletin_votes</code>), threaded comments (<code className="text-[10px] bg-muted px-1 rounded">bulletin_comments</code>), file attachments (stored as URL arrays), pinning by admins (pinned posts appear first), archiving, and AI-generated summaries for long posts.</p>
          <p>Comment and vote counts are denormalized on the post record for fast rendering.</p>
          <p>RSVP tracking for events via the <code className="text-[10px] bg-muted px-1 rounded">bulletin_rsvps</code> table with status (going/maybe/not_going).</p>
        </DocInfoCard>
      </DocSection>

      {/* ─── DISPUTES ─── */}
      <DocSection title="4. Dispute Resolution (/disputes)">
        <p>A formal grievance resolution system for residents to raise issues within the community.</p>

        <DocInfoCard title="Ticket Submission" icon="📝">
          <p>Residents submit dispute tickets with: category (maintenance, noise, parking, safety, other), detailed description, photo evidence (multiple photos supported), and an <strong>anonymous submission option</strong>.</p>
          <p>An SLA deadline is automatically calculated and set based on the dispute category.</p>
        </DocInfoCard>

        <DocInfoCard title="Resolution Workflow" icon="🔄">
          <DocFlowStep number={1} title="Submitted" desc="Ticket created with auto-generated SLA deadline. Visible to society admins and committee." />
          <DocFlowStep number={2} title="Acknowledged" desc="Admin acknowledges receipt — timestamp recorded in acknowledged_at." />
          <DocFlowStep number={3} title="In Progress" desc="Committee discusses via internal notes (dispute_comments with is_committee_note flag). Regular comments are visible to the submitter." />
          <DocFlowStep number={4} title="Resolved" desc="Resolution note is added, resolved_at timestamp recorded, and the submitter is notified." />
        </DocInfoCard>
      </DocSection>

      {/* ─── VISITOR MANAGEMENT ─── */}
      <DocSection title="5. Visitor Management (/visitors)">
        <p>Digital gate entry system for managing visitor access to the society.</p>

        <DocInfoCard title="Pre-Registration" icon="🎫">
          <p>Residents can pre-register expected visitors with: name, phone, purpose, expected arrival time, and vehicle details.</p>
          <p>A unique entry QR code or OTP is generated for the visitor for contactless verification.</p>
        </DocInfoCard>

        <DocInfoCard title="Gate Entry" icon="🚪">
          <p>Security staff verify visitors via QR scan or OTP lookup. Entries are timestamped and logged with full audit trail.</p>
          <p>Visitor types are configurable per society (guest, delivery, cab, maintenance, etc.).</p>
          <p>Residents receive real-time push notifications when their visitors check in at the gate.</p>
        </DocInfoCard>

        <DocInfoCard title="Authorized Persons" icon="👥">
          <p>Residents can register <strong>authorized persons</strong> (family members, regular visitors) who have permanent access. Stored in the <code className="text-[10px] bg-muted px-1 rounded">authorized_persons</code> table with: name, phone, photo, relationship, and active/inactive status.</p>
        </DocInfoCard>

        <DocInfoCard title="Gate Entry Log" icon="📋">
          <p>Complete audit trail of all entries with: visitor name, flat visited, entry/exit times, verification method, and the security staff who processed the entry.</p>
        </DocInfoCard>
      </DocSection>

      {/* ─── GUARD KIOSK ─── */}
      <DocSection title="6. Guard Kiosk (/guard)">
        <p>A simplified, kiosk-mode interface designed for security staff at the gate with large touch targets.</p>
        <p>Features: QR code scanner for visitor verification, manual visitor entry form, worker attendance check-in/check-out, domestic help verification, and parcel logging.</p>
        <p>The interface is optimized for speed — one-tap operations with minimal navigation, suitable for high-traffic gate environments.</p>
      </DocSection>

      {/* ─── DOMESTIC HELP ─── */}
      <DocSection title="7. Domestic Help & Workers">
        <p>Management system for domestic workers (maids, cooks, drivers) in the society.</p>

        <DocInfoCard title="Worker Registry" icon="👷">
          <p>Residents register their domestic help via the <code className="text-[10px] bg-muted px-1 rounded">domestic_help_entries</code> table with: name, phone, photo, help type (maid, cook, driver, gardener, etc.), assigned flat number, and society association.</p>
          <p>Workers can be shared between multiple flats in the same society.</p>
        </DocInfoCard>

        <DocInfoCard title="Attendance Tracking" icon="📅">
          <p>Daily check-in/check-out tracking via the guard kiosk or resident app, stored in <code className="text-[10px] bg-muted px-1 rounded">domestic_help_attendance</code>.</p>
          <p>Each attendance record captures: date, check-in time, check-out time, the person who marked it, and the society.</p>
          <p>Monthly attendance summaries help with leave tracking and salary management.</p>
        </DocInfoCard>
      </DocSection>

      {/* ─── HELP REQUESTS ─── */}
      <DocSection title="8. Help Requests (/help)">
        <p>A community help board where residents can post requests and offer assistance.</p>
        <p>Requests are tagged by type (lending, carpooling, emergency, general help) and visible to all society members.</p>
        <p>Other residents can respond to help requests, with response count tracked and displayed.</p>
        <p>This feature is surfaced on the homepage via the <code className="text-[10px] bg-muted px-1 rounded">CommunityTeaser</code> component showing active help requests.</p>
      </DocSection>

      {/* ─── SOCIETY REPORTS ─── */}
      <DocSection title="9. Reports & Analytics">
        <p>Comprehensive analytics dashboards for society and platform administrators.</p>

        <DocInfoCard title="Society-Level Reports" icon="📊">
          <p>• <strong>Society Dashboard</strong> — Member count, active sellers, order volume, and revenue metrics.</p>
          <p>• <strong>Society Finances</strong> — Platform fee collection, settlement summaries, and financial health.</p>
          <p>• <strong>Activity Feed</strong> — Chronological log of all society activity (orders, bulletins, disputes, entries) via the <code className="text-[10px] bg-muted px-1 rounded">audit_log</code> table.</p>
          <p>• <strong>Top Products</strong> — Most ordered products within the society.</p>
          <p>• <strong>Search Demand</strong> — What residents are searching for, helping identify unmet needs.</p>
        </DocInfoCard>

        <DocInfoCard title="Audit Logging" icon="📝">
          <p>All significant actions are logged to the <code className="text-[10px] bg-muted px-1 rounded">audit_log</code> table with: action type, actor ID, target ID, target type, society ID, and metadata JSON.</p>
          <p>Old audit logs are periodically moved to <code className="text-[10px] bg-muted px-1 rounded">audit_log_archive</code> for performance.</p>
        </DocInfoCard>
      </DocSection>

      {/* ─── NOTIFICATIONS ─── */}
      <DocSection title="10. Notification System">
        <p>The platform uses a multi-channel notification system to keep all stakeholders informed.</p>

        <DocInfoCard title="Notification Channels" icon="🔔">
          <p>• <strong>Push Notifications</strong> — Delivered via FCM (Android) and APNs (iOS) for: new orders, order status changes, new messages, visitor check-ins, delivery updates, parcel arrivals, and appointment reminders.</p>
          <p>• <strong>In-App Notifications</strong> — Stored in <code className="text-[10px] bg-muted px-1 rounded">notification_queue</code> and displayed in the Notification Inbox with read/unread status.</p>
          <p>• <strong>Seller Alert Overlay</strong> — Full-screen new order buzzer with persistent audio alert for time-sensitive orders.</p>
        </DocInfoCard>

        <DocInfoCard title="Delivery Pipeline" icon="⚡">
          <p>Notifications follow a database-driven queue system:</p>
          <DocFlowStep number={1} title="Event Trigger" desc="An event (new order, status change, message) inserts a record into the notification_queue table." />
          <DocFlowStep number={2} title="Edge Function Processing" desc="Edge functions claim batches and deliver via FCM/APNs using device tokens from the device_tokens table." />
          <DocFlowStep number={3} title="Retry & Cleanup" desc="Failed deliveries trigger retries. Stale or invalid tokens are automatically cleaned to prevent wasted delivery attempts." />
        </DocInfoCard>

        <DocInfoCard title="Campaign System" icon="📢">
          <p>Admins can send targeted notifications via the <code className="text-[10px] bg-muted px-1 rounded">campaigns</code> table: selecting target societies or specific users, composing messages, and tracking delivery metrics (sent, failed, cleaned counts).</p>
        </DocInfoCard>

        <DocInfoCard title="Device Token Management" icon="📱">
          <p>The <code className="text-[10px] bg-muted px-1 rounded">device_tokens</code> table stores FCM tokens per user with: platform (android/ios/web), token value, optional APNs token, and timestamps. A <strong>Notification Health Check</strong> component on the Profile page diagnoses push notification issues.</p>
        </DocInfoCard>
      </DocSection>

      {/* ─── BUILDER PORTAL ─── */}
      <DocSection title="11. Builder Portal (/builder)">
        <p>A dedicated portal for real estate builders who manage multiple societies.</p>

        <DocInfoCard title="Builder Features" icon="🏗️">
          <p>• <strong>Multi-Society Management</strong> — Builders can manage announcements and updates across all their societies from one dashboard.</p>
          <p>• <strong>Construction Milestones</strong> — Post progress updates with photos, completion percentages, and stage labels via the <code className="text-[10px] bg-muted px-1 rounded">construction_milestones</code> table.</p>
          <p>• <strong>Builder Announcements</strong> — Society-specific announcements from the builder team.</p>
          <p>• <strong>Snag Management</strong> — Track and resolve construction defects reported by residents, with collective escalation support when multiple residents report similar issues.</p>
          <p>• <strong>Feature Packages</strong> — Builders can have specific feature packages assigned, controlling which capabilities are available in their societies.</p>
        </DocInfoCard>
      </DocSection>
    </div>
  );
}
