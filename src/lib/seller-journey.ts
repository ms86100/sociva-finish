import { SELLER_CREDITS_ROUTE } from '@/lib/sellerCredits';

export type SellerJourneyKind = 'none' | 'pending' | 'approved_recharge' | 'rejected';

export type SellerJourneyStore = {
  sellerId: string;
  storeName: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionNote: string | null;
};

export type SellerJourney = {
  kind: SellerJourneyKind;
  sellerId: string | null;
  storeName: string;
  rejectionNote: string | null;
  title: string;
  body: string;
  cta: string | null;
  href: string | null;
};

export type JourneySellerProfile = {
  id: string;
  business_name?: string | null;
  verification_status?: string | null;
  rejection_note?: string | null;
  is_available?: boolean | null;
};

const EMPTY_JOURNEY: SellerJourney = {
  kind: 'none',
  sellerId: null,
  storeName: '',
  rejectionNote: null,
  title: '',
  body: '',
  cta: null,
  href: null,
};

function storeNameOf(profile: JourneySellerProfile): string {
  const name = (profile.business_name || '').trim();
  return name || 'your store';
}

/**
 * QA / multi-store cleanup often renames dead stores with [ARCHIVED] / [HOLD].
 * Those must never drive the home "Update application" / recharge journey —
 * otherwise a live store is ignored while a shelved reject loops forever.
 */
export function isShelvedSellerStore(
  profile: Pick<JourneySellerProfile, 'business_name'> | null | undefined,
): boolean {
  const name = (profile?.business_name || '').trim();
  return /^\[(ARCHIVED|HOLD)\]/i.test(name);
}

/** Active stores only — excludes shelved [ARCHIVED]/ [HOLD] names. */
export function actionableSellerProfiles(
  profiles: JourneySellerProfile[] | null | undefined,
): JourneySellerProfile[] {
  return (profiles || []).filter((p) => !isShelvedSellerStore(p));
}

/**
 * Pending/rejected store that should block default `#/become-seller` with a status screen.
 * Shelved [ARCHIVED]/[HOLD] rows must never win — otherwise multi-store sellers land on
 * “Application Not Approved” for cleanup leftovers (Wave 9 residual).
 */
export function pickBecomeSellerBlockingStore(
  profiles: JourneySellerProfile[] | null | undefined,
): JourneySellerProfile | null {
  return (
    actionableSellerProfiles(profiles).find(
      (s) => s.verification_status === 'rejected' || s.verification_status === 'pending',
    ) ?? null
  );
}

/** Buyer/seller-facing label without internal [ARCHIVED] / [HOLD] prefixes. */
export function displaySellerStoreName(
  name: string | null | undefined,
  fallback = 'Seller',
): string {
  const raw = (name || '').trim();
  if (!raw) return fallback;
  const cleaned = raw.replace(/^\[(ARCHIVED|HOLD)\]\s*/i, '').trim();
  return cleaned || fallback;
}

/**
 * Default store for seller dashboard / auth bootstrap.
 * Prefer non-shelved approved → pending → any actionable; never sticky-default to [ARCHIVED]/[HOLD]
 * when a live store exists. Portfolio sentinel must be handled by the caller.
 */
export function pickDefaultSellerStoreId(
  profiles: JourneySellerProfile[] | null | undefined,
  preferredId?: string | null,
): string | null {
  const list = profiles || [];
  if (list.length === 0) return null;

  const actionable = actionableSellerProfiles(list);
  const pool = actionable.length > 0 ? actionable : list;

  if (preferredId) {
    const preferred = list.find((p) => p.id === preferredId);
    if (preferred && !isShelvedSellerStore(preferred)) return preferred.id;
    if (preferred && isShelvedSellerStore(preferred) && actionable.length === 0) {
      return preferred.id;
    }
  }

  const approved = pool.find((p) => p.verification_status === 'approved');
  if (approved) return approved.id;
  const pending = pool.find((p) => p.verification_status === 'pending');
  if (pending) return pending.id;
  return pool[0]?.id ?? null;
}

/** Pick the store that needs the seller's attention first. */
export function pickSellerJourneyStore(
  profiles: JourneySellerProfile[] | null | undefined,
): SellerJourneyStore | null {
  const list = actionableSellerProfiles(profiles);
  const rejected = list.find((p) => p.verification_status === 'rejected');
  if (rejected) {
    return {
      sellerId: rejected.id,
      storeName: storeNameOf(rejected),
      status: 'rejected',
      rejectionNote: rejected.rejection_note?.trim() || null,
    };
  }
  const pending = list.find((p) => p.verification_status === 'pending');
  if (pending) {
    return {
      sellerId: pending.id,
      storeName: storeNameOf(pending),
      status: 'pending',
      rejectionNote: null,
    };
  }
  const approved = list.find((p) => p.verification_status === 'approved');
  if (approved) {
    return {
      sellerId: approved.id,
      storeName: storeNameOf(approved),
      status: 'approved',
      rejectionNote: null,
    };
  }
  return null;
}

export function resolveSellerJourney(
  profiles: JourneySellerProfile[] | null | undefined,
  creditActivated?: boolean | null,
): SellerJourney {
  const store = pickSellerJourneyStore(profiles);
  if (!store) return EMPTY_JOURNEY;

  if (store.status === 'pending') {
    return {
      kind: 'pending',
      sellerId: store.sellerId,
      storeName: store.storeName,
      rejectionNote: null,
      title: "We're reviewing your store",
      body: `${store.storeName} is with our team. You'll get a notification when review finishes — usually within a day. Open the Seller Dashboard anytime to finish location, payments, and photos.`,
      cta: 'Finish store details',
      href: '/seller',
    };
  }

  if (store.status === 'rejected') {
    return {
      kind: 'rejected',
      sellerId: store.sellerId,
      storeName: store.storeName,
      rejectionNote: store.rejectionNote,
      title: 'We need a small update',
      body: store.rejectionNote
        ? `We couldn't approve ${store.storeName} yet. ${store.rejectionNote}`
        : `We couldn't approve ${store.storeName} yet. Update your application and resubmit when you're ready.`,
      cta: 'Update application',
      href: `/become-seller?seller=${encodeURIComponent(store.sellerId)}`,
    };
  }

  if (store.status === 'approved') {
    // Unknown/loading must not flash "approved" for stores that are already live.
    if (creditActivated == null) return EMPTY_JOURNEY;
    if (creditActivated !== true) {
      return {
        kind: 'approved_recharge',
        sellerId: store.sellerId,
        storeName: store.storeName,
        rejectionNote: null,
        title: 'Your store is approved',
    body: `Welcome to selling on Sociva. Buyers cannot find ${store.storeName} in search until you recharge Sociva Credits.`,
        cta: 'Recharge credits',
        href: SELLER_CREDITS_ROUTE,
      };
    }
  }

  return EMPTY_JOURNEY;
}

/** Inbox types already covered by SellerJourneyBanner — hide to avoid duplicate / stale home cards. */
export function isSellerJourneyDuplicateNotification(
  journeyKind: SellerJourneyKind,
  notificationType: string | null | undefined,
  profiles?: JourneySellerProfile[] | null,
): boolean {
  if (!notificationType) return false;
  if (journeyKind === 'pending' && notificationType === 'seller_store_submitted') return true;
  if (journeyKind === 'approved_recharge' && notificationType === 'seller_approved') return true;
  if (notificationType === 'seller_approved') {
    const list = actionableSellerProfiles(profiles);
    if (list.some((p) => p.verification_status === 'approved')) return true;
  }
  if (journeyKind === 'rejected' && notificationType === 'seller_rejected') return true;
  // Submit notice is stale once admin has decided (or credits are already live)
  if (notificationType === 'seller_store_submitted') {
    const list = actionableSellerProfiles(profiles);
    if (list.some((p) => p.verification_status === 'approved' || p.verification_status === 'rejected')) {
      return true;
    }
  }
  return false;
}

export const SELLER_JOURNEY_ACTION_LABELS: Record<string, string> = {
  store_submitted: 'See status',
  store_approved: 'Recharge credits',
  store_rejected: 'Update application',
  store_suspended: 'View store',
  credit_recharge_success: 'View credits',
  credit_recharge_failed: 'Try again',
};
