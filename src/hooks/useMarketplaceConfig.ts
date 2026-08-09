// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { loadAppBootstrap } from '@/lib/app-bootstrap';


/**
 * System-wide marketplace config from system_settings + admin_settings.
 * Single source of truth — no frontend defaults for business logic.
 *
 * Uses shared cache key ['system-settings-all'] so useSystemSettingsRaw
 * and useMarketplaceLabels can read from the same cache — zero duplicate queries.
 */
export interface MarketplaceConfig {
  lowStockThreshold: number;
  currencySymbol: string;
  defaultCurrency: string;
  maxBadgesPerCard: number;
  enableScarcity: boolean;
  enablePulseAnimation: boolean;
  fulfillmentLabels: Record<string, string>;
  labels: {
    outOfStock: string;
    soldOut: string;
    unavailable: string;
    contactForPrice: string;
    discountSuffix: string;
    minChargePrefix: string;
    visitPrefix: string;
    ordersSuffix: string;
    viewButton: string;
    fallbackSeller: string;
    durationSuffix: string;
    prepTimeFormat: string;
    defaultPlaceholderEmoji: string;
    defaultButtonLabel: string;
  };
  spiceEmojiMap: Record<string, string>;
  itemConditionLabels: Record<string, { label: string; color: string }>;
  rentalPeriodLabels: Record<string, string>;
}

const FALLBACK_LABELS = {
  outOfStock: 'Out of stock',
  soldOut: 'Sold out',
  unavailable: 'Unavailable',
  contactForPrice: 'Contact for price',
  discountSuffix: '% OFF',
  minChargePrefix: 'Min',
  visitPrefix: 'Visit:',
  ordersSuffix: 'orders',
  viewButton: 'View',
  fallbackSeller: 'Seller',
  durationSuffix: 'min',
  prepTimeFormat: '~{value}m',
  defaultPlaceholderEmoji: '🛒',
  defaultButtonLabel: 'ADD',
};

const FALLBACK_SPICE: Record<string, string> = {
  mild: '🌶️',
  medium: '🌶️🌶️',
  hot: '🌶️🌶️🌶️',
  extra_hot: '🔥',
};

export const MARKETPLACE_FALLBACKS: MarketplaceConfig = {
  lowStockThreshold: 5,
  currencySymbol: '₹',
  defaultCurrency: 'INR',
  maxBadgesPerCard: 2,
  enableScarcity: true,
  enablePulseAnimation: true,
  fulfillmentLabels: {
    delivery: '🚚 Delivery',
    self_pickup: '📍 Pickup',
    both: '🚚 Delivery & Pickup',
  },
  labels: FALLBACK_LABELS,
  spiceEmojiMap: FALLBACK_SPICE,
  itemConditionLabels: {
    new: { label: 'Brand New', color: 'bg-green-100 text-green-800' },
    like_new: { label: 'Like New', color: 'bg-teal-100 text-teal-800' },
    good: { label: 'Good', color: 'bg-blue-100 text-blue-800' },
    fair: { label: 'Fair', color: 'bg-yellow-100 text-yellow-800' },
  },
  rentalPeriodLabels: {
    hourly: 'per hour',
    daily: 'per day',
    weekly: 'per week',
    monthly: 'per month',
  },
};

interface SettingsCacheData {
  sysMap: Record<string, string>;
  adminMap: Record<string, string>;
  config: MarketplaceConfig;
}

function buildConfig(sysMap: Record<string, string>, adminMap: Record<string, string>): MarketplaceConfig {
  let fulfillmentLabels = MARKETPLACE_FALLBACKS.fulfillmentLabels;
  try { if (adminMap.fulfillment_labels) fulfillmentLabels = JSON.parse(adminMap.fulfillment_labels); } catch { /* Keep fallback labels for malformed config. */ }

  let spiceEmojiMap = FALLBACK_SPICE;
  try { if (sysMap.spice_emoji_map) spiceEmojiMap = JSON.parse(sysMap.spice_emoji_map); } catch { /* Keep fallback map for malformed config. */ }

  let itemConditionLabels = MARKETPLACE_FALLBACKS.itemConditionLabels;
  try { if (sysMap.item_condition_labels) itemConditionLabels = JSON.parse(sysMap.item_condition_labels); } catch { /* Keep fallback labels for malformed config. */ }

  let rentalPeriodLabels = MARKETPLACE_FALLBACKS.rentalPeriodLabels;
  try { if (sysMap.rental_period_labels) rentalPeriodLabels = JSON.parse(sysMap.rental_period_labels); } catch { /* Keep fallback labels for malformed config. */ }

  return {
    lowStockThreshold: sysMap.low_stock_threshold != null ? parseInt(sysMap.low_stock_threshold, 10) : 5,
    currencySymbol: sysMap.currency_symbol || '₹',
    defaultCurrency: sysMap.default_currency || 'INR',
    maxBadgesPerCard: sysMap.max_badges_per_card != null ? parseInt(sysMap.max_badges_per_card, 10) : 2,
    enableScarcity: sysMap.enable_scarcity !== 'false',
    enablePulseAnimation: sysMap.enable_pulse_animation !== 'false',
    fulfillmentLabels,
    labels: {
      outOfStock: sysMap.label_out_of_stock || FALLBACK_LABELS.outOfStock,
      soldOut: sysMap.label_sold_out || FALLBACK_LABELS.soldOut,
      unavailable: sysMap.label_unavailable || FALLBACK_LABELS.unavailable,
      contactForPrice: sysMap.label_contact_for_price || FALLBACK_LABELS.contactForPrice,
      discountSuffix: sysMap.label_discount_suffix || FALLBACK_LABELS.discountSuffix,
      minChargePrefix: sysMap.label_min_charge_prefix || FALLBACK_LABELS.minChargePrefix,
      visitPrefix: sysMap.label_visit_prefix || FALLBACK_LABELS.visitPrefix,
      ordersSuffix: sysMap.label_orders_suffix || FALLBACK_LABELS.ordersSuffix,
      viewButton: sysMap.label_view_button || FALLBACK_LABELS.viewButton,
      fallbackSeller: sysMap.label_fallback_seller || FALLBACK_LABELS.fallbackSeller,
      durationSuffix: sysMap.label_duration_suffix || FALLBACK_LABELS.durationSuffix,
      prepTimeFormat: sysMap.label_prep_time_format || FALLBACK_LABELS.prepTimeFormat,
      defaultPlaceholderEmoji: sysMap.default_placeholder_emoji || FALLBACK_LABELS.defaultPlaceholderEmoji,
      defaultButtonLabel: sysMap.default_button_label || FALLBACK_LABELS.defaultButtonLabel,
    },
    spiceEmojiMap,
    itemConditionLabels,
    rentalPeriodLabels,
  };
}

export function useMarketplaceConfig(): MarketplaceConfig {
  const { data } = useQuery({
    queryKey: ['system-settings-all'],
    // PERF: reads from the shared single-request bootstrap instead of firing
    // its own system_settings + admin_settings queries.
    queryFn: async (): Promise<SettingsCacheData> => {
      const { sysMap, adminMap } = await loadAppBootstrap();
      return { sysMap, adminMap, config: buildConfig(sysMap, adminMap) };
    },
    staleTime: 30 * 60 * 1000,
  });

  return data?.config ?? MARKETPLACE_FALLBACKS;
}

