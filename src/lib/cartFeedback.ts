// @ts-nocheck
import { feedbackAddItem } from '@/lib/feedbackEngine';

/**
 * Backward-compatible re-export.
 * All new code should import directly from `feedbackEngine.ts`.
 */
export function triggerCartFeedback(productName: string) {
  feedbackAddItem(productName);
}
