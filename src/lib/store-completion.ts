/**
 * Store completion checklist for sellers (especially pending / incomplete stores).
 * Pure helpers — safe to unit test.
 */

export interface StoreCompletionInput {
  businessName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  societyId?: string | null;
  profileImageUrl?: string | null;
  coverImageUrl?: string | null;
  acceptsUpi?: boolean | null;
  upiId?: string | null;
  fulfillmentMode?: string | null;
  productCount?: number;
  verificationStatus?: string | null;
  defaultActionType?: string | null;
}

export interface StoreCompletionItem {
  key: string;
  label: string;
  done: boolean;
  href?: string;
}

export interface StoreCompletionResult {
  percent: number;
  items: StoreCompletionItem[];
  missing: StoreCompletionItem[];
}

export function computeStoreCompletion(input: StoreCompletionInput): StoreCompletionResult {
  const isBook =
    String(input.defaultActionType || '').includes('book') ||
    input.defaultActionType === 'book';
  const isCart =
    input.defaultActionType === 'add_to_cart' ||
    input.defaultActionType === 'buy_now';

  const items: StoreCompletionItem[] = [
    {
      key: 'business_name',
      label: 'Business / store name',
      done: !!String(input.businessName || '').trim() && String(input.businessName).trim() !== 'Untitled store',
      href: '/seller/settings',
    },
    {
      key: 'location',
      label: 'Store location',
      done: input.latitude != null && input.longitude != null,
      href: '/seller/settings',
    },
    {
      key: 'listing',
      label: 'At least one product / service / listing',
      done: (input.productCount || 0) >= 1,
      href: '/seller/products',
    },
    {
      key: 'profile_image',
      label: 'Store profile photo',
      done: !!input.profileImageUrl,
      href: '/seller/settings',
    },
  ];

  if (isCart) {
    items.push({
      key: 'fulfillment',
      label: 'Fulfillment mode',
      done: !!input.fulfillmentMode,
      href: '/seller/settings',
    });
    items.push({
      key: 'upi',
      label: 'UPI for online payments (optional)',
      done: !input.acceptsUpi || !!String(input.upiId || '').trim(),
      href: '/seller/settings',
    });
  }

  if (isBook) {
    items.push({
      key: 'hours',
      label: 'Availability hours (review in settings)',
      done: true, // hours have defaults; surface as info once location+name done
      href: '/seller/settings',
    });
  }

  const required = items.filter((i) => i.key !== 'upi' && i.key !== 'hours' && i.key !== 'profile_image');
  const optionalWeight = items.filter((i) => i.key === 'profile_image' || i.key === 'upi');
  const doneRequired = required.filter((i) => i.done).length;
  const doneOptional = optionalWeight.filter((i) => i.done).length;
  const percent = Math.round(
    ((doneRequired + doneOptional * 0.5) / (required.length + optionalWeight.length * 0.5)) * 100,
  );

  return {
    percent: Math.max(0, Math.min(100, percent)),
    items,
    missing: items.filter((i) => !i.done),
  };
}
