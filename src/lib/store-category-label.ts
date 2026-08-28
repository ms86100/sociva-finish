import type { CategoryConfig } from '@/types/categories';

export function formatPrimaryGroupLabel(slug: string | null | undefined): string {
  if (!slug) return 'General';
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function resolveStoreCategoryLabel(
  store: { primary_group?: string | null; categories?: string[] | null },
  configs: Pick<CategoryConfig, 'category' | 'displayName'>[] = [],
): string {
  const cats = store.categories || [];
  if (cats.length === 1) {
    const cfg = configs.find((c) => c.category === cats[0]);
    return cfg?.displayName || cats[0].replace(/_/g, ' ');
  }
  if (cats.length > 1) {
    const names = cats.slice(0, 2).map((cat) => {
      const cfg = configs.find((c) => c.category === cat);
      return cfg?.displayName || cat.replace(/_/g, ' ');
    });
    return cats.length > 2 ? `${names.join(', ')} +${cats.length - 2}` : names.join(', ');
  }
  return formatPrimaryGroupLabel(store.primary_group);
}
