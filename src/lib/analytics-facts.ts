/**
 * Write the business fact that Command Center and seller insights read.
 * Amplitude is notified separately. Phone and email never go in these props.
 */

import { onboardingStageFromStep } from '@/lib/marketplace-intelligence';

type FactProps = Record<string, string | number | boolean | null>;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

export type FactTarget =
  | 'product_views'
  | 'cart_add_log'
  | 'search_demand_log'
  | 'orders'
  | 'seller_onboarding_attempts';

const ORDER_EVENTS = new Set([
  'order_completed',
  'order_status_changed',
  'order_accepted',
  'order_rejected',
  'order_cancelled',
  'checkout_started',
]);

/** Where Command Center reads the fact. Amplitude uses the same event name. */
export function factTargetForEvent(eventName: string): FactTarget | null {
  if (eventName === 'product_viewed') return 'product_views';
  if (eventName === 'add_to_cart' || eventName === 'remove_from_cart') return 'cart_add_log';
  if (eventName === 'search_submitted' || eventName === 'search_no_results') return 'search_demand_log';
  if (ORDER_EVENTS.has(eventName)) return 'orders';
  if (eventName.startsWith('seller_onboarding_')) return 'seller_onboarding_attempts';
  return null;
}

export function onboardingStageForEvent(eventName: string, props: FactProps): string | null {
  if (eventName === 'seller_onboarding_started') return 'started';
  if (eventName === 'seller_onboarding_completed') return 'submitted';
  if (eventName === 'seller_onboarding_step_abandoned') return 'abandoned';
  if (
    eventName === 'seller_onboarding_step_started'
    || eventName === 'seller_onboarding_step_completed'
  ) {
    return onboardingStageFromStep(num(props.step));
  }
  return null;
}

export async function persistAnalyticsFact(eventName: string, props: FactProps): Promise<void> {
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    const target = factTargetForEvent(eventName);

    if (target === 'product_views' && text(props.product_id)) {
      await supabase.rpc('log_product_view_daily' as never, {
        p_product_id: text(props.product_id),
      } as never);
      return;
    }

    if (target === 'cart_add_log' && eventName === 'add_to_cart' && text(props.product_id)) {
      await supabase.rpc('log_cart_add' as never, {
        p_product_id: text(props.product_id),
        p_seller_id: text(props.seller_id),
        p_price: num(props.price),
        p_quantity: num(props.quantity) || 1,
      } as never);
      return;
    }

    // Search rows are written by log_committed_search before track().
    // Order rows are written by the order RPC before track(). Do not insert a second copy.
    if (target === 'search_demand_log' || target === 'orders') return;

    const stage = onboardingStageForEvent(eventName, props);
    if (!stage) return;
    let platform = 'web';
    try {
      const { Capacitor } = await import('@capacitor/core');
      platform = Capacitor.getPlatform();
    } catch {
      platform = 'web';
    }
    await supabase.rpc('touch_seller_onboarding_attempt' as never, {
      p_stage: stage,
      p_store_id: text(props.seller_id),
      p_platform: platform,
      p_source: text(props.source) || 'app',
    } as never);
  } catch {
    // Analytics facts are best-effort and must not block the screen.
  }
}
