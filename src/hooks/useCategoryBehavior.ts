// @ts-nocheck
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadAppBootstrap } from '@/lib/app-bootstrap';
import { 
  ServiceCategory, 
  CategoryBehavior, 
  CategoryConfig, 
  ParentGroup,
  DEFAULT_FALLBACK_BEHAVIOR,
  getListingType,
  getOrderType,
} from '@/types/categories';

interface CategoryConfigRow {
  id: string;
  category: string;
  display_name: string;
  icon: string;
  color: string;
  parent_group: string;
  layout_type: string;
  is_physical_product: boolean;
  requires_preparation: boolean;
  requires_time_slot: boolean;
  requires_delivery: boolean;
  supports_cart: boolean;
  enquiry_only: boolean;
  has_quantity: boolean;
  has_duration: boolean;
  has_date_range: boolean;
  is_negotiable: boolean;
  display_order: number;
  is_active: boolean;
  name_placeholder: string | null;
  description_placeholder: string | null;
  price_label: string | null;
  duration_label: string | null;
  show_veg_toggle: boolean | null;
  show_duration_field: boolean | null;
  primary_button_label: string | null;
  price_prefix: string | null;
  placeholder_emoji: string | null;
  supports_brand_display: boolean;
  supports_warranty_display: boolean;
  image_aspect_ratio: string;
  image_object_fit: string;
  image_url: string | null;
  supports_addons: boolean;
  supports_recurring: boolean;
  supports_staff_assignment: boolean;
}

/** Pure snake_case row -> camelCase CategoryConfig mapper. */
export const mapCategoryConfigRows = (rows: CategoryConfigRow[]): CategoryConfig[] =>
  (rows || []).map((row) => ({

    id: row.id,
    category: row.category as ServiceCategory,
    displayName: row.display_name,
    icon: row.icon,
    color: row.color,
    parentGroup: row.parent_group as ParentGroup,
    layoutType: (row.layout_type as 'ecommerce' | 'food' | 'service') || 'ecommerce',
    behavior: {
      isPhysicalProduct: row.is_physical_product,
      requiresPreparation: row.requires_preparation,
      requiresTimeSlot: row.requires_time_slot,
      requiresDelivery: row.requires_delivery,
      supportsCart: row.supports_cart,
      enquiryOnly: row.enquiry_only,
      hasQuantity: row.has_quantity,
      hasDuration: row.has_duration,
      hasDateRange: row.has_date_range,
      isNegotiable: row.is_negotiable,
    },
    formHints: {
      namePlaceholder: row.name_placeholder,
      descriptionPlaceholder: row.description_placeholder,
      priceLabel: row.price_label || 'Price',
      durationLabel: row.duration_label,
      showVegToggle: row.show_veg_toggle ?? false,
      showDurationField: row.show_duration_field ?? false,
      primaryButtonLabel: row.primary_button_label || null,
      pricePrefix: row.price_prefix || null,
      placeholderEmoji: row.placeholder_emoji || null,
    },
    transactionType: (row as any).transaction_type || null,
    imageUrl: row.image_url || null,
    display: {
      supportsBrandDisplay: row.supports_brand_display,
      supportsWarrantyDisplay: row.supports_warranty_display,
      imageAspectRatio: row.image_aspect_ratio || 'square',
      imageObjectFit: row.image_object_fit || 'cover',
    },
    displayOrder: row.display_order,
    isActive: row.is_active,
    supportsAddons: row.supports_addons ?? false,
    supportsRecurring: row.supports_recurring ?? false,
    supportsStaffAssignment: row.supports_staff_assignment ?? false,
  }));

/**
 * Category config loader.
 * PERF: served from the shared single-request bootstrap rather than its own
 * `category_config` query. Kept as a standalone exported function because
 * AuthProvider prefetch, useSearchPlaceholder and useCategoryConfig all reuse it
 * under the same ['category-configs'] cache key.
 */
export const fetchCategoryConfigs = async (): Promise<CategoryConfig[]> => {
  const { categoryConfigRows } = await loadAppBootstrap();
  return mapCategoryConfigRows(categoryConfigRows as CategoryConfigRow[]);
};


export function useCategoryConfigs() {
  const { data: configs = [], isLoading, refetch } = useQuery({
    queryKey: ['category-configs'],
    queryFn: fetchCategoryConfigs,
    staleTime: 30 * 60 * 1000, // 30 min — category config is near-static
  });

  const groupedConfigs = useMemo(() => {
    const grouped: Record<string, CategoryConfig[]> = {};
    configs.forEach((config) => {
      if (!grouped[config.parentGroup]) {
        grouped[config.parentGroup] = [];
      }
      grouped[config.parentGroup].push(config);
    });
    return grouped;
  }, [configs]);

  return { configs, groupedConfigs, isLoading, refresh: refetch };
}

export function useCategoryBehavior(category: ServiceCategory | null) {
  const { configs } = useCategoryConfigs();

  const config = useMemo(() => {
    if (!category) return null;
    return configs.find((c) => c.category === category) || null;
  }, [configs, category]);

  const behavior = useMemo(() => {
    if (!config) return null;
    return config.behavior;
  }, [config]);

  const listingType = useMemo(() => {
    if (!behavior) return 'product';
    return getListingType(behavior);
  }, [behavior]);

  const orderType = useMemo(() => {
    if (!behavior) return 'purchase';
    return getOrderType(behavior);
  }, [behavior]);

  return {
    config,
    behavior,
    listingType,
    orderType,
    supportsCart: behavior?.supportsCart ?? false,
    requiresTimeSlot: behavior?.requiresTimeSlot ?? false,
    hasDateRange: behavior?.hasDateRange ?? false,
    enquiryOnly: behavior?.enquiryOnly ?? false,
    isNegotiable: behavior?.isNegotiable ?? false,
    hasDuration: behavior?.hasDuration ?? false,
    requiresPreparation: behavior?.requiresPreparation ?? false,
  };
}

// Hook to get behavior for a parent group — now just returns fallback
// Category-level config from DB is the source of truth
export function useGroupBehavior(_parentGroup: ParentGroup | null) {
  return DEFAULT_FALLBACK_BEHAVIOR;
}

export function useCategoryFeature(category: ServiceCategory | null, feature: keyof CategoryBehavior) {
  const { behavior } = useCategoryBehavior(category);
  return behavior?.[feature] ?? false;
}
