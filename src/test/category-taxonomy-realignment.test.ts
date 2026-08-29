import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (relPath: string) => readFileSync(resolve(process.cwd(), relPath), 'utf8');

describe('category taxonomy and capability realignment', () => {
  it('contains migration with clean parent groups and fixed mappings', () => {
    const migration = read('supabase/migrations/20260829140000_category_taxonomy_and_capability_realignment.sql');

    // Ayurveda mapped to Health
    expect(migration).toMatch(/parent_group = 'health'/);
    expect(migration).toMatch(/category = 'ayurveda'/);
    expect(migration).toMatch(/default_action_type = 'book'/);

    // Daycare mapped to Domestic Help & Care
    expect(migration).toMatch(/parent_group = 'domestic_help'/);
    expect(migration).toMatch(/category = 'daycare'/);
    expect(migration).toMatch(/default_action_type = 'contact_seller'/);

    // Furniture resale license requirement cleared
    expect(migration).toMatch(/requires_license = false[\s\S]*category = 'furniture'/);

    // Action types populated
    expect(migration).toMatch(/category_allowed_action_types/);
    expect(migration).toMatch(/add_to_cart/);
    expect(migration).toMatch(/request_service/);
  });

  it('seller offering step reviews selected subcategories instead of a blank prompt', () => {
    const offering = read('src/components/seller/OfferingsStep.tsx');
    expect(offering).toContain('What do you offer?');
    expect(offering).toContain('Add another');
    const bootstrap = read('src/lib/app-bootstrap.ts');
    expect(bootstrap).toMatch(/app-bootstrap-v3/);
  });
});
