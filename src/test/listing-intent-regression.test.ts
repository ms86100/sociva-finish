import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ALIAS_MAP,
  SUBCATEGORY_NOUN_ALIASES,
  resolveListingIntent,
  type IntentCatalogCategory,
} from '@/lib/listing-intent';

/** Aliases added in the prepared-meals pass. Must not remap frozen phrases. */
const ADDED_ONE_TIME_MEAL_ALIASES = new Set([
  'biryani', 'biriyani', 'chicken biryani', 'mutton biryani', 'veg biryani', 'egg biryani',
  'hyderabadi biryani', 'dum biryani', 'rice bowl', 'rice meal', 'meal box', 'lunch box',
  'dinner box', 'prepared meals', 'prepared meal',
]);

const FROZEN_CATEGORY_ALIAS_MAP: Record<string, string[]> = Object.fromEntries(
  Object.entries(CATEGORY_ALIAS_MAP).map(([slug, aliases]) => [
    slug,
    slug === 'one_time_meals'
      ? aliases.filter((alias) => !ADDED_ONE_TIME_MEAL_ALIASES.has(alias))
      : aliases,
  ]),
);

function catalogFromSlugs(): IntentCatalogCategory[] {
  return Object.keys(CATEGORY_ALIAS_MAP).map((slug) => ({
    slug,
    id: `id-${slug}`,
    displayName: slug.replace(/_/g, ' '),
    parentGroup: slug.includes('yoga') || slug.includes('ayurveda') ? 'wellness' : 'catalog',
    supportsCart: true,
  }));
}

function normalize(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, ' ');
}

function scoreAlias(alias: string, query: string): number {
  const a = normalize(alias);
  const q = normalize(query);
  if (a === q) return 3;
  if (q.includes(a) || a.includes(q)) return a.length >= 3 ? 2.5 : 1.5;
  const n = a;
  if (n === q) return 3;
  if (n.startsWith(q)) return 2;
  if (n.includes(q)) return 1;
  return 0;
}

function frozenWinner(phrase: string): string | null {
  const cats = catalogFromSlugs();
  let best: { slug: string; score: number } | null = null;
  for (const cat of cats) {
    const aliases = [
      ...(FROZEN_CATEGORY_ALIAS_MAP[cat.slug] || []),
      cat.displayName,
      cat.slug.replace(/_/g, ' '),
    ];
    for (const alias of aliases) {
      const score = scoreAlias(alias, phrase);
      if (score > 0 && (!best || score > best.score)) {
        best = { slug: cat.slug, score };
      }
    }
  }
  return best?.slug ?? null;
}

describe('listing-intent alias regression matrix', () => {
  const categories = catalogFromSlugs();

  it('does not remap any frozen category alias onto a different slug', () => {
    const mismatches: string[] = [];
    for (const aliases of Object.values(FROZEN_CATEGORY_ALIAS_MAP)) {
      for (const alias of aliases) {
        const expected = frozenWinner(alias);
        const actual = resolveListingIntent({
          phrase: alias,
          categories,
          subcategories: [],
        }).suggestedCategorySlug;
        if (actual !== expected) {
          mismatches.push(`"${alias}": frozen ${expected} → now ${actual}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('keeps every subcategory noun alias export intact as a dictionary', () => {
    expect(Object.keys(SUBCATEGORY_NOUN_ALIASES).length).toBeGreaterThan(5);
    expect(SUBCATEGORY_NOUN_ALIASES['t-shirt']).toContain('tshirt');
    expect(SUBCATEGORY_NOUN_ALIASES.saree).toContain('saree');
  });
});
