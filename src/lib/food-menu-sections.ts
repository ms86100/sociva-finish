/**
 * Food store menu sections for Zomato-style grouping on SellerDetailPage.
 * Assignment priority: meal → course → cuisine → More (single placement, no duplicates).
 */

import {
  FOOD_COURSES,
  FOOD_CUISINES,
  FOOD_MEALS,
  TASTE_MOODS,
  collectFoodFacetIds,
  type FoodCourseId,
  type FoodCuisineId,
  type FoodMealId,
} from '@/lib/food-facets';

export const FOOD_MENU_MORE_SECTION_ID = 'more';

export type FoodMenuSectionId =
  | FoodMealId
  | FoodCuisineId
  | FoodCourseId
  | typeof FOOD_MENU_MORE_SECTION_ID;

export interface FoodMenuSectionDef {
  id: FoodMenuSectionId;
  label: string;
  kind: 'meal' | 'course' | 'cuisine' | 'more';
}

/** Stable section order: meals, then cuisines, then courses, then More. */
export const FOOD_MENU_SECTION_ORDER: readonly FoodMenuSectionDef[] = [
  ...FOOD_MEALS.map((m) => ({
    id: m.id as FoodMenuSectionId,
    label: TASTE_MOODS.find((mood) => mood.id === m.id)?.label || m.label,
    kind: 'meal' as const,
  })),
  ...FOOD_CUISINES.map((c) => ({
    id: c.id as FoodMenuSectionId,
    label: TASTE_MOODS.find((mood) => mood.id === c.id)?.label || c.label,
    kind: 'cuisine' as const,
  })),
  ...FOOD_COURSES.map((c) => ({
    id: c.id as FoodMenuSectionId,
    label: TASTE_MOODS.find((mood) => mood.id === c.id)?.label || c.label,
    kind: 'course' as const,
  })),
  { id: FOOD_MENU_MORE_SECTION_ID, label: 'More', kind: 'more' },
];

const MEAL_ORDER = FOOD_MEALS.map((m) => m.id);
const COURSE_ORDER = FOOD_COURSES.map((c) => c.id);
const CUISINE_ORDER = FOOD_CUISINES.map((c) => c.id);

function firstInOrder<T extends string>(present: Set<T>, order: readonly T[]): T | null {
  for (const id of order) {
    if (present.has(id)) return id;
  }
  return null;
}

export function foodMenuSectionAnchorId(sectionId: FoodMenuSectionId): string {
  return `seller-food-${sectionId}`;
}

/**
 * Pick one section per product: meal → course → cuisine → more.
 * Explicit tags / cuisine_type win first so name-hint inference cannot pull a
 * tagged starter into Breakfast (or a dinner item into Lunch) via shared hints.
 */
export function assignFoodMenuSection(product: {
  tags?: string[] | null;
  cuisine_type?: string | null;
  name?: string;
}): FoodMenuSectionId {
  // Tags + cuisine_type only - omit name so hints cannot override seller tags
  const tagged = collectFoodFacetIds({
    tags: product.tags,
    cuisine_type: product.cuisine_type,
  });
  const taggedMeal = firstInOrder(tagged.meal, MEAL_ORDER);
  if (taggedMeal) return taggedMeal;
  const taggedCourse = firstInOrder(tagged.course, COURSE_ORDER);
  if (taggedCourse) return taggedCourse;
  const taggedCuisine = firstInOrder(tagged.cuisine, CUISINE_ORDER);
  if (taggedCuisine) return taggedCuisine;

  // Name hints only when the listing has no explicit food facets
  if (product.name) {
    const inferred = collectFoodFacetIds({ name: product.name });
    const meal = firstInOrder(inferred.meal, MEAL_ORDER);
    if (meal) return meal;
    const course = firstInOrder(inferred.course, COURSE_ORDER);
    if (course) return course;
    const cuisine = firstInOrder(inferred.cuisine, CUISINE_ORDER);
    if (cuisine) return cuisine;
  }

  return FOOD_MENU_MORE_SECTION_ID;
}

export interface FoodMenuSection<T> {
  id: FoodMenuSectionId;
  label: string;
  products: T[];
}

export function buildFoodMenuSections<
  T extends { tags?: string[] | null; cuisine_type?: string | null; name?: string },
>(products: T[]): FoodMenuSection<T>[] {
  const buckets = new Map<FoodMenuSectionId, T[]>();
  for (const product of products) {
    const sectionId = assignFoodMenuSection(product);
    const list = buckets.get(sectionId);
    if (list) list.push(product);
    else buckets.set(sectionId, [product]);
  }

  return FOOD_MENU_SECTION_ORDER.filter((def) => (buckets.get(def.id)?.length ?? 0) > 0).map(
    (def) => ({
      id: def.id,
      label: def.label,
      products: buckets.get(def.id)!,
    }),
  );
}
