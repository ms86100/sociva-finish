// @ts-nocheck
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMarketplaceConfig } from '@/hooks/useMarketplaceConfig';
import { jitteredStaleTime } from '@/lib/query-utils';

export interface SystemSettings {
  baseDeliveryFee: number;
  freeDeliveryThreshold: number;
  platformFeePercent: number;
  supportEmail: string;
  grievanceEmail: string;
  dpoEmail: string;
  grievanceOfficerName: string;
  headerTagline: string;
  appVersion: string;
  addressBlockLabel: string;
  addressFlatLabel: string;
  termsLastUpdated: string;
  privacyLastUpdated: string;
  helpSectionsJson: string;
  termsContentMd: string;
  privacyContentMd: string;
  currencySymbol: string;
  budgetFilterThreshold: number;
  platformName: string;
  violationPolicyJson: string;
  sellerEmptyStateCopy: string;
  landingSlidesJson: string;
  maxPriceFilter: number;
  locale: string;
  upiProviderLabel: string;
  defaultCountryCode: string;
  supportedCountryCodes: string[];
  refundPromiseText: string;
  refundSlaHours: number;
}

const DEFAULTS: SystemSettings = {
  baseDeliveryFee: 20,
  freeDeliveryThreshold: 500,
  platformFeePercent: 0,
  supportEmail: 'support@sociva.com',
  grievanceEmail: 'grievance@sociva.in',
  dpoEmail: 'dpo@sociva.com',
  grievanceOfficerName: 'Sociva Grievance Cell',
  headerTagline: 'Your Society, Your Store',
  appVersion: '2.0.0',
  addressBlockLabel: 'Block / Tower',
  addressFlatLabel: 'Flat Number',
  termsLastUpdated: 'February 13, 2026',
  privacyLastUpdated: 'February 13, 2026',
  helpSectionsJson: '',
  termsContentMd: '',
  privacyContentMd: '',
  currencySymbol: '₹',
  budgetFilterThreshold: 150,
  platformName: 'Sociva',
  violationPolicyJson: '',
  sellerEmptyStateCopy: 'Sell products, groceries, or services to your community',
  landingSlidesJson: '',
  maxPriceFilter: 50000,
  locale: 'en-IN',
  upiProviderLabel: 'GPay, PhonePe, Paytm',
  defaultCountryCode: '+91',
  supportedCountryCodes: ['+91', '+1', '+44', '+971', '+65', '+61'],
  refundPromiseText: 'If anything goes wrong, refund within 24 hours',
  refundSlaHours: 24,
};

function buildSettingsFromMap(map: Record<string, string>): SystemSettings {
  return {
    baseDeliveryFee: map.base_delivery_fee != null ? parseInt(map.base_delivery_fee, 10) : 20,
    freeDeliveryThreshold: map.free_delivery_threshold != null ? parseInt(map.free_delivery_threshold, 10) : 500,
    platformFeePercent: map.platform_fee_percent != null ? parseFloat(map.platform_fee_percent) : 0,
    supportEmail: map.support_email || DEFAULTS.supportEmail,
    grievanceEmail: map.grievance_email || DEFAULTS.grievanceEmail,
    dpoEmail: map.dpo_email || DEFAULTS.dpoEmail,
    grievanceOfficerName: map.grievance_officer_name || DEFAULTS.grievanceOfficerName,
    headerTagline: map.header_tagline || DEFAULTS.headerTagline,
    appVersion: map.app_version || DEFAULTS.appVersion,
    addressBlockLabel: map.address_block_label || DEFAULTS.addressBlockLabel,
    addressFlatLabel: map.address_flat_label || DEFAULTS.addressFlatLabel,
    termsLastUpdated: map.terms_last_updated || DEFAULTS.termsLastUpdated,
    privacyLastUpdated: map.privacy_last_updated || DEFAULTS.privacyLastUpdated,
    helpSectionsJson: map.help_sections_json || DEFAULTS.helpSectionsJson,
    termsContentMd: map.terms_content_md || DEFAULTS.termsContentMd,
    privacyContentMd: map.privacy_content_md || DEFAULTS.privacyContentMd,
    currencySymbol: map.currency_symbol || DEFAULTS.currencySymbol,
    budgetFilterThreshold: map.budget_filter_threshold != null ? parseInt(map.budget_filter_threshold, 10) : 150,
    platformName: map.platform_name || DEFAULTS.platformName,
    violationPolicyJson: map.violation_policy_json || DEFAULTS.violationPolicyJson,
    sellerEmptyStateCopy: map.seller_empty_state_copy || DEFAULTS.sellerEmptyStateCopy,
    landingSlidesJson: map.landing_slides_json || DEFAULTS.landingSlidesJson,
    maxPriceFilter: map.max_price_filter != null ? parseInt(map.max_price_filter, 10) : 50000,
    locale: map.locale || DEFAULTS.locale,
    upiProviderLabel: map.upi_provider_label || DEFAULTS.upiProviderLabel,
    defaultCountryCode: map.default_country_code || DEFAULTS.defaultCountryCode,
    supportedCountryCodes: map.supported_country_codes
      ? map.supported_country_codes.split(',').map(c => c.trim())
      : DEFAULTS.supportedCountryCodes,
    refundPromiseText: map.refund_promise_text || DEFAULTS.refundPromiseText,
    refundSlaHours: map.refund_sla_hours != null ? parseInt(map.refund_sla_hours, 10) : 24,
  };
}

/**
 * Full settings object — reads from the shared ['system-settings-all'] cache
 * populated by useMarketplaceConfig. Zero additional network calls.
 */
export function useSystemSettings(): SystemSettings {
  // Ensure the shared cache is populated
  useMarketplaceConfig();

  const queryClient = useQueryClient();
  const cached = queryClient.getQueryData<{ sysMap: Record<string, string> }>(['system-settings-all']);

  if (cached?.sysMap) {
    return buildSettingsFromMap(cached.sysMap);
  }

  return DEFAULTS;
}

/**
 * Selector-based hook — only re-renders when the selected value changes.
 * Usage: const symbol = useSystemSetting(s => s.currencySymbol);
 */
export function useSystemSetting<T>(selector: (settings: SystemSettings) => T): T {
  useMarketplaceConfig();

  const queryClient = useQueryClient();
  const cached = queryClient.getQueryData<{ sysMap: Record<string, string> }>(['system-settings-all']);
  const settings = cached?.sysMap ? buildSettingsFromMap(cached.sysMap) : DEFAULTS;

  return selector(settings);
}
