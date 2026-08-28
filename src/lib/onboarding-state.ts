/**
 * Pure onboarding state helpers — safe to unit test without React/Supabase.
 */
import type { SubcategoryPreferences } from '@/hooks/useSellerApplication';
import { NEW_ONBOARDING_TOTAL_STEPS } from '@/lib/listing-intent';

export const ONBOARDING_META_VERSION = 1;

export interface OnboardingMeta {
  v: number;
  step?: number;
  commerce_model?: string;
  seed_product_name?: string;
  listing_intent_phrase?: string;
  soft_listing_tag?: string;
  onboarding_version?: string;
}

export interface OnboardingFormBackup {
  userId: string;
  formData: Record<string, unknown>;
  selectedGroup: string;
  step: number;
  commerceModel?: string;
  seedProductName?: string;
  listingIntentPhrase?: string;
  softListingTag?: string;
  onboardingVersion?: string;
  savedAt: number;
}

export function clampOnboardingStep(step: number): number {
  return Math.max(1, Math.min(step, NEW_ONBOARDING_TOTAL_STEPS));
}

/** Restore step from backup — never force step 5+. */
export function restoreStepFromBackup(backupStep: number | undefined | null): number {
  return clampOnboardingStep(Number(backupStep) || 1);
}

export function buildOnboardingMeta(input: {
  step?: number;
  commerceModel?: string;
  seedProductName?: string;
  listingIntentPhrase?: string;
  softListingTag?: string;
  onboardingVersion?: string;
}): OnboardingMeta {
  return {
    v: ONBOARDING_META_VERSION,
    step: input.step,
    commerce_model: input.commerceModel || undefined,
    seed_product_name: input.seedProductName || undefined,
    listing_intent_phrase: input.listingIntentPhrase || undefined,
    soft_listing_tag: input.softListingTag || undefined,
    onboarding_version: input.onboardingVersion || undefined,
  };
}

export function parseOnboardingMeta(raw: unknown): OnboardingMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== ONBOARDING_META_VERSION) return null;
  return {
    v: ONBOARDING_META_VERSION,
    step: typeof o.step === 'number' ? o.step : undefined,
    commerce_model: typeof o.commerce_model === 'string' ? o.commerce_model : undefined,
    seed_product_name: typeof o.seed_product_name === 'string' ? o.seed_product_name : undefined,
    listing_intent_phrase: typeof o.listing_intent_phrase === 'string' ? o.listing_intent_phrase : undefined,
    soft_listing_tag: typeof o.soft_listing_tag === 'string' ? o.soft_listing_tag : undefined,
    onboarding_version: typeof o.onboarding_version === 'string' ? o.onboarding_version : undefined,
  };
}

/** Remove subcategory prefs for categories no longer selected. */
export function pruneSubcategoryPreferences(
  prefs: SubcategoryPreferences,
  activeCategorySlugs: string[],
  categorySlugToConfigId: Record<string, string>,
): SubcategoryPreferences {
  const activeConfigIds = new Set(
    activeCategorySlugs.map((slug) => categorySlugToConfigId[slug]).filter(Boolean),
  );
  const newData: SubcategoryPreferences['data'] = {};
  for (const [configId, pref] of Object.entries(prefs.data || {})) {
    if (activeConfigIds.has(configId)) {
      newData[configId] = pref;
    }
  }
  return { v: 1, data: newData };
}

export interface DraftProductActionRow {
  id?: string;
  name?: string;
  action_type?: string | null;
  approval_status?: string | null;
}

/** Products whose action_type differs from the store default (draft/pending only). */
export function findActionMismatchedProducts(
  products: DraftProductActionRow[],
  storeActionType: string | null | undefined,
  statuses: string[] = ['draft', 'pending'],
): DraftProductActionRow[] {
  if (!storeActionType) return [];
  return products.filter((p) => {
    if (!p.id || !p.action_type) return false;
    if (p.approval_status && !statuses.includes(p.approval_status)) return false;
    return p.action_type !== storeActionType;
  });
}

export interface ActionConsistencyResult {
  ok: boolean;
  mismatched: DraftProductActionRow[];
  message?: string;
}

export function validateStoreProductActionConsistency(
  products: DraftProductActionRow[],
  storeActionType: string | null | undefined,
): ActionConsistencyResult {
  const mismatched = findActionMismatchedProducts(products, storeActionType);
  if (mismatched.length === 0) return { ok: true, mismatched: [] };
  const name = mismatched[0].name || 'a product';
  return {
    ok: false,
    mismatched,
    message: `"${name}" uses a different buyer interaction than your store. Re-save products or change your store mode.`,
  };
}
