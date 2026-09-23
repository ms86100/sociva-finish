/**
 * Seller onboarding journey helpers - attach consistent step props for Amplitude funnels.
 */

import { track } from '@/lib/analytics';
import {
  type AnalyticsProps,
  type SellerOnboardingStepKey,
  sellerOnboardingStepKey,
} from '@/lib/analytics-events';

export const SELLER_ONBOARDING_FLOW_VERSION = '5';

export type SellerOnboardingStepAction =
  | 'started'
  | 'completed'
  | 'abandoned'
  | 'back'
  | 'error'
  | 'validation_failed';

const ACTION_EVENT = {
  started: 'seller_onboarding_step_started',
  completed: 'seller_onboarding_step_completed',
  abandoned: 'seller_onboarding_step_abandoned',
  back: 'seller_onboarding_step_back',
  error: 'seller_onboarding_step_error',
  validation_failed: 'seller_onboarding_validation_failed',
} as const;

export function trackSellerOnboardingStep(opts: {
  step: number;
  action: SellerOnboardingStepAction;
  sellerId?: string | null;
  stepKey?: SellerOnboardingStepKey | null;
  props?: AnalyticsProps;
}): void {
  const step_key = opts.stepKey ?? sellerOnboardingStepKey(opts.step);
  track(ACTION_EVENT[opts.action], {
    flow_version: SELLER_ONBOARDING_FLOW_VERSION,
    step: opts.step,
    step_key: step_key ?? undefined,
    seller_id: opts.sellerId ?? null,
    ...opts.props,
  });
}
