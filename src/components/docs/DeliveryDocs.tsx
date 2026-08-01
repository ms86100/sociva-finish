// @ts-nocheck
import { DocSection, DocHero, DocInfoCard, DocFlowStep } from './DocPrimitives';

export function DeliveryDocs() {
  return (
    <div className="space-y-2">
      <DocHero
        title="Delivery & Logistics"
        description="This module covers society-level delivery monitoring, the delivery partner rider dashboard, admin partner management, and parcel tracking — ensuring smooth last-mile delivery within residential communities."
        badges={['Delivery', 'Admin', '4 Pages']}
      />

      {/* ─── SOCIETY DELIVERIES ─── */}
      <DocSection title="1. Society Deliveries (/society/deliveries)">
        <p>A society-level monitoring view of all deliveries within the community, accessible to society admins. This page is feature-gated — it only appears when <code className="text-[10px] bg-muted px-1 rounded">delivery_management</code> is enabled for the society.</p>

        <DocInfoCard title="Delivery Monitoring Tab" icon="🚚">
          <p>The <code className="text-[10px] bg-muted px-1 rounded">DeliveryMonitoringTab</code> component provides a real-time view of all delivery assignments for the society, showing:</p>
          <p>• Order details and seller/buyer information</p>
          <p>• Rider assignments with name, phone, and current status</p>
          <p>• Status progression: <strong>Pending</strong> → <strong>Assigned</strong> → <strong>Picked Up</strong> → <strong>At Gate</strong> → <strong>Delivered</strong></p>
          <p>• ETA estimates and distance tracking</p>
          <p>• Stalled delivery detection and alerts</p>
        </DocInfoCard>

        <DocInfoCard title="Delivery Assignment Data" icon="📊">
          <p>Each delivery assignment tracks comprehensive data:</p>
          <p>• <strong>Location tracking:</strong> Rider's last known lat/lng with timestamp and accuracy</p>
          <p>• <strong>Timing:</strong> Assigned at, pickup time, at-gate time, delivered time</p>
          <p>• <strong>Financials:</strong> Delivery fee, partner payout, platform margin</p>
          <p>• <strong>Verification:</strong> Delivery code (OTP) with hash, attempt count, and expiry</p>
          <p>• <strong>Failure handling:</strong> Failed reason, failure owner attribution, attempt count</p>
          <p>• <strong>External:</strong> External tracking ID for third-party logistics integration</p>
        </DocInfoCard>
      </DocSection>

      {/* ─── DELIVERY PARTNER DASHBOARD ─── */}
      <DocSection title="2. Delivery Partner Dashboard (/delivery/dashboard)">
        <p>The operational hub for delivery riders/partners. Also feature-gated under <code className="text-[10px] bg-muted px-1 rounded">delivery_management</code>.</p>

        <DocInfoCard title="Partner Identification" icon="🪪">
          <p>The system identifies delivery partners by matching the logged-in user's phone number against the <code className="text-[10px] bg-muted px-1 rounded">delivery_partner_pool</code> table. If found, the partner profile is loaded. If the user_id isn't linked yet, it's automatically linked on first visit.</p>
          <p>Non-partners see a friendly message: "Not a Delivery Partner — Contact your society admin to be added."</p>
        </DocInfoCard>

        <DocInfoCard title="Partner Status Card" icon="👤">
          <p>Shows: partner photo/avatar, name, total deliveries count, rating, and GPS tracking indicator (animated pulse when active).</p>
          <p>An <strong>Online/Offline toggle</strong> button controls the partner's availability status — only online partners receive new delivery requests.</p>
        </DocInfoCard>

        <DocInfoCard title="Pending Delivery Requests" icon="📥">
          <p>A special section showing unassigned deliveries available for acceptance. Each shows:</p>
          <p>• Seller business name</p>
          <p>• Buyer's block and flat number</p>
          <p>• Delivery fee amount</p>
          <p>• "Accept Delivery" button</p>
          <p>Accepting a delivery updates the assignment with the partner's details and changes status to "assigned".</p>
        </DocInfoCard>

        <DocInfoCard title="Active Delivery Flow" icon="🔄">
          <DocFlowStep number={1} title="Assigned" desc="Partner has accepted the delivery. Action: 'Mark Picked Up' button." />
          <DocFlowStep number={2} title="Picked Up" desc="Partner has collected from seller. GPS tracking starts automatically. Actions: 'At Gate' or 'Delivered' buttons." />
          <DocFlowStep number={3} title="At Gate" desc="Partner is at the society gate. Action: 'Mark Delivered' button." />
          <DocFlowStep number={4} title="Delivered" desc="Order handed to buyer. OTP verified. GPS tracking stops. Delivery moves to history." />
        </DocInfoCard>

        <DocInfoCard title="GPS Live Tracking" icon="📍">
          <p>When a delivery is in "picked_up" or "at_gate" status, the system automatically starts background GPS tracking using the <code className="text-[10px] bg-muted px-1 rounded">useBackgroundLocationTracking</code> hook.</p>
          <p>Location updates are sent to the <code className="text-[10px] bg-muted px-1 rounded">delivery_locations</code> table with: lat/lng, accuracy, heading, speed, and timestamp.</p>
          <p>A GPS indicator shows in the partner status card when tracking is active.</p>
          <p>If location permission is denied, an appropriate warning is shown.</p>
        </DocInfoCard>

        <DocInfoCard title="Delivery Details" icon="📋">
          <p>Each delivery card shows: seller name, buyer's block and flat number, buyer's phone, delivery creation date/time, order amount, delivery fee, and delivery code (OTP — only shown for non-delivered orders).</p>
        </DocInfoCard>

        <DocInfoCard title="Active/History Tabs" icon="📊">
          <p><strong>Active Tab</strong> — Deliveries in assigned, picked_up, or at_gate status.</p>
          <p><strong>History Tab</strong> — Completed deliveries (delivered, failed, cancelled) for reference.</p>
        </DocInfoCard>
      </DocSection>

      {/* ─── DELIVERY PARTNER MANAGEMENT ─── */}
      <DocSection title="3. Delivery Partner Management (/delivery/manage)">
        <p>Admin page for managing the society's delivery partner pool. Only accessible to society admins and platform admins.</p>

        <DocInfoCard title="Partner Pool List" icon="👥">
          <p>Lists all registered delivery partners with: name, phone, vehicle type (bike/cycle/car/foot), vehicle number, availability status toggle, rating, total deliveries, and photo.</p>
          <p>Admins can <strong>toggle active/inactive status</strong> and <strong>toggle availability</strong> per partner.</p>
        </DocInfoCard>

        <DocInfoCard title="Add New Partner" icon="➕">
          <p>A bottom sheet form to add delivery partners with fields:</p>
          <p>• Partner name (required)</p>
          <p>• Phone number (required)</p>
          <p>• Vehicle type (bike, cycle, car, foot) via dropdown</p>
          <p>• Vehicle number (optional)</p>
          <p>• Photo upload (optional)</p>
          <p>The partner is associated with the society and the adding admin is tracked.</p>
        </DocInfoCard>

        <DocInfoCard title="Partner Configuration" icon="⚙️">
          <p>The <code className="text-[10px] bg-muted px-1 rounded">delivery_partners</code> table supports external delivery service integration via API configuration, enabling both internal (society-managed) and external partner types.</p>
        </DocInfoCard>
      </DocSection>

      {/* ─── PARCEL MANAGEMENT ─── */}
      <DocSection title="4. Parcel Management (/parcels)">
        <p>Tracks parcels and packages arriving at the society for residents. Feature-gated under the <code className="text-[10px] bg-muted px-1 rounded">parcel_management</code> feature flag.</p>

        <DocInfoCard title="Parcel Status System" icon="📦">
          <p>Four statuses with color-coded badges:</p>
          <p>• <strong>Received</strong> (yellow) — Package logged at gate</p>
          <p>• <strong>Notified</strong> (blue) — Resident has been notified</p>
          <p>• <strong>Collected</strong> (green) — Resident picked up the parcel</p>
          <p>• <strong>Returned</strong> (gray) — Package returned to courier</p>
        </DocInfoCard>

        <DocInfoCard title="Parcel Logging" icon="📝">
          <p>Security staff or admins log incoming parcels with:</p>
          <p>• Recipient flat number (required — looked up from profiles)</p>
          <p>• Courier name (e.g., Amazon, Flipkart, Delhivery)</p>
          <p>• Tracking number</p>
          <p>• Package description</p>
          <p>The logged_by user and timestamp are recorded automatically.</p>
        </DocInfoCard>

        <DocInfoCard title="Tabs View" icon="📊">
          <p><strong>Pending Tab</strong> — Shows parcels in "received" or "notified" status awaiting collection.</p>
          <p><strong>Collected Tab</strong> — Shows parcels that have been picked up, with collection timestamp and collector info.</p>
          <p>A search function allows filtering parcels by flat number or courier name.</p>
        </DocInfoCard>

        <DocInfoCard title="Collection Tracking" icon="✅">
          <p>When a resident collects their parcel, it's marked with a timestamp and the collector's identity.</p>
          <p>Admins and security staff with appropriate permissions can update parcel status.</p>
        </DocInfoCard>
      </DocSection>
    </div>
  );
}