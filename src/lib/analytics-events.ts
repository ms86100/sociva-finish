/**
 * Sociva Analytics Event Dictionary (v1 + journey v2).
 * Source of truth for product behaviour events sent via src/lib/analytics.ts.
 */

export type AnalyticsSource =
  | 'search'
  | 'home'
  | 'store'
  | 'deeplink'
  | 'reorder'
  | 'cart'
  | 'favorites'
  | 'category'
  | 'push'
  | 'unknown';

/** Become-seller v5 step keys (1-indexed step number maps via STEP_KEYS). */
export type SellerOnboardingStepKey =
  | 'intent_category'
  | 'subcategory'
  | 'listing'
  | 'store_submit';

export const SELLER_ONBOARDING_STEP_KEYS: readonly SellerOnboardingStepKey[] = [
  'intent_category',
  'subcategory',
  'listing',
  'store_submit',
] as const;

export function sellerOnboardingStepKey(step: number): SellerOnboardingStepKey | null {
  if (step < 1 || step > SELLER_ONBOARDING_STEP_KEYS.length) return null;
  return SELLER_ONBOARDING_STEP_KEYS[step - 1];
}

export type AnalyticsEventName =
  // Lifecycle
  | 'app_opened'
  | 'Viewed Home Page'
  | 'page_viewed'
  // Auth
  | 'login_started'
  | 'login_completed'
  | 'logout'
  // Search
  | 'search_submitted'
  | 'search_results_viewed'
  | 'search_no_results'
  | 'search_result_clicked'
  // Product
  | 'product_list_viewed'
  | 'product_viewed'
  | 'product_impression'
  | 'product_clicked'
  | 'seller_viewed'
  // Cart
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'quantity_changed'
  | 'cart_opened'
  | 'checkout_started'
  // Checkout / payment (mirror only — Supabase remains source of truth)
  | 'payment_started'
  | 'payment_success'
  | 'payment_failed'
  | 'order_completed'
  // Seller (v1 bookends + ops)
  | 'seller_onboarding_started'
  | 'seller_onboarding_completed'
  | 'product_created'
  | 'product_updated'
  | 'seller_dashboard_opened'
  | 'order_accepted'
  | 'order_rejected'
  // Seller onboarding journey (v2)
  | 'seller_onboarding_step_started'
  | 'seller_onboarding_step_completed'
  | 'seller_onboarding_step_abandoned'
  | 'seller_onboarding_step_back'
  | 'seller_onboarding_step_error'
  | 'seller_onboarding_validation_failed'
  | 'seller_intent_captured'
  | 'seller_category_selected'
  | 'seller_commerce_model_selected'
  | 'seller_commerce_model_changed'
  | 'seller_subcategory_selected'
  | 'seller_listing_draft_created'
  // Push (client attribution)
  | 'push_notification_received'
  | 'push_notification_opened'
  | 'app_opened_from_push'
  | 'push_action_clicked'
  // Wishlist
  | 'wishlist_toggled';

export const ANALYTICS_EVENT_NAMES = [
  'app_opened',
  'Viewed Home Page',
  'page_viewed',
  'login_started',
  'login_completed',
  'logout',
  'search_submitted',
  'search_results_viewed',
  'search_no_results',
  'search_result_clicked',
  'product_list_viewed',
  'product_viewed',
  'product_impression',
  'product_clicked',
  'seller_viewed',
  'add_to_cart',
  'remove_from_cart',
  'quantity_changed',
  'cart_opened',
  'checkout_started',
  'payment_started',
  'payment_success',
  'payment_failed',
  'order_completed',
  'seller_onboarding_started',
  'seller_onboarding_completed',
  'product_created',
  'product_updated',
  'seller_dashboard_opened',
  'order_accepted',
  'order_rejected',
  'seller_onboarding_step_started',
  'seller_onboarding_step_completed',
  'seller_onboarding_step_abandoned',
  'seller_onboarding_step_back',
  'seller_onboarding_step_error',
  'seller_onboarding_validation_failed',
  'seller_intent_captured',
  'seller_category_selected',
  'seller_commerce_model_selected',
  'seller_commerce_model_changed',
  'seller_subcategory_selected',
  'seller_listing_draft_created',
  'push_notification_received',
  'push_notification_opened',
  'app_opened_from_push',
  'push_action_clicked',
  'wishlist_toggled',
] as const satisfies readonly AnalyticsEventName[];

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

export function isAnalyticsEventName(name: string): name is AnalyticsEventName {
  return (ANALYTICS_EVENT_NAMES as readonly string[]).includes(name);
}
