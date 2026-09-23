/**
 * Preserve a guest's intended commerce action across phone OTP.
 * Stored in sessionStorage so a refresh during OTP does not lose context.
 */

/** Draft captured before OTP so bookable services keep date/time after login. */
export type PendingBookingDraft = {
  date?: string; // yyyy-MM-dd
  time?: string;
  notes?: string;
  buyerAddress?: string;
  locationType?: string;
  step?: 'select' | 'review';
  addons?: Array<{ id: string; name: string; price: number }>;
  extras?: unknown[];
  recurring?: { enabled: boolean; frequency?: string };
};

export type PendingAuthAction =
  | {
      type: 'add_to_cart';
      productId: string;
      quantity?: number;
      extras?: unknown[];
      returnTo?: string;
    }
  | {
      type: 'checkout';
      returnTo?: string;
    }
  | {
      type: 'enquire' | 'book' | 'contact';
      productId?: string;
      sellerId?: string;
      actionType?: string;
      returnTo?: string;
      /** Present when type === 'book' - restores slot after OTP */
      bookingDraft?: PendingBookingDraft;
    };

const STORAGE_KEY = 'sociva_pending_auth_action';

/** Prefer an explicit return path, else a product detail URL when we have an id. */
export function resolvePendingReturnTo(action: PendingAuthAction, fallback = '/'): string {
  if (action.returnTo?.startsWith('/')) return action.returnTo;
  if (action.type === 'checkout') return '/cart';
  if (action.productId) return `/product/${action.productId}`;
  return fallback;
}

export function setPendingAuthAction(action: PendingAuthAction): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...action, savedAt: Date.now() }));
  } catch {
    // ignore quota / private mode
  }
}

export function peekPendingAuthAction(): PendingAuthAction | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingAuthAction & { savedAt?: number };
    if (parsed?.savedAt && Date.now() - parsed.savedAt > 60 * 60 * 1000) {
      clearPendingAuthAction();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function takePendingAuthAction(): PendingAuthAction | null {
  const action = peekPendingAuthAction();
  clearPendingAuthAction();
  return action;
}

export function clearPendingAuthAction(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function pendingAuthReturnPath(fallback = '/'): string {
  const action = peekPendingAuthAction();
  if (!action) return fallback;
  return resolvePendingReturnTo(action, fallback);
}
