// @ts-nocheck
/**
 * FALLBACK-ONLY mapping from category listing types to workflow engine keys.
 *
 * The canonical source of truth is the `listing_type_workflow_map` DB table.
 * This static map is used only during loading / offline states.
 *
 * Keep in sync with:
 *   - DB table `listing_type_workflow_map`
 *   - src/lib/resolveTransactionType.ts (runtime order resolution)
 */
export const LISTING_TYPE_TO_WORKFLOW_FALLBACK: Record<string, string> = {
  cart_purchase: 'cart_purchase',
  buy_now: 'cart_purchase',
  book_slot: 'service_booking',
  request_service: 'request_service',
  request_quote: 'request_service',
  contact_only: 'contact_enquiry',
  schedule_visit: 'service_booking',
};

// FULFILLMENT_DEPENDENT_TYPES removed — is_conditional flag in DB table is the source of truth

/**
 * Fallback lookup — only used when DB map is not yet loaded.
 * Prefer `getWorkflowKeyFromMap()` from useWorkflowMap.ts for DB-driven resolution.
 */
export function getWorkflowKey(listingType: string): string {
  return LISTING_TYPE_TO_WORKFLOW_FALLBACK[listingType] ?? 'cart_purchase';
}
