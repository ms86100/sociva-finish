import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(process.cwd(), 'src/pages/CategoriesPage.tsx'), 'utf8');

describe('Explore Categories visual contracts', () => {
  it('keeps filter chips inside the header with room around All', () => {
    expect(src).toContain('data-testid="categories-group-filters"');
    expect(src).toContain('surface-chip shrink-0 whitespace-nowrap px-4');
    expect(src).toContain('surface-chip-active');
    expect(src).not.toMatch(/scale-105/);
    expect(src).toMatch(/pt-3 pb-3 overflow-x-auto/);
  });

  it('uses Sociva theme chrome instead of per-category pastels and count pills', () => {
    expect(src).not.toMatch(/getCategoryPastel/);
    expect(src).not.toContain('({group.categories.length})');
    expect(src).not.toMatch(/text-gray-900/);
    expect(src).not.toMatch(/backgroundColor: pastelColor/);
    expect(src).toContain('border border-border bg-card');
    expect(src).toContain('data-testid="categories-group-header"');
    expect(src).toContain('bg-primary/10 text-primary');
  });
});
