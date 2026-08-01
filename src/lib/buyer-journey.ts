/**
 * Single writer for category → buyer journey alignment.
 * Admin picks a journey; we stamp transaction_type, default_action_type, and behavior flags together.
 */

export type BuyerJourneyId = 'cart' | 'book' | 'enquire' | 'contact';

export interface BuyerJourneyDefinition {
  id: BuyerJourneyId;
  label: string;
  description: string;
  transaction_type: string;
  default_action_type: string;
  flags: {
    supports_cart: boolean;
    enquiry_only: boolean;
    requires_time_slot: boolean;
    requires_preparation: boolean;
    requires_delivery: boolean;
    is_physical_product: boolean;
    has_quantity: boolean;
    has_duration: boolean;
    has_date_range: boolean;
    is_negotiable: boolean;
  };
}

export const BUYER_JOURNEYS: BuyerJourneyDefinition[] = [
  {
    id: 'cart',
    label: 'Cart / Buy',
    description: 'Add to cart, checkout, accept → deliver',
    transaction_type: 'cart_purchase',
    default_action_type: 'add_to_cart',
    flags: {
      supports_cart: true,
      enquiry_only: false,
      requires_time_slot: false,
      requires_preparation: true,
      requires_delivery: true,
      is_physical_product: true,
      has_quantity: true,
      has_duration: false,
      has_date_range: false,
      is_negotiable: false,
    },
  },
  {
    id: 'book',
    label: 'Book / Schedule',
    description: 'Time-slot booking (classes, visits, services)',
    transaction_type: 'service_booking',
    default_action_type: 'book',
    flags: {
      supports_cart: false,
      enquiry_only: false,
      requires_time_slot: true,
      requires_preparation: false,
      requires_delivery: false,
      is_physical_product: false,
      has_quantity: false,
      has_duration: true,
      has_date_range: false,
      is_negotiable: false,
    },
  },
  {
    id: 'enquire',
    label: 'Enquire / Quote',
    description: 'Request quote or custom service',
    transaction_type: 'request_service',
    default_action_type: 'request_service',
    flags: {
      supports_cart: false,
      enquiry_only: true,
      requires_time_slot: false,
      requires_preparation: false,
      requires_delivery: false,
      is_physical_product: false,
      has_quantity: false,
      has_duration: false,
      has_date_range: false,
      is_negotiable: true,
    },
  },
  {
    id: 'contact',
    label: 'Contact seller',
    description: 'Short contact / chat enquiry',
    transaction_type: 'contact_enquiry',
    default_action_type: 'contact_seller',
    flags: {
      supports_cart: false,
      enquiry_only: true,
      requires_time_slot: false,
      requires_preparation: false,
      requires_delivery: false,
      is_physical_product: false,
      has_quantity: false,
      has_duration: false,
      has_date_range: false,
      is_negotiable: false,
    },
  },
];

const TX_TO_JOURNEY: Record<string, BuyerJourneyId> = {
  cart_purchase: 'cart',
  seller_delivery: 'cart',
  self_fulfillment: 'cart',
  service_booking: 'book',
  request_service: 'enquire',
  contact_enquiry: 'contact',
};

export function journeyFromTransactionType(tx: string | null | undefined): BuyerJourneyId {
  return TX_TO_JOURNEY[tx || ''] || 'cart';
}

export function getJourney(id: BuyerJourneyId): BuyerJourneyDefinition {
  return BUYER_JOURNEYS.find((j) => j.id === id) || BUYER_JOURNEYS[0];
}

/** Payload fields to merge into category_config on save. */
export function journeyPayload(id: BuyerJourneyId) {
  const j = getJourney(id);
  return {
    transaction_type: j.transaction_type,
    default_action_type: j.default_action_type,
    ...j.flags,
  };
}
