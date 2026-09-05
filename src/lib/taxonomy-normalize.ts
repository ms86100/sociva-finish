/** Client-side mirror of public.normalize_taxonomy_key for tests and UI. */
export function normalizeTaxonomyKey(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function taxonomyKeysLikelyDuplicate(a: string, b: string): boolean {
  const ka = normalizeTaxonomyKey(a);
  const kb = normalizeTaxonomyKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  // Soft plural: homemade-food vs homemade-foods
  if (ka + 's' === kb || kb + 's' === ka) return true;
  return false;
}
