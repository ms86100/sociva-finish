/**
 * Silent taxonomy for workflow-first seller onboarding.
 * Maps seller-typed offering names onto existing group/category/subcategory rows.
 * Never inserts taxonomy. Never invents names like "Lunch".
 */
import {
  listingMatchBand,
  resolveListingIntent,
  type CommerceModel,
  type IntentCatalogCategory,
  type IntentCatalogSubcategory,
  type ListingMatchBand,
  type ResolvedListingIntent,
} from '@/lib/listing-intent';
import type { SubcategoryPreferences } from '@/hooks/useSellerApplication';

export const CONFIDENT_MATCH_BANDS: ListingMatchBand[] = ['strong', 'reasonable'];

export function isConfidentMatch(band: ListingMatchBand): boolean {
  return band === 'strong' || band === 'reasonable';
}

/** Preferred existing category slugs when the seller picks a parent group. */
export const GROUP_FALLBACK_CATEGORY_SLUGS: Record<string, string[]> = {
  food_beverages: ['home_food', 'other-food_beverages'],
  food: ['home_food', 'other-food_beverages', 'other-food'],
  personal_care: ['beauty', 'salon', 'other-personal_care'],
  home_services: ['plumber', 'ac_service', 'other-home_services'],
  education_learning: ['tuition', 'other-education_learning'],
  professional: ['tax_consultant', 'it_support', 'other-professional'],
  domestic_help: ['maid', 'nanny', 'other-domestic_help'],
  health: ['medical_specialist', 'ayurveda'],
  pets: ['pet_food', 'pet_grooming', 'other-pets'],
  events: ['catering', 'other-events'],
  rentals: ['equipment_rental', 'other-rentals'],
  resale: ['clothing', 'furniture', 'other-resale'],
  property: ['flat_rent', 'other-property'],
};

export interface MappedOffering {
  name: string;
  matchBand: ListingMatchBand;
  group: string | null;
  categorySlug: string | null;
  categoryConfigId: string | null;
  categoryDisplayName: string | null;
  subcategoryId: string | null;
  subcategoryName: string | null;
  supportsCart: boolean | undefined;
  recommendedModel: CommerceModel | null;
}

export type OfferingBatchStatus = 'ready' | 'needs_group' | 'mixed_groups' | 'empty';

export interface OfferingStamp {
  categories: string[];
  subcategory_preferences: SubcategoryPreferences;
  primaryGroup: string;
  stampLabel: string;
}

export interface OfferingBatchResult {
  status: OfferingBatchStatus;
  offerings: MappedOffering[];
  groups: string[];
  stamp: OfferingStamp | null;
  mixed: { group: string; name: string }[];
  workflowConflict: WorkflowConflict | null;
}

export interface WorkflowConflict {
  offeringName: string;
  categorySlug: string;
  categoryDisplayName: string;
  chosen: CommerceModel;
  recommended: CommerceModel;
  canKeepChosen: boolean;
}

export function normalizeOfferingNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name.charAt(0).toUpperCase() + name.slice(1));
  }
  return out;
}

export function mapOfferingName(input: {
  name: string;
  commerceModel?: CommerceModel | null;
  categories: IntentCatalogCategory[];
  subcategories: IntentCatalogSubcategory[];
}): MappedOffering {
  const intent: ResolvedListingIntent = resolveListingIntent({
    phrase: input.name,
    commerceModel: input.commerceModel || null,
    categories: input.categories,
    subcategories: input.subcategories,
  });
  const band = listingMatchBand(intent.confidence);
  const confident = isConfidentMatch(band);
  const cat = intent.suggestedCategorySlug
    ? input.categories.find((c) => c.slug === intent.suggestedCategorySlug) || null
    : null;

  return {
    name: intent.seedProductName || input.name,
    matchBand: band,
    group: confident ? intent.suggestedParentGroup : null,
    categorySlug: confident ? intent.suggestedCategorySlug : null,
    categoryConfigId: confident ? intent.suggestedCategoryConfigId : null,
    categoryDisplayName: confident ? (cat?.displayName || null) : null,
    subcategoryId: confident ? intent.suggestedSubcategoryId : null,
    subcategoryName: confident ? intent.suggestedSubcategoryName : null,
    supportsCart: cat?.supportsCart,
    recommendedModel: cat ? intent.commerceModel : null,
  };
}

export function pickFallbackCategory(
  groupSlug: string,
  categories: IntentCatalogCategory[],
): IntentCatalogCategory | null {
  const inGroup = categories.filter((c) => c.parentGroup === groupSlug);
  if (inGroup.length === 0) return null;
  const preferred = GROUP_FALLBACK_CATEGORY_SLUGS[groupSlug] || [];
  for (const slug of preferred) {
    const hit = inGroup.find((c) => c.slug === slug);
    if (hit) return hit;
  }
  const other = inGroup.find((c) => c.slug.startsWith('other-'));
  if (other) return other;
  return inGroup[0];
}

function recommendedModelForCategory(cat: IntentCatalogCategory): CommerceModel {
  if (cat.enquiryOnly) return 'enquire';
  if (cat.requiresTimeSlot || cat.hasDateRange) return 'book';
  if (cat.supportsCart === false) {
    const tx = (cat.transactionType || '').toLowerCase();
    if (tx.includes('contact')) return 'contact';
    if (tx.includes('request') || tx.includes('enquir')) return 'enquire';
    return 'book';
  }
  return 'cart';
}

export function detectWorkflowConflict(
  chosen: CommerceModel | null,
  offerings: MappedOffering[],
  categories: IntentCatalogCategory[],
): WorkflowConflict | null {
  if (!chosen) return null;
  for (const off of offerings) {
    if (!off.categorySlug) continue;
    const cat = categories.find((c) => c.slug === off.categorySlug);
    if (!cat) continue;
    if (chosen === 'cart' && cat.supportsCart === false) {
      return {
        offeringName: off.name,
        categorySlug: cat.slug,
        categoryDisplayName: cat.displayName,
        chosen,
        recommended: recommendedModelForCategory(cat),
        canKeepChosen: false,
      };
    }
  }
  return null;
}

function buildStamp(
  offerings: MappedOffering[],
  group: string,
  categories: IntentCatalogCategory[],
  groupLabel?: string,
): OfferingStamp {
  const prefs: SubcategoryPreferences = { v: 1, data: {} };
  const categorySlugs: string[] = [];

  const applyCategory = (cat: IntentCatalogCategory, offering: MappedOffering) => {
    if (!categorySlugs.includes(cat.slug)) categorySlugs.push(cat.slug);
    const existing = prefs.data[cat.id] || { primary: null, others: [] as string[] };
    if (offering.subcategoryId) {
      if (!existing.primary) existing.primary = offering.subcategoryId;
      else if (existing.primary !== offering.subcategoryId && !existing.others.includes(offering.subcategoryId)) {
        existing.others.push(offering.subcategoryId);
      }
    }
    prefs.data[cat.id] = existing;
  };

  for (const off of offerings) {
    if (off.categorySlug && off.group === group) {
      const cat = categories.find((c) => c.slug === off.categorySlug);
      if (cat) applyCategory(cat, off);
    } else {
      const fallback = pickFallbackCategory(group, categories);
      if (fallback) applyCategory(fallback, off);
    }
  }

  if (categorySlugs.length === 0) {
    const fallback = pickFallbackCategory(group, categories);
    if (fallback) categorySlugs.push(fallback.slug);
  }

  const primaryCat = categories.find((c) => c.slug === categorySlugs[0]);
  const groupPart = groupLabel || group;
  const catPart = primaryCat?.displayName || categorySlugs[0] || '';
  const stampLabel = catPart ? `Saved under ${groupPart} → ${catPart}` : `Saved under ${groupPart}`;

  return {
    categories: categorySlugs,
    subcategory_preferences: prefs,
    primaryGroup: group,
    stampLabel,
  };
}

export function resolveOfferingBatch(input: {
  names: string[];
  commerceModel?: CommerceModel | null;
  categories: IntentCatalogCategory[];
  subcategories: IntentCatalogSubcategory[];
  groupLabelBySlug?: Record<string, string>;
}): OfferingBatchResult {
  const names = normalizeOfferingNames(input.names);
  if (names.length === 0) {
    return {
      status: 'empty',
      offerings: [],
      groups: [],
      stamp: null,
      mixed: [],
      workflowConflict: null,
    };
  }

  const offerings = names.map((name) => mapOfferingName({
    name,
    commerceModel: input.commerceModel,
    categories: input.categories,
    subcategories: input.subcategories,
  }));

  const groups = [...new Set(offerings.map((o) => o.group).filter(Boolean) as string[])];

  if (groups.length > 1) {
    return {
      status: 'mixed_groups',
      offerings,
      groups,
      stamp: null,
      mixed: offerings
        .filter((o) => o.group)
        .map((o) => ({ group: o.group as string, name: o.name })),
      workflowConflict: null,
    };
  }

  if (groups.length === 0) {
    return {
      status: 'needs_group',
      offerings,
      groups: [],
      stamp: null,
      mixed: [],
      workflowConflict: null,
    };
  }

  const group = groups[0];
  const stamp = buildStamp(
    offerings,
    group,
    input.categories,
    input.groupLabelBySlug?.[group],
  );
  const workflowConflict = detectWorkflowConflict(input.commerceModel || null, offerings, input.categories);

  return {
    status: 'ready',
    offerings,
    groups,
    stamp,
    mixed: [],
    workflowConflict,
  };
}
