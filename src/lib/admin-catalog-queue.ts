/**
 * Admin catalog queue rules.
 *
 * First-time store submission: listings stay on the application and go live
 * with one Approve click (see approveSeller).
 * After the store is live: new listings and edits go to the Products tab.
 */

export function isApprovedLiveStore(status: string | null | undefined): boolean {
  return status === 'approved';
}

/** True when the listing belongs to a store that is not live yet. */
export function isApplicationCatalogItem(sellerVerificationStatus: string | null | undefined): boolean {
  return !isApprovedLiveStore(sellerVerificationStatus);
}

export function splitPendingCatalogQueue<T extends { seller?: { verification_status?: string | null } | null }>(
  products: T[],
): { standalone: T[]; inApplication: T[] } {
  const standalone: T[] = [];
  const inApplication: T[] = [];
  for (const product of products) {
    if (isApprovedLiveStore(product.seller?.verification_status)) standalone.push(product);
    else inApplication.push(product);
  }
  return { standalone, inApplication };
}

export function pendingApplicationCatalogCount<T extends { approval_status?: string | null }>(
  products: T[],
): number {
  return products.filter((p) => p.approval_status === 'pending' || p.approval_status === 'draft').length;
}

export const ACTION_TYPE_LABEL: Record<string, string> = {
  add_to_cart: 'Cart',
  buy_now: 'Buy',
  book: 'Book',
  schedule_visit: 'Visit',
  request_quote: 'Enquiry',
  request_service: 'Enquiry',
  make_offer: 'Offer',
  contact_seller: 'Contact',
};
