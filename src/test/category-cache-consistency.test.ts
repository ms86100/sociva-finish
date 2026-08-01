import { describe, it, expect } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import { fetchCategoryConfigs } from '@/hooks/useCategoryBehavior';

/**
 * Category Cache Consistency Tests
 * 
 * ROOT CAUSE (2026-02-24): The shared ['category-configs'] React Query cache key
 * was used by 4 different queryFn implementations. The AuthProvider prefetch stored
 * RAW database rows (snake_case: parent_group, display_name, is_active), while
 * CategoriesPage expected camelCase properties (parentGroup, displayName, isActive).
 * This caused all category filters to silently return empty arrays, showing the
 * "Stay tuned — we're growing!" empty state even when products existed.
 * 
 * FIX: All consumers now use the single exported `fetchCategoryConfigs` function
 * which maps DB rows to camelCase CategoryConfig objects.
 * 
 * These tests ensure the mapping is correct and no raw DB rows leak into the cache.
 */
describe('Category Config Cache Consistency', () => {

  it('fetchCategoryConfigs returns camelCase properties, not snake_case', async () => {
    const configs = await fetchCategoryConfigs();

    // Skip if no categories configured (empty DB)
    if (configs.length === 0) {
      console.warn('No category configs found in DB — skipping property check');
      return;
    }

    const sample = configs[0];

    // MUST have camelCase properties
    expect(sample).toHaveProperty('parentGroup');
    expect(sample).toHaveProperty('displayName');
    expect(sample).toHaveProperty('isActive');
    expect(sample).toHaveProperty('layoutType');
    expect(sample).toHaveProperty('displayOrder');
    expect(sample).toHaveProperty('imageUrl');

    // MUST NOT have raw snake_case DB properties
    expect(sample).not.toHaveProperty('parent_group');
    expect(sample).not.toHaveProperty('display_name');
    expect(sample).not.toHaveProperty('is_active');
    expect(sample).not.toHaveProperty('layout_type');
    expect(sample).not.toHaveProperty('display_order');
    expect(sample).not.toHaveProperty('image_url');
  });

  it('fetchCategoryConfigs maps behavior sub-object correctly', async () => {
    const configs = await fetchCategoryConfigs();
    if (configs.length === 0) return;

    const { behavior } = configs[0];
    expect(behavior).toBeDefined();

    // camelCase behavior properties
    expect(behavior).toHaveProperty('isPhysicalProduct');
    expect(behavior).toHaveProperty('requiresPreparation');
    expect(behavior).toHaveProperty('requiresTimeSlot');
    expect(behavior).toHaveProperty('requiresDelivery');
    expect(behavior).toHaveProperty('supportsCart');
    expect(behavior).toHaveProperty('enquiryOnly');
    expect(behavior).toHaveProperty('hasQuantity');
    expect(behavior).toHaveProperty('hasDuration');
    expect(behavior).toHaveProperty('hasDateRange');
    expect(behavior).toHaveProperty('isNegotiable');

    // snake_case should NOT exist
    expect(behavior).not.toHaveProperty('is_physical_product');
    expect(behavior).not.toHaveProperty('requires_preparation');
    expect(behavior).not.toHaveProperty('supports_cart');
  });

  it('fetchCategoryConfigs maps formHints sub-object correctly', async () => {
    const configs = await fetchCategoryConfigs();
    if (configs.length === 0) return;

    const { formHints } = configs[0];
    expect(formHints).toBeDefined();

    expect(formHints).toHaveProperty('namePlaceholder');
    expect(formHints).toHaveProperty('descriptionPlaceholder');
    expect(formHints).toHaveProperty('priceLabel');
    expect(formHints).toHaveProperty('showVegToggle');
    expect(formHints).toHaveProperty('showDurationField');
    expect(formHints).toHaveProperty('primaryButtonLabel');

    // snake_case should NOT exist
    expect(formHints).not.toHaveProperty('name_placeholder');
    expect(formHints).not.toHaveProperty('show_veg_toggle');
    expect(formHints).not.toHaveProperty('primary_button_label');
  });

  it('all configs have valid parentGroup values (not undefined)', async () => {
    const configs = await fetchCategoryConfigs();
    if (configs.length === 0) return;

    for (const config of configs) {
      expect(config.parentGroup).toBeDefined();
      expect(typeof config.parentGroup).toBe('string');
      expect(config.parentGroup.length).toBeGreaterThan(0);
    }
  });

  it('all configs have isActive as boolean (not undefined)', async () => {
    const configs = await fetchCategoryConfigs();
    if (configs.length === 0) return;

    for (const config of configs) {
      expect(typeof config.isActive).toBe('boolean');
    }
  });

  it('raw DB query returns snake_case — verifying the mapping is necessary', async () => {
    const { data } = await supabase
      .from('category_config')
      .select('parent_group, display_name, is_active')
      .limit(1);

    if (!data || data.length === 0) return;

    const raw = data[0];
    // Raw DB rows MUST have snake_case
    expect(raw).toHaveProperty('parent_group');
    expect(raw).toHaveProperty('display_name');
    expect(raw).toHaveProperty('is_active');

    // Raw DB rows must NOT have camelCase
    expect(raw).not.toHaveProperty('parentGroup');
    expect(raw).not.toHaveProperty('displayName');
    expect(raw).not.toHaveProperty('isActive');
  });
});
