/**
 * Food browse facets live on the product, not in the category tree.
 * Cuisine / meal / course are orthogonal filters (South Indian × Breakfast × Main)
 * and must never become subcategories.
 *
 * Persistence: namespaced `tags` plus `cuisine_type` for the primary cuisine.
 */

export const FOOD_PARENT_GROUPS = new Set(['food_beverages', 'food']);

export const CUISINE_TAG_PREFIX = 'cuisine:';
export const MEAL_TAG_PREFIX = 'meal:';
export const COURSE_TAG_PREFIX = 'course:';

export const FOOD_CUISINES = [
  { id: 'north_indian', label: 'North Indian' },
  { id: 'south_indian', label: 'South Indian' },
  { id: 'chinese', label: 'Chinese' },
  { id: 'tandoori', label: 'Tandoori' },
  { id: 'continental', label: 'Continental' },
  { id: 'other', label: 'Other' },
] as const;

export const FOOD_MEALS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snack', label: 'Snack' },
] as const;

export const FOOD_COURSES = [
  { id: 'appetizer', label: 'Appetizer' },
  { id: 'main', label: 'Main' },
  { id: 'dessert', label: 'Dessert' },
] as const;

export type FoodCuisineId = (typeof FOOD_CUISINES)[number]['id'];
export type FoodMealId = (typeof FOOD_MEALS)[number]['id'];
export type FoodCourseId = (typeof FOOD_COURSES)[number]['id'];

export interface FoodFacets {
  cuisine: FoodCuisineId | null;
  meal: FoodMealId | null;
  course: FoodCourseId | null;
}

const CUISINE_IDS = new Set(FOOD_CUISINES.map((c) => c.id));
const MEAL_IDS = new Set(FOOD_MEALS.map((m) => m.id));
const COURSE_IDS = new Set(FOOD_COURSES.map((c) => c.id));

export function isFoodParentGroup(group: string | null | undefined): boolean {
  if (!group) return false;
  const g = group.toLowerCase();
  return FOOD_PARENT_GROUPS.has(g) || g.includes('food');
}

export function emptyFoodFacets(): FoodFacets {
  return { cuisine: null, meal: null, course: null };
}

function stripFacetTags(tags: string[] | null | undefined): string[] {
  return (tags || []).filter((tag) => {
    const t = String(tag || '');
    return !(
      t.startsWith(CUISINE_TAG_PREFIX) ||
      t.startsWith(MEAL_TAG_PREFIX) ||
      t.startsWith(COURSE_TAG_PREFIX)
    );
  });
}

function readPrefixed(
  tags: string[] | null | undefined,
  prefix: string,
): string | null {
  const hit = (tags || []).find((tag) => String(tag || '').startsWith(prefix));
  if (!hit) return null;
  return String(hit).slice(prefix.length) || null;
}

export function parseFoodFacets(
  tags: string[] | null | undefined,
  cuisineType?: string | null,
  name?: string | null,
): FoodFacets {
  const cuisineTag = readPrefixed(tags, CUISINE_TAG_PREFIX);
  const mealRaw = readPrefixed(tags, MEAL_TAG_PREFIX);
  const courseRaw = readPrefixed(tags, COURSE_TAG_PREFIX);
  const collected = collectFoodFacetIds({ tags, cuisine_type: cuisineType, name: name || undefined });
  const cuisineFromId = cuisineTag && CUISINE_IDS.has(cuisineTag as FoodCuisineId)
    ? (cuisineTag as FoodCuisineId)
    : null;
  const mealFromId = mealRaw && MEAL_IDS.has(mealRaw as FoodMealId) ? (mealRaw as FoodMealId) : null;
  const courseFromId = courseRaw && COURSE_IDS.has(courseRaw as FoodCourseId) ? (courseRaw as FoodCourseId) : null;
  return {
    cuisine: cuisineFromId || [...collected.cuisine][0] || null,
    meal: mealFromId || [...collected.meal][0] || null,
    course: courseFromId || [...collected.course][0] || null,
  };
}

export function serializeFoodFacets(
  facets: FoodFacets,
  existingTags: string[] | null | undefined = [],
): { tags: string[]; cuisine_type: string | null } {
  const tags = stripFacetTags(existingTags);
  if (facets.cuisine) tags.push(`${CUISINE_TAG_PREFIX}${facets.cuisine}`);
  if (facets.meal) tags.push(`${MEAL_TAG_PREFIX}${facets.meal}`);
  if (facets.course) tags.push(`${COURSE_TAG_PREFIX}${facets.course}`);
  return {
    tags,
    cuisine_type: facets.cuisine,
  };
}

const CUISINE_HINTS: Array<{ id: FoodCuisineId; hints: string[] }> = [
  { id: 'south_indian', hints: ['south indian', 'idli', 'dosa', 'sambar', 'rasam', 'uttapam', 'vada', 'filter coffee', 'hyderabadi'] },
  { id: 'north_indian', hints: ['north indian', 'rajma', 'dal makhani', 'butter chicken', 'chole', 'paneer', 'roti', 'naan', 'paratha', 'makhani', 'punjabi'] },
  { id: 'chinese', hints: ['chinese', 'noodles', 'manchurian', 'hakka', 'fried rice', 'chilli chicken', 'schezwan'] },
  { id: 'tandoori', hints: ['tandoori', 'tandoor', 'tikka', 'kebab', 'seekh'] },
  { id: 'continental', hints: ['pasta', 'pizza', 'burger', 'sandwich', 'continental', 'belgian'] },
];

const MEAL_HINTS: Array<{ id: FoodMealId; hints: string[] }> = [
  { id: 'breakfast', hints: ['breakfast', 'idli', 'dosa', 'poha', 'upma', 'paratha'] },
  { id: 'lunch', hints: ['lunch', 'tiffin', 'thali', 'biryani', 'meal box'] },
  { id: 'dinner', hints: ['dinner', 'biryani'] },
  { id: 'snack', hints: ['snack', 'snacks', 'chaat', 'samosa', 'pakora', 'namkeen', 'evening tea'] },
];

const COURSE_HINTS: Array<{ id: FoodCourseId; hints: string[] }> = [
  { id: 'dessert', hints: ['cake', 'pastry', 'dessert', 'sweet', 'mithai', 'ice cream', 'brownie', 'ganache', 'bakery'] },
  { id: 'appetizer', hints: ['starter', 'appetizer', 'soup', 'tikka'] },
  { id: 'main', hints: ['curry', 'biryani', 'thali', 'rajma', 'dal', 'chawal', 'rice', 'meal box'] },
];

const CUISINE_ALIASES: Record<string, FoodCuisineId> = {
  'north indian': 'north_indian',
  punjabi: 'north_indian',
  'south indian': 'south_indian',
  hyderabadi: 'south_indian',
  chinese: 'chinese',
  tandoori: 'tandoori',
  continental: 'continental',
};

const MEAL_ALIASES: Record<string, FoodMealId> = {
  snacks: 'snack',
  snack: 'snack',
  'evening tea': 'snack',
  tiffin: 'lunch',
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
};

const COURSE_ALIASES: Record<string, FoodCourseId> = {
  dessert: 'dessert',
  cake: 'dessert',
  bakery: 'dessert',
  sweet: 'dessert',
  thali: 'main',
  biryani: 'main',
  appetizer: 'appetizer',
  starter: 'appetizer',
  main: 'main',
};

function tokenizeFoodValue(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/^(cuisine|meal|course):/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function cuisineFromToken(token: string): FoodCuisineId | null {
  const t = tokenizeFoodValue(token);
  const asId = t.replace(/ /g, '_') as FoodCuisineId;
  if (CUISINE_IDS.has(asId) && asId !== 'other') return asId;
  if (CUISINE_ALIASES[t]) return CUISINE_ALIASES[t];
  return firstHintMatch(t, CUISINE_HINTS);
}

function mealFromToken(token: string): FoodMealId | null {
  const t = tokenizeFoodValue(token);
  const asId = t.replace(/ /g, '_') as FoodMealId;
  if (MEAL_IDS.has(asId)) return asId;
  if (MEAL_ALIASES[t]) return MEAL_ALIASES[t];
  return firstHintMatch(t, MEAL_HINTS);
}

function courseFromToken(token: string): FoodCourseId | null {
  const t = tokenizeFoodValue(token);
  const asId = t.replace(/ /g, '_') as FoodCourseId;
  if (COURSE_IDS.has(asId)) return asId;
  if (COURSE_ALIASES[t]) return COURSE_ALIASES[t];
  return firstHintMatch(t, COURSE_HINTS);
}

export function collectFoodFacetIds(product: {
  tags?: string[] | null;
  cuisine_type?: string | null;
  name?: string;
}): {
  cuisine: Set<FoodCuisineId>;
  meal: Set<FoodMealId>;
  course: Set<FoodCourseId>;
} {
  const cuisine = new Set<FoodCuisineId>();
  const meal = new Set<FoodMealId>();
  const course = new Set<FoodCourseId>();

  const addFromToken = (raw: string) => {
    const c = cuisineFromToken(raw);
    if (c) cuisine.add(c);
    const m = mealFromToken(raw);
    if (m) meal.add(m);
    const co = courseFromToken(raw);
    if (co) course.add(co);
  };

  for (const tag of product.tags || []) addFromToken(String(tag || ''));
  if (product.cuisine_type) addFromToken(product.cuisine_type);
  if (product.name) {
    const inferred = inferFoodFacets(product.name);
    if (inferred.cuisine) cuisine.add(inferred.cuisine);
    if (inferred.meal) meal.add(inferred.meal);
    if (inferred.course) course.add(inferred.course);
  }
  return { cuisine, meal, course };
}

function firstHintMatch<T extends string>(
  q: string,
  rows: Array<{ id: T; hints: string[] }>,
): T | null {
  for (const row of rows) {
    if (row.hints.some((h) => q.includes(h))) return row.id;
  }
  return null;
}

export function inferFoodFacets(name: string): FoodFacets {
  const q = name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return emptyFoodFacets();
  return {
    cuisine: firstHintMatch(q, CUISINE_HINTS),
    meal: firstHintMatch(q, MEAL_HINTS),
    course: firstHintMatch(q, COURSE_HINTS),
  };
}

export function mergeInferredFoodFacets(
  inferred: FoodFacets,
  current: FoodFacets,
): FoodFacets {
  return {
    cuisine: current.cuisine || inferred.cuisine,
    meal: current.meal || inferred.meal,
    course: current.course || inferred.course,
  };
}

export function productMatchesFoodFacets(
  product: { tags?: string[] | null; cuisine_type?: string | null; name?: string },
  selected: Partial<FoodFacets>,
): boolean {
  const collected = collectFoodFacetIds(product);
  if (selected.cuisine && !collected.cuisine.has(selected.cuisine as FoodCuisineId)) return false;
  if (selected.meal && !collected.meal.has(selected.meal as FoodMealId)) return false;
  if (selected.course && !collected.course.has(selected.course as FoodCourseId)) return false;
  return true;
}

export const CUISINE_EMOJI: Record<FoodCuisineId, string> = {
  north_indian: '🥘',
  south_indian: '🥥',
  chinese: '🥡',
  tandoori: '🔥',
  continental: '🍝',
  other: '✨',
};

export const MEAL_EMOJI: Record<FoodMealId, string> = {
  breakfast: '🌅',
  lunch: '🍛',
  dinner: '🌙',
  snack: '🥨',
};

export const COURSE_EMOJI: Record<FoodCourseId, string> = {
  appetizer: '🥗',
  main: '🍽️',
  dessert: '🍰',
};

export type TasteMoodFacet = 'cuisine' | 'meal' | 'course';

export interface TasteMood {
  id: string;
  emoji: string;
  label: string;
  facet: TasteMoodFacet;
  value: FoodCuisineId | FoodMealId | FoodCourseId;
}

/** Curated one-tap moods for browse. Full cuisine × meal × course lives in the Taste sheet. */
export const TASTE_MOODS: readonly TasteMood[] = [
  { id: 'breakfast', emoji: MEAL_EMOJI.breakfast, label: 'Breakfast', facet: 'meal', value: 'breakfast' },
  { id: 'lunch', emoji: MEAL_EMOJI.lunch, label: 'Lunch', facet: 'meal', value: 'lunch' },
  { id: 'dinner', emoji: MEAL_EMOJI.dinner, label: 'Dinner', facet: 'meal', value: 'dinner' },
  { id: 'snack', emoji: MEAL_EMOJI.snack, label: 'Snacks', facet: 'meal', value: 'snack' },
  { id: 'north_indian', emoji: CUISINE_EMOJI.north_indian, label: 'North', facet: 'cuisine', value: 'north_indian' },
  { id: 'south_indian', emoji: CUISINE_EMOJI.south_indian, label: 'South', facet: 'cuisine', value: 'south_indian' },
  { id: 'chinese', emoji: CUISINE_EMOJI.chinese, label: 'Chinese', facet: 'cuisine', value: 'chinese' },
  { id: 'tandoori', emoji: CUISINE_EMOJI.tandoori, label: 'Tandoori', facet: 'cuisine', value: 'tandoori' },
  { id: 'dessert', emoji: COURSE_EMOJI.dessert, label: 'Dessert', facet: 'course', value: 'dessert' },
] as const;

export function availableTasteMoods(
  products: Array<{ tags?: string[] | null; cuisine_type?: string | null; name?: string }>,
): TasteMood[] {
  return TASTE_MOODS.filter((mood) => {
    const selected = { [mood.facet]: mood.value } as Partial<FoodFacets>;
    return products.some((p) => productMatchesFoodFacets(p, selected));
  });
}

export function countFoodFacets(facets: Partial<FoodFacets> | null | undefined): number {
  if (!facets) return 0;
  return (facets.cuisine ? 1 : 0) + (facets.meal ? 1 : 0) + (facets.course ? 1 : 0);
}

export function isTasteMoodActive(mood: TasteMood, facets: Partial<FoodFacets>): boolean {
  if (mood.facet === 'cuisine') return facets.cuisine === mood.value;
  if (mood.facet === 'meal') return facets.meal === mood.value;
  return facets.course === mood.value;
}

export function toggleTasteMood(mood: TasteMood, current: FoodFacets): FoodFacets {
  const next: FoodFacets = { ...current };
  if (mood.facet === 'cuisine') {
    next.cuisine = next.cuisine === mood.value ? null : (mood.value as FoodCuisineId);
  } else if (mood.facet === 'meal') {
    next.meal = next.meal === mood.value ? null : (mood.value as FoodMealId);
  } else {
    next.course = next.course === mood.value ? null : (mood.value as FoodCourseId);
  }
  return next;
}

export function foodFacetsHeadline(facets: Partial<FoodFacets>): string | null {
  const parts: string[] = [];
  const cuisine = FOOD_CUISINES.find((c) => c.id === facets.cuisine);
  const meal = FOOD_MEALS.find((m) => m.id === facets.meal);
  const course = FOOD_COURSES.find((c) => c.id === facets.course);
  if (cuisine) parts.push(cuisine.label);
  if (meal) parts.push(meal.label);
  if (course) parts.push(course.label);
  return parts.length ? parts.join(' · ') : null;
}

export function parseCuisineParam(raw: string | null | undefined): FoodCuisineId | null {
  return raw && CUISINE_IDS.has(raw as FoodCuisineId) ? (raw as FoodCuisineId) : null;
}

export function parseMealParam(raw: string | null | undefined): FoodMealId | null {
  return raw && MEAL_IDS.has(raw as FoodMealId) ? (raw as FoodMealId) : null;
}

export function parseCourseParam(raw: string | null | undefined): FoodCourseId | null {
  return raw && COURSE_IDS.has(raw as FoodCourseId) ? (raw as FoodCourseId) : null;
}

export function readFoodFacetsFromSearchParams(params: URLSearchParams): FoodFacets {
  return {
    cuisine: parseCuisineParam(params.get('cuisine')),
    meal: parseMealParam(params.get('meal')),
    course: parseCourseParam(params.get('course')),
  };
}

export function writeFoodFacetsToSearchParams(
  params: URLSearchParams,
  facets: Partial<FoodFacets>,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (facets.cuisine) next.set('cuisine', facets.cuisine);
  else next.delete('cuisine');
  if (facets.meal) next.set('meal', facets.meal);
  else next.delete('meal');
  if (facets.course) next.set('course', facets.course);
  else next.delete('course');
  return next;
}

export function foodFacetsBrowsePath(
  groupSlug = 'food_beverages',
  facets: Partial<FoodFacets> = {},
): string {
  const params = writeFoodFacetsToSearchParams(new URLSearchParams(), facets);
  const q = params.toString();
  return q ? `/category/${groupSlug}?${q}` : `/category/${groupSlug}`;
}
