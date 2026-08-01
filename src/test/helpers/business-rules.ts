/**
 * Shared business logic helpers for testing.
 * These mirror the real logic in app components and can be tested independently.
 */

// ── Feature Gate Logic ──────────────────────────────────────────────────────
export function getFeatureState(
  feature: { source: string; is_enabled: boolean; society_configurable: boolean } | null | undefined,
  hasSocietyContext: boolean
): 'enabled' | 'disabled' | 'locked' | 'unavailable' {
  if (!hasSocietyContext) return 'disabled';
  if (!feature) return 'unavailable';
  if (feature.source === 'core') return 'locked';
  if (!feature.society_configurable) return feature.is_enabled ? 'locked' : 'disabled';
  return feature.is_enabled ? 'enabled' : 'disabled';
}

export function isFeatureAccessible(state: ReturnType<typeof getFeatureState>): boolean {
  return state === 'enabled' || state === 'locked';
}

// ── Route Classification ────────────────────────────────────────────────────
export const PUBLIC_ROUTES = [
  '/welcome', '/auth', '/privacy-policy', '/terms',
  '/community-rules', '/help', '/pricing', '/reset-password',
];

export function isPublicRoute(route: string): boolean {
  return PUBLIC_ROUTES.includes(route);
}

// ── Role-Based Access ───────────────────────────────────────────────────────
export interface RoleContext {
  isAdmin: boolean;
  isSocietyAdmin: boolean;
  isSecurityOfficer: boolean;
  isSeller: boolean;
  isWorker: boolean;
  isBuilderMember: boolean;
}

export function hasGuardAccess(r: Pick<RoleContext, 'isAdmin' | 'isSocietyAdmin' | 'isSecurityOfficer'>): boolean {
  return r.isAdmin || r.isSocietyAdmin || r.isSecurityOfficer;
}

export function hasManagementAccess(r: Pick<RoleContext, 'isAdmin' | 'isSocietyAdmin'>): boolean {
  return r.isAdmin || r.isSocietyAdmin;
}

export function hasProgressManageAccess(r: Pick<RoleContext, 'isAdmin' | 'isSocietyAdmin' | 'isBuilderMember'>): boolean {
  return r.isAdmin || r.isSocietyAdmin || r.isBuilderMember;
}

export function canPostNotice(r: Pick<RoleContext, 'isAdmin' | 'isSocietyAdmin' | 'isBuilderMember'>): boolean {
  return r.isAdmin || r.isSocietyAdmin || r.isBuilderMember;
}

// ── Profile Menu ────────────────────────────────────────────────────────────
export function getProfileMenuItems(isSeller: boolean, isBuilderMember: boolean, isAdmin: boolean): string[] {
  const items: string[] = [];
  items.push(isSeller ? 'Seller Dashboard' : 'Become a Seller');
  if (isBuilderMember) items.push('Builder Dashboard');
  if (isAdmin) items.push('Admin Panel');
  return items;
}

// ── Verification ────────────────────────────────────────────────────────────
export function getVerificationState(profile: { verification_status: string } | null): 'pending' | 'approved' | 'loading' {
  if (!profile) return 'loading';
  return profile.verification_status === 'approved' ? 'approved' : 'pending';
}

// ── Financial Computations ──────────────────────────────────────────────────
export function computeFinanceSummary(
  expenses: { amount: number }[],
  income: { amount: number }[]
): { totalExpenses: number; totalIncome: number; balance: number; colorClass: string } {
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const totalIncome = income.reduce((s, i) => s + i.amount, 0);
  const balance = totalIncome - totalExpenses;
  return { totalExpenses, totalIncome, balance, colorClass: balance >= 0 ? 'text-success' : 'text-destructive' };
}

// ── Progress Computation ────────────────────────────────────────────────────
export function computeOverallProgress(
  towers: { current_percentage: number }[],
  milestones: { completion_percentage: number }[]
): number {
  if (towers.length > 0) return Math.round(towers.reduce((s, t) => s + t.current_percentage, 0) / towers.length);
  if (milestones.length > 0) return Math.max(...milestones.map(m => m.completion_percentage));
  return 0;
}

// ── Post Sorting ────────────────────────────────────────────────────────────
export function sortByPinAndDate<T extends { is_pinned: boolean; created_at: string }>(posts: T[]): T[] {
  return [...posts].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1;
    return b.created_at.localeCompare(a.created_at);
  });
}

// ── Delivery Fee ────────────────────────────────────────────────────────────
export function computeDeliveryFee(
  orderAmount: number, freeThreshold: number, baseFee: number, fulfillmentType: string
): number {
  if (fulfillmentType !== 'delivery') return 0;
  return orderAmount >= freeThreshold ? 0 : baseFee;
}

// ── Cart Grouping ───────────────────────────────────────────────────────────
export function groupBySeller<T extends { seller_id: string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  items.forEach(item => {
    if (!groups.has(item.seller_id)) groups.set(item.seller_id, []);
    groups.get(item.seller_id)!.push(item);
  });
  return groups;
}

// ── Pre-Checkout Validation ─────────────────────────────────────────────────
export function findUnavailableProducts(
  freshProducts: { id: string; is_available: boolean; approval_status: string }[],
  cartProductIds: string[]
): string[] {
  return cartProductIds.filter(pid => {
    const p = freshProducts.find(fp => fp.id === pid);
    return !p || !p.is_available || p.approval_status !== 'approved';
  });
}

// ── SLA Computation ─────────────────────────────────────────────────────────
export function computeSLADeadline(createdAt: Date, slaHours: number): Date {
  return new Date(createdAt.getTime() + slaHours * 60 * 60 * 1000);
}

export function isSLABreached(deadline: Date, now: Date = new Date()): boolean {
  return now > deadline;
}

// ── Absent Workers ──────────────────────────────────────────────────────────
export function computeAbsentWorkers(allWorkerIds: string[], attendanceWorkerIds: string[]): string[] {
  const present = new Set(attendanceWorkerIds);
  return allWorkerIds.filter(id => !present.has(id));
}

// ── Search Filters ──────────────────────────────────────────────────────────
export function hasActiveFilters(
  filters: { minRating: number; isVeg: boolean | null; categories: string[]; sortBy: string | null; priceRange: [number, number] },
  maxPrice: number
): boolean {
  return filters.minRating > 0 || filters.isVeg !== null || filters.categories.length > 0 ||
    filters.sortBy !== null || filters.priceRange[0] > 0 || filters.priceRange[1] < maxPrice;
}

// ── Seller Access ───────────────────────────────────────────────────────────
export function canAccessSellerDetail(params: {
  verificationStatus: string;
  sellerSocietyId: string;
  buyerSocietyId: string | null;
  sellBeyondCommunity: boolean;
}): boolean {
  if (params.verificationStatus !== 'approved') return false;
  if (params.buyerSocietyId && params.sellerSocietyId !== params.buyerSocietyId && !params.sellBeyondCommunity) return false;
  return true;
}

// ── Pagination ──────────────────────────────────────────────────────────────
export function paginationRange(page: number, pageSize: number) {
  return { start: page * pageSize, end: (page + 1) * pageSize - 1 };
}

// E5: Notification titles are now centralized in src/lib/order-notification-titles.ts
// Re-export from the single source of truth to keep tests in sync with DB trigger
export { getOrderNotifTitle } from '@/lib/order-notification-titles';

// ── Haversine Distance ──────────────────────────────────────────────────────
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Worker Entry Validation ─────────────────────────────────────────────────
export function validateWorkerEntry(worker: {
  status: string; deactivated_at: string | null; flat_count: number; active_days?: string[];
} | null): { valid: boolean; reason?: string } {
  if (!worker) return { valid: false, reason: 'Worker not found in this society' };
  if (worker.status !== 'active') return { valid: false, reason: `Worker status: ${worker.status}` };
  if (worker.deactivated_at) return { valid: false, reason: 'Worker has been deactivated' };
  if (worker.active_days) {
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
    if (!worker.active_days.includes(day)) return { valid: false, reason: `Not scheduled for today (${day})` };
  }
  if (worker.flat_count === 0) return { valid: false, reason: 'No active flat assignments' };
  return { valid: true };
}

// ── Coupon Validation ───────────────────────────────────────────────────────
export function isCouponApplicable(coupon: {
  is_active: boolean; society_id: string; expires_at: string | null;
  starts_at: string; usage_limit: number | null; times_used: number;
  per_user_limit: number; min_order_amount: number | null;
}, buyerSocietyId: string, orderAmount: number, userRedemptions: number, now: Date = new Date()): { applicable: boolean; reason?: string } {
  if (!coupon.is_active) return { applicable: false, reason: 'Coupon inactive' };
  if (coupon.society_id !== buyerSocietyId) return { applicable: false, reason: 'Cross-society' };
  if (coupon.expires_at && new Date(coupon.expires_at) <= now) return { applicable: false, reason: 'Expired' };
  if (new Date(coupon.starts_at) > now) return { applicable: false, reason: 'Not started' };
  if (coupon.usage_limit !== null && coupon.times_used >= coupon.usage_limit) return { applicable: false, reason: 'Usage limit reached' };
  if (userRedemptions >= coupon.per_user_limit) return { applicable: false, reason: 'Per-user limit reached' };
  if (coupon.min_order_amount !== null && orderAmount < coupon.min_order_amount) return { applicable: false, reason: 'Below minimum' };
  return { applicable: true };
}

// ── Write Safety (view-as) ──────────────────────────────────────────────────
export function getWriteSocietyId(profileSocietyId: string | null, effectiveSocietyId: string | null): string | null {
  return profileSocietyId || effectiveSocietyId || null;
}

export function getReadSocietyId(effectiveSocietyId: string | null, profileSocietyId: string | null): string | null {
  return effectiveSocietyId || profileSocietyId || null;
}

// ── Milestone Progress ──────────────────────────────────────────────────────
export function computeMilestoneProgress(
  milestones: { amount_percentage: number; status: string }[]
): { totalPercent: number; paidPercent: number; progressPercent: number } {
  const totalPercent = milestones.reduce((s, m) => s + m.amount_percentage, 0);
  const paidPercent = milestones.filter(m => m.status === 'paid').reduce((s, m) => s + m.amount_percentage, 0);
  const progressPercent = totalPercent > 0 ? Math.round((paidPercent / totalPercent) * 100) : 0;
  return { totalPercent, paidPercent, progressPercent };
}

// ── Inspection Score ────────────────────────────────────────────────────────
export function computeInspectionScore(
  items: { status: string }[]
): { checked: number; total: number; passed: number; failed: number; progress: number; score: number } {
  const total = items.length;
  const checked = items.filter(i => i.status !== 'not_checked').length;
  const passed = items.filter(i => i.status === 'pass').length;
  const failed = items.filter(i => i.status === 'fail').length;
  const progress = total > 0 ? Math.round((checked / total) * 100) : 0;
  const score = total > 0 ? Math.round((passed / total) * 100) : 0;
  return { checked, total, passed, failed, progress, score };
}

// ── Report Metrics ──────────────────────────────────────────────────────────
export function computeDisputeResolutionRate(opened: number, resolved: number): number {
  return opened > 0 ? Math.round((resolved / opened) * 100) : 0;
}

export function computeMaintenanceCollectionRate(collected: number, pending: number): number {
  const total = collected + pending;
  return total > 0 ? Math.round((collected / total) * 100) : 0;
}

export function categorizeResponseTime(hours: number): 'up' | 'neutral' | 'down' {
  if (hours <= 24) return 'up';
  if (hours <= 48) return 'neutral';
  return 'down';
}

// ── Society Dashboard Search ────────────────────────────────────────────────
export function dashboardItemMatchesSearch(
  item: { label: string; stat?: string; keywords?: string[] },
  query: string
): boolean {
  const haystack = [item.label, item.stat || '', ...(item.keywords || [])].join(' ').toLowerCase();
  return haystack.includes(query.toLowerCase());
}

// ── Seller Stats ────────────────────────────────────────────────────────────
export function computeCancellationRate(completed: number, cancelled: number): number {
  const total = completed + cancelled;
  return total > 0 ? Math.round((cancelled / total) * 100 * 10) / 10 : 0;
}

// ── Gate Token Logic ────────────────────────────────────────────────────────
export function isTokenExpired(issuedAtMs: number, ttlMs: number = 60_000, nowMs: number = Date.now()): boolean {
  return nowMs > issuedAtMs + ttlMs;
}

export function isNonceDuplicate(nonce: string, seenNonces: Set<string>): boolean {
  return seenNonces.has(nonce);
}

export function getSecurityModeStatus(mode: string): 'confirmed' | 'awaiting_confirmation' {
  return mode === 'basic' ? 'confirmed' : 'awaiting_confirmation';
}

// ── Manual Entry Validation ─────────────────────────────────────────────────
export function validateManualEntry(flatNumber: string, visitorName: string): { valid: boolean; reason?: string } {
  if (!flatNumber.trim()) return { valid: false, reason: 'Flat number is required' };
  if (!visitorName.trim()) return { valid: false, reason: 'Visitor name is required' };
  return { valid: true };
}

export const MANUAL_ENTRY_TRANSITIONS: Record<string, string[]> = {
  pending: ['approved', 'denied', 'expired'],
  approved: [],
  denied: [],
  expired: [],
};

// ── Visitor Management ──────────────────────────────────────────────────────
export const VISITOR_TRANSITIONS: Record<string, string[]> = {
  expected: ['checked_in', 'cancelled'],
  checked_in: ['checked_out'],
  checked_out: [],
  cancelled: [],
};

export function isOTPValid(otp: string): boolean {
  return /^\d{6}$/.test(otp);
}

export function isOTPExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt < now;
}

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── Parcel Management ───────────────────────────────────────────────────────
export function canLogParcel(residentId: string, authUid: string, isAdmin: boolean): boolean {
  return residentId === authUid || isAdmin;
}

export function filterParcelsByStatus<T extends { status: string }>(parcels: T[], status: string): T[] {
  return parcels.filter(p => p.status === status);
}

// ── Security Audit Metrics ──────────────────────────────────────────────────
export function computePercentage(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

export function computeAverageMs(times: number[]): number {
  return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
}

// ── Guard Confirmation Poller ───────────────────────────────────────────────
export function decrementCountdown(remaining: number, step: number = 1): number {
  return Math.max(remaining - step, 0);
}

export function isPollingIntervalValid(intervalMs: number): boolean {
  return intervalMs >= 4000 && intervalMs <= 5000;
}

// ── Order Status Machine ────────────────────────────────────────────────────
export const ALLOWED_ORDER_TRANSITIONS: Record<string, string[]> = {
  placed: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['picked_up', 'delivered', 'completed', 'cancelled'],
  picked_up: ['delivered', 'completed'],
  delivered: ['completed', 'returned'],
  completed: [],
  cancelled: [],
  returned: [],
  enquired: ['quoted', 'cancelled'],
  quoted: ['accepted', 'scheduled', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
};

export function isValidOrderTransition(from: string, to: string): boolean {
  return (ALLOWED_ORDER_TRANSITIONS[from] || []).includes(to);
}

export const TERMINAL_ORDER_STATES = ['completed', 'cancelled', 'returned'];

// ── Cart Computation ────────────────────────────────────────────────────────
export function computeCartTotal(items: { unit_price: number; quantity: number }[]): number {
  return items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
}

export function computeItemCount(items: { quantity: number }[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

export function computeMaxPrepTime(items: { prep_time_minutes?: number | null }[]): number {
  const times = items.map(i => i.prep_time_minutes ?? 0);
  return times.length > 0 ? Math.max(...times) : 0;
}

export function computeFinalAmount(subtotal: number, couponDiscount: number, deliveryFee: number): number {
  return Math.max(0, subtotal - couponDiscount + deliveryFee);
}

// ── Seller Onboarding ───────────────────────────────────────────────────────
export function isSellerProfileComplete(profile: {
  business_name?: string; categories?: string[]; cover_image_url?: string | null;
}): boolean {
  return !!(profile.business_name?.trim() && profile.categories?.length && profile.cover_image_url);
}

export function getSellerOnboardingStep(profile: {
  business_name?: string; categories?: string[]; cover_image_url?: string | null;
}): number {
  if (!profile.business_name?.trim()) return 1;
  if (!profile.categories?.length) return 2;
  if (!profile.cover_image_url) return 3;
  return 4; // complete
}

export function canSubmitSellerApplication(profile: {
  business_name?: string; categories?: string[]; cover_image_url?: string | null;
}): boolean {
  return isSellerProfileComplete(profile);
}

// ── Seller Badges ───────────────────────────────────────────────────────────
export function getSellerBadges(profile: {
  completed_order_count?: number; cancellation_rate?: number | null;
}): string[] {
  const badges: string[] = [];
  const orders = profile.completed_order_count ?? 0;
  if (orders === 0) badges.push('New Seller');
  if (orders > 2 && (profile.cancellation_rate ?? 0) === 0) badges.push('0% Cancellation');
  return badges;
}

// ── Payment Logic ───────────────────────────────────────────────────────────
export function isPaymentMethodAvailable(method: 'cod' | 'upi', seller: { accepts_cod: boolean; accepts_upi: boolean }): boolean {
  return method === 'cod' ? seller.accepts_cod : seller.accepts_upi;
}

export function computePlatformFee(amount: number, feePercent: number): { fee: number; net: number } {
  const fee = Math.round(amount * feePercent) / 100;
  return { fee, net: amount - fee };
}

// ── Delivery Assignment ─────────────────────────────────────────────────────
export function shouldAutoAssignDelivery(order: { fulfillment_type?: string; delivery_address?: string | null }): boolean {
  return order.fulfillment_type === 'delivery' && !!order.delivery_address;
}

export function isDeliveryCodeValid(code: string): boolean {
  return /^\d{4,6}$/.test(code);
}

// ── Subscription Logic ──────────────────────────────────────────────────────
export function isSubscriptionActive(sub: { status: string; expires_at?: string | null }, now: Date = new Date()): boolean {
  if (sub.status !== 'active') return false;
  if (sub.expires_at && new Date(sub.expires_at) < now) return false;
  return true;
}

export function getNextRenewalDate(startDate: string, intervalDays: number): Date {
  const d = new Date(startDate);
  d.setDate(d.getDate() + intervalDays);
  return d;
}

// ── Status Label Mapping ────────────────────────────────────────────────────
const ORDER_STATUS_LABEL_MAP: Record<string, string> = {
  placed: 'Order Placed', accepted: 'Accepted', preparing: 'Preparing',
  ready: 'Ready', picked_up: 'Picked Up', delivered: 'Delivered',
  completed: 'Completed', cancelled: 'Cancelled', enquired: 'Enquiry Sent',
  quoted: 'Quote Received', scheduled: 'Scheduled', in_progress: 'In Progress',
  returned: 'Returned',
};

export function getOrderStatusLabel(status: string): string {
  return ORDER_STATUS_LABEL_MAP[status] || 'Unknown';
}

const PAYMENT_STATUS_LABEL_MAP: Record<string, string> = {
  pending: 'Pending', paid: 'Paid', failed: 'Failed', refunded: 'Refunded',
};

export function getPaymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABEL_MAP[status] || 'Unknown';
}

const DELIVERY_STATUS_LABEL_MAP: Record<string, string> = {
  pending: 'Pending', assigned: 'Assigned', picked_up: 'Picked Up',
  in_transit: 'In Transit', delivered: 'Delivered', failed: 'Failed',
};

export function getDeliveryStatusLabel(status: string): string {
  return DELIVERY_STATUS_LABEL_MAP[status] || 'Unknown';
}

// ── Landing Page ────────────────────────────────────────────────────────────
export function parseLandingSlides(json: string): { title: string; image: string }[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s: any) => s && typeof s.title === 'string' && typeof s.image === 'string');
  } catch {
    return [];
  }
}

export function computePlatformStats(societies: number, sellers: number, categories: number): { label: string; value: number }[] {
  return [
    { label: 'Societies', value: societies },
    { label: 'Sellers', value: sellers },
    { label: 'Categories', value: categories },
  ];
}

// ── Society Dashboard ───────────────────────────────────────────────────────
export function computeAvgResponseHours(
  items: { created_at: string; acknowledged_at: string | null }[]
): number {
  const withAck = items.filter(i => i.acknowledged_at);
  if (withAck.length === 0) return 0;
  const totalHours = withAck.reduce((s, i) => {
    const diff = new Date(i.acknowledged_at!).getTime() - new Date(i.created_at).getTime();
    return s + diff / (1000 * 60 * 60);
  }, 0);
  return Math.round((totalHours / withAck.length) * 10) / 10;
}

export interface DashboardSection {
  label: string;
  feature?: string;
  adminOnly?: boolean;
  keywords?: string[];
}

export function filterDashboardSections(
  sections: DashboardSection[],
  isFeatureEnabled: (f: string) => boolean,
  isAdmin: boolean,
  isSocietyAdmin: boolean
): DashboardSection[] {
  return sections.filter(s => {
    if (s.adminOnly && !isAdmin && !isSocietyAdmin) return false;
    if (s.feature && !isFeatureEnabled(s.feature)) return false;
    return true;
  });
}

// ── Seller Visibility ───────────────────────────────────────────────────────
export function computeSellerVisibilityScore(profile: {
  business_name?: string; cover_image_url?: string | null;
  description?: string | null; categories?: string[];
  operating_days?: string[]; accepts_cod?: boolean; accepts_upi?: boolean;
}): number {
  let score = 0;
  if (profile.business_name?.trim()) score += 20;
  if (profile.cover_image_url) score += 20;
  if (profile.description?.trim()) score += 15;
  if (profile.categories?.length) score += 15;
  if (profile.operating_days?.length) score += 15;
  if (profile.accepts_cod || profile.accepts_upi) score += 15;
  return score;
}

// ── Builder Logic ───────────────────────────────────────────────────────────
export function canAccessBuilderDashboard(roles: string[]): boolean {
  return roles.includes('admin') || roles.includes('builder_member');
}

export function computeBuilderSocietyStats(societies: {
  pending_users: number; active_sellers: number; open_disputes: number; open_snags: number;
}[]): { totalPending: number; totalSellers: number; totalDisputes: number; totalSnags: number } {
  return societies.reduce((acc, s) => ({
    totalPending: acc.totalPending + s.pending_users,
    totalSellers: acc.totalSellers + s.active_sellers,
    totalDisputes: acc.totalDisputes + s.open_disputes,
    totalSnags: acc.totalSnags + s.open_snags,
  }), { totalPending: 0, totalSellers: 0, totalDisputes: 0, totalSnags: 0 });
}

// ── Order Type Classification ───────────────────────────────────────────────
export function classifyOrderType(actionType: string): string {
  const map: Record<string, string> = {
    add_to_cart: 'purchase', buy_now: 'purchase',
    book: 'booking', request_service: 'booking', schedule_visit: 'booking',
    request_quote: 'enquiry', contact_seller: 'enquiry', make_offer: 'enquiry',
  };
  return map[actionType] || 'purchase';
}

// ── Reorder Eligibility ─────────────────────────────────────────────────────
export function canReorder(orderStatus: string): boolean {
  return orderStatus === 'completed' || orderStatus === 'delivered';
}

// ── Product Approval ────────────────────────────────────────────────────────
export const PRODUCT_APPROVAL_STATES = ['draft', 'pending', 'approved', 'rejected'] as const;

export function isProductVisible(approvalStatus: string, isAvailable: boolean): boolean {
  return approvalStatus === 'approved' && isAvailable;
}

// ── Fulfillment Mode ────────────────────────────────────────────────────────
export const VALID_FULFILLMENT_MODES = ['self_pickup', 'seller_delivery', 'platform_delivery', 'pickup_and_seller_delivery', 'pickup_and_platform_delivery'] as const;

export function isValidFulfillmentMode(mode: string): boolean {
  return (VALID_FULFILLMENT_MODES as readonly string[]).includes(mode);
}

// ── Worker Job Statuses ─────────────────────────────────────────────────────
export const JOB_STATUSES = ['open', 'accepted', 'completed', 'cancelled', 'expired'] as const;
export const URGENCY_LEVELS = ['flexible', 'normal', 'urgent'] as const;

export function isValidJobStatus(status: string): boolean {
  return (JOB_STATUSES as readonly string[]).includes(status);
}

export function isValidUrgency(urgency: string): boolean {
  return (URGENCY_LEVELS as readonly string[]).includes(urgency);
}

export function isValidRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

// ── Worker Status ───────────────────────────────────────────────────────────
export const WORKER_STATUSES = ['active', 'suspended', 'blacklisted', 'under_review'] as const;
export const ENTRY_FREQUENCIES = ['daily', 'occasional', 'per_visit'] as const;

export function isValidWorkerStatus(status: string): boolean {
  return (WORKER_STATUSES as readonly string[]).includes(status);
}

export function isValidEntryFrequency(freq: string): boolean {
  return (ENTRY_FREQUENCIES as readonly string[]).includes(freq);
}

// ── Minimum Order Amount ────────────────────────────────────────────────────
export function meetsMinimumOrder(orderAmount: number, minAmount: number | null): boolean {
  if (minAmount === null || minAmount <= 0) return true;
  return orderAmount >= minAmount;
}

// ── Urgent Item Detection ───────────────────────────────────────────────────
export function hasUrgentItems(items: { is_urgent?: boolean }[]): boolean {
  return items.some(i => i.is_urgent === true);
}

// ── Trust Score ─────────────────────────────────────────────────────────────
export function computeTrustScore(seller: {
  rating: number; total_reviews: number; completed_order_count?: number;
  cancellation_rate?: number | null; verification_status: string;
}): number {
  let score = 0;
  if (seller.verification_status === 'approved') score += 30;
  score += Math.min(seller.rating * 5, 25);        // max 25
  score += Math.min(seller.total_reviews, 20);      // max 20
  score += Math.min((seller.completed_order_count ?? 0) / 5, 15); // max 15
  if ((seller.cancellation_rate ?? 100) < 5) score += 10;
  return Math.min(Math.round(score), 100);
}

export function getTrustBadge(score: number): 'gold' | 'silver' | 'bronze' | 'none' {
  if (score >= 80) return 'gold';
  if (score >= 60) return 'silver';
  if (score >= 40) return 'bronze';
  return 'none';
}

// ── Cross-Society Detection ─────────────────────────────────────────────────
export function isCrossSocietyOrder(sellerSocietyId: string | null, buyerSocietyId: string | null): boolean {
  if (!sellerSocietyId || !buyerSocietyId) return false;
  return sellerSocietyId !== buyerSocietyId;
}

// ── Budget Threshold ────────────────────────────────────────────────────────
export function isOverBudget(spent: number, budget: number): boolean {
  return budget > 0 && spent > budget;
}

// ── QA Ratio ────────────────────────────────────────────────────────────────
export function computeQAAnsweredRatio(questions: { answer?: string | null }[]): number {
  if (questions.length === 0) return 0;
  const answered = questions.filter(q => q.answer?.trim()).length;
  return Math.round((answered / questions.length) * 100);
}

// ── Security Mode Tabs ──────────────────────────────────────────────────────
export function getGuardTabs(securityMode: string): string[] {
  const base = ['QR Scan', 'Manual Entry', 'Delivery', 'Gate Log'];
  if (securityMode !== 'basic') base.splice(1, 0, 'Resident OTP', 'Visitor OTP');
  return base;
}

// ── Dispute Categories ──────────────────────────────────────────────────────
export const DISPUTE_CATEGORIES = ['maintenance', 'noise', 'parking', 'safety', 'cleanliness', 'billing', 'other'] as const;

export function isValidDisputeCategory(cat: string): boolean {
  return (DISPUTE_CATEGORIES as readonly string[]).includes(cat);
}

// ── Maintenance Due Status ──────────────────────────────────────────────────
export const MAINTENANCE_DUE_TRANSITIONS: Record<string, string[]> = {
  pending: ['paid', 'overdue'],
  overdue: ['paid'],
  paid: [],
};

export function isValidMaintenanceDueTransition(from: string, to: string): boolean {
  return (MAINTENANCE_DUE_TRANSITIONS[from] || []).includes(to);
}

// ── Delivery Hardening ──────────────────────────────────────────────────────
export const VALID_FAILURE_OWNERS = ['seller_fault', 'rider_fault', 'buyer_unavailable', 'guard_rejected'] as const;

export function isValidFailureOwner(owner: string): boolean {
  return (VALID_FAILURE_OWNERS as readonly string[]).includes(owner);
}

export const DELIVERY_STATUSES = ['pending', 'assigned', 'picked_up', 'at_gate', 'delivered', 'failed', 'cancelled'] as const;

export function isValidDeliveryStatus(status: string): boolean {
  return (DELIVERY_STATUSES as readonly string[]).includes(status);
}

export const OTP_BLOCKED_REGEN_STATUSES = ['at_gate', 'delivered'] as const;

export function canRegenerateOTP(status: string): boolean {
  return !(OTP_BLOCKED_REGEN_STATUSES as readonly string[]).includes(status);
}

export function isOTPLocked(attemptCount: number, maxAttempts: number): boolean {
  return attemptCount >= maxAttempts;
}

export function shouldSetAssignedAt(oldStatus: string, newStatus: string): boolean {
  return oldStatus === 'pending' && newStatus === 'assigned';
}

export function shouldSetAtGateAt(newStatus: string): boolean {
  return newStatus === 'at_gate';
}

// ── Payment Hardening ───────────────────────────────────────────────────────
export const VALID_PAYMENT_MODES = ['cod', 'upi', 'card'] as const;
export const VALID_PAYMENT_COLLECTIONS = ['online', 'doorstep'] as const;

export function isValidPaymentMode(mode: string): boolean {
  return (VALID_PAYMENT_MODES as readonly string[]).includes(mode);
}

export function isValidPaymentCollection(collection: string): boolean {
  return (VALID_PAYMENT_COLLECTIONS as readonly string[]).includes(collection);
}

export function isOrderAmountFrozen(razorpayOrderId: string | null): boolean {
  return razorpayOrderId !== null;
}

export function isDuplicateWebhook(existingPaymentId: string | null): boolean {
  return existingPaymentId !== null;
}
