// @ts-nocheck
// Service Category Types for Society Super-App
// Now using TEXT type in database for dynamic category management

export type ServiceCategory = string;

export type PredefinedCategory =
  | 'home_food' | 'bakery' | 'snacks' | 'groceries' | 'beverages'
  | 'tuition' | 'daycare' | 'coaching'
  | 'yoga' | 'dance' | 'music' | 'art_craft' | 'language' | 'fitness'
  | 'electrician' | 'plumber' | 'carpenter' | 'ac_service' | 'pest_control' | 'appliance_repair'
  | 'maid' | 'cook' | 'driver' | 'nanny'
  | 'tailoring' | 'laundry' | 'beauty' | 'mehendi' | 'salon'
  | 'tax_consultant' | 'it_support' | 'tutoring' | 'resume_writing'
  | 'equipment_rental' | 'vehicle_rental' | 'party_supplies' | 'baby_gear'
  | 'furniture' | 'electronics' | 'books' | 'toys' | 'kitchen' | 'clothing'
  | 'catering' | 'decoration' | 'photography' | 'dj_music'
  | 'pet_food' | 'pet_grooming' | 'pet_sitting' | 'dog_walking'
  | 'flat_rent' | 'roommate' | 'parking';

export type ParentGroup = string;

export type ListingType = 'product' | 'service' | 'rental' | 'resale';
export type OrderType = 'purchase' | 'booking' | 'rental' | 'enquiry';
export type RentalPeriodType = 'hourly' | 'daily' | 'weekly' | 'monthly';
export type ItemCondition = 'new' | 'like_new' | 'good' | 'fair';

export interface CategoryBehavior {
  isPhysicalProduct: boolean;
  requiresPreparation: boolean;
  requiresTimeSlot: boolean;
  requiresDelivery: boolean;
  supportsCart: boolean;
  enquiryOnly: boolean;
  hasQuantity: boolean;
  hasDuration: boolean;
  hasDateRange: boolean;
  isNegotiable: boolean;
}

export interface CategoryFormHints {
  namePlaceholder: string | null;
  descriptionPlaceholder: string | null;
  priceLabel: string;
  durationLabel: string | null;
  showVegToggle: boolean;
  showDurationField: boolean;
  primaryButtonLabel: string | null;
  pricePrefix: string | null;
  placeholderEmoji: string | null;
}

export interface CategoryDisplayConfig {
  supportsBrandDisplay: boolean;
  supportsWarrantyDisplay: boolean;
  imageAspectRatio: string;
  imageObjectFit: string;
}

export interface CategoryConfig {
  id: string;
  category: ServiceCategory;
  displayName: string;
  icon: string;
  color: string;
  parentGroup: ParentGroup;
  layoutType: 'ecommerce' | 'food' | 'service';
  behavior: CategoryBehavior;
  formHints: CategoryFormHints;
  display: CategoryDisplayConfig;
  imageUrl: string | null;
  displayOrder: number;
  isActive: boolean;
  transactionType?: string;
  supportsAddons: boolean;
  supportsRecurring: boolean;
  supportsStaffAssignment: boolean;
}

export const DEFAULT_FALLBACK_BEHAVIOR: CategoryBehavior = {
  isPhysicalProduct: false,
  requiresPreparation: false,
  requiresTimeSlot: false,
  requiresDelivery: false,
  supportsCart: false,
  enquiryOnly: false,
  hasQuantity: false,
  hasDuration: false,
  hasDateRange: false,
  isNegotiable: false,
};

// DEFAULT_GROUP_BEHAVIORS removed — category_config DB table is the source of truth

export function getListingType(behavior: CategoryBehavior): ListingType {
  if (behavior.hasDateRange) return 'rental';
  if (behavior.enquiryOnly && behavior.isNegotiable) return 'resale';
  if (behavior.requiresTimeSlot || behavior.hasDuration) return 'service';
  return 'product';
}

export function getOrderType(behavior: CategoryBehavior): OrderType {
  if (behavior.enquiryOnly) return 'enquiry';
  if (behavior.hasDateRange) return 'rental';
  if (behavior.requiresTimeSlot || behavior.hasDuration) return 'booking';
  return 'purchase';
}

// ExtendedOrderStatus removed — workflow engine DB tables are the source of truth
// EXTENDED_ORDER_STATUS_LABELS removed — now in order_status_config DB table
// ITEM_CONDITION_LABELS removed — now in system_settings.item_condition_labels
// RENTAL_PERIOD_LABELS removed — now in system_settings.rental_period_labels
