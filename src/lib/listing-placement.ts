/**
 * Per-item taxonomy placement for seller products.
 * Store type stays on the parent group. Each listing gets its own existing
 * category/subcategory. Item names are never inserted as taxonomy.
 */
import {
  findBestSubcategoryMatch,
  listingMatchBand,
  type CommerceModel,
  type IntentCatalogCategory,
  type IntentCatalogSubcategory,
} from '@/lib/listing-intent';
import { isConfidentMatch, mapOfferingName } from '@/lib/offering-taxonomy';

export interface ListingPlacement {
  category: string;
  subcategoryId: string | null;
  subcategoryName: string | null;
  /** Category to add onto the store when the item maps inside the same parent group. */
  extraCategory: string | null;
}

function parentGroupsForStore(
  storeCategories: string[],
  categories: IntentCatalogCategory[],
): Set<string> {
  const groups = new Set<string>();
  for (const slug of storeCategories) {
    const cat = categories.find((c) => c.slug === slug);
    if (cat?.parentGroup) groups.add(cat.parentGroup);
  }
  return groups;
}

function subcategoryBelongsToCategory(
  sub: IntentCatalogSubcategory,
  category: IntentCatalogCategory,
): boolean {
  return sub.categoryConfigId === category.id || sub.categorySlug === category.slug;
}

/**
 * Place a product name onto existing taxonomy, constrained to this store.
 * Never invents a subcategory from the item name (Rajma Chawal stays an item).
 */
export function resolveListingPlacement(input: {
  name: string;
  storeCategories: string[];
  categories: IntentCatalogCategory[];
  subcategories: IntentCatalogSubcategory[];
  commerceModel?: CommerceModel | null;
  fallbackCategory?: string | null;
  fallbackSubcategoryId?: string | null;
}): ListingPlacement {
  const storeCategories = input.storeCategories.filter(Boolean);
  const fallbackCategory = input.fallbackCategory || storeCategories[0] || '';
  const fallback: ListingPlacement = {
    category: fallbackCategory,
    subcategoryId: input.fallbackSubcategoryId || null,
    subcategoryName: null,
    extraCategory: null,
  };

  const name = String(input.name || '').trim();
  if (!name || input.categories.length === 0) return fallback;

  const mapped = mapOfferingName({
    name,
    commerceModel: input.commerceModel,
    categories: input.categories,
    subcategories: input.subcategories,
  });

  const storeGroups = parentGroupsForStore(storeCategories, input.categories);
  const mappedCat = mapped.categorySlug
    ? input.categories.find((c) => c.slug === mapped.categorySlug) || null
    : null;

  const mappedAllowedInStore = !!(mappedCat && storeCategories.includes(mappedCat.slug));
  const mappedSameGroup = !!(
    mappedCat
    && isConfidentMatch(mapped.matchBand)
    && mappedCat.parentGroup
    && (storeGroups.size === 0 || storeGroups.has(mappedCat.parentGroup))
  );

  let categorySlug = fallbackCategory;
  let extraCategory: string | null = null;

  if (mappedAllowedInStore && mappedCat) {
    categorySlug = mappedCat.slug;
  } else if (mappedSameGroup && mappedCat) {
    categorySlug = mappedCat.slug;
    extraCategory = storeCategories.includes(mappedCat.slug) ? null : mappedCat.slug;
  }

  const category = input.categories.find((c) => c.slug === categorySlug) || mappedCat;
  if (!category) {
    return { ...fallback, extraCategory };
  }

  let subcategoryId: string | null = null;
  let subcategoryName: string | null = null;

  if (
    mapped.subcategoryId
    && mapped.categorySlug === category.slug
  ) {
    const sub = input.subcategories.find((s) => s.id === mapped.subcategoryId);
    if (sub && subcategoryBelongsToCategory(sub, category)) {
      subcategoryId = sub.id;
      subcategoryName = sub.displayName;
    }
  }

  if (!subcategoryId) {
    const local = findBestSubcategoryMatch(name, input.subcategories, {
      categoryConfigId: category.id,
      categorySlug: category.slug,
    });
    if (local && listingMatchBand(local.score) !== 'none' && local.score >= 1.5) {
      const looksLikeItemName =
        local.sub.displayName.trim().toLowerCase() === name.toLowerCase();
      if (!looksLikeItemName) {
        subcategoryId = local.sub.id;
        subcategoryName = local.sub.displayName;
      }
    }
  }

  if (
    !subcategoryId
    && input.fallbackSubcategoryId
    && category.slug === fallbackCategory
  ) {
    const fallbackSub = input.subcategories.find((s) => s.id === input.fallbackSubcategoryId);
    if (fallbackSub && subcategoryBelongsToCategory(fallbackSub, category)) {
      subcategoryId = fallbackSub.id;
      subcategoryName = fallbackSub.displayName;
    }
  }

  return {
    category: category.slug,
    subcategoryId,
    subcategoryName,
    extraCategory,
  };
}

export function mergeStoreCategories(
  storeCategories: string[],
  extraCategory: string | null | undefined,
): string[] {
  if (!extraCategory) return storeCategories;
  if (storeCategories.includes(extraCategory)) return storeCategories;
  return [...storeCategories, extraCategory];
}
