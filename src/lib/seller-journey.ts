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

/** Pick the store that needs the seller's attention first. */
export function pickSellerJourneyStore(
  profiles: JourneySellerProfile[] | null | undefined,
): SellerJourneyStore | null {
  const list = profiles || [];
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
      body: `${store.storeName} is with our team. You'll get a notification as soon as it's ready — usually within a day. Nothing more is needed from you right now.`,
      cta: 'See application',
      href: '/become-seller',
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
      href: '/become-seller',
    };
  }

  if (store.status === 'approved' && creditActivated === false) {
    return {
      kind: 'approved_recharge',
      sellerId: store.sellerId,
      storeName: store.storeName,
      rejectionNote: null,
      title: 'Your store is approved',
      body: `Welcome to selling on Sociva. Recharge Sociva Credits to make ${store.storeName} visible to buyers nearby.`,
      cta: 'Recharge credits',
      href: SELLER_CREDITS_ROUTE,
    };
  }

  return EMPTY_JOURNEY;
}

export const SELLER_JOURNEY_ACTION_LABELS: Record<string, string> = {
  store_submitted: 'See status',
  store_approved: 'Recharge credits',
  store_rejected: 'Update application',
  store_suspended: 'View store',
  credit_recharge_success: 'View credits',
  credit_recharge_failed: 'Try again',
};
