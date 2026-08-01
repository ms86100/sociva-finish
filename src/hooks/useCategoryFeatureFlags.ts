// @ts-nocheck
import { useMemo } from 'react';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { CategoryConfig } from '@/types/categories';

export interface CategoryFeatureFlags {
  hasServiceLayout: boolean;
  supportsAddons: boolean;
  supportsRecurring: boolean;
  supportsStaffAssignment: boolean;
  showVegToggle: boolean;
  showDurationField: boolean;
}

const EMPTY_FLAGS: CategoryFeatureFlags = {
  hasServiceLayout: false,
  supportsAddons: false,
  supportsRecurring: false,
  supportsStaffAssignment: false,
  showVegToggle: false,
  showDurationField: false,
};

/**
 * Resolves feature flags for a single category from the cached category_config.
 */
export function useCategoryFlags(category: string | null): CategoryFeatureFlags {
  const { configs } = useCategoryConfigs();

  return useMemo(() => {
    if (!category) return EMPTY_FLAGS;
    const config = configs.find(c => c.category === category);
    if (!config) return EMPTY_FLAGS;
    return configToFlags(config);
  }, [configs, category]);
}

/**
 * Resolves merged feature flags across multiple categories.
 * Returns true for a flag if ANY of the given categories has it enabled.
 */
export function useSellerCategoryFlags(categories: string[]): CategoryFeatureFlags {
  const { configs } = useCategoryConfigs();

  return useMemo(() => {
    if (!categories.length) return EMPTY_FLAGS;
    const matched = configs.filter(c => categories.includes(c.category));
    if (!matched.length) return EMPTY_FLAGS;

    return {
      hasServiceLayout: matched.some(c => c.layoutType === 'service'),
      supportsAddons: matched.some(c => c.supportsAddons),
      supportsRecurring: matched.some(c => c.supportsRecurring),
      supportsStaffAssignment: matched.some(c => c.supportsStaffAssignment),
      showVegToggle: matched.some(c => c.formHints.showVegToggle),
      showDurationField: matched.some(c => c.formHints.showDurationField),
    };
  }, [configs, categories]);
}

function configToFlags(config: CategoryConfig): CategoryFeatureFlags {
  return {
    hasServiceLayout: config.layoutType === 'service',
    supportsAddons: config.supportsAddons ?? false,
    supportsRecurring: config.supportsRecurring ?? false,
    supportsStaffAssignment: config.supportsStaffAssignment ?? false,
    showVegToggle: config.formHints.showVegToggle,
    showDurationField: config.formHints.showDurationField,
  };
}
