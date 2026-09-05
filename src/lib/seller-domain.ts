/**
 * Seller-facing domain (Product / Service / Listing) derived from category_config.
 * Action types stay on default_action_type — domain only gates forms and browse labels.
 */

import { journeyFromTransactionType, type BuyerJourneyId } from '@/lib/buyer-journey';
import { commerceModelFromActionType, type CommerceModel } from '@/lib/listing-intent';

export type SellerDomain = 'product' | 'service' | 'listing';

export const SELLER_DOMAIN_LABEL: Record<SellerDomain, string> = {
  product: 'Product',
  service: 'Service',
  listing: 'Professional / Listing',
};

export interface CategoryDomainInput {
  sellerDomain?: SellerDomain | string | null;
  parentGroup?: string | null;
  category?: string | null;
  supportsCart?: boolean;
  isPhysicalProduct?: boolean;
  enquiryOnly?: boolean;
  requiresTimeSlot?: boolean;
  defaultActionType?: string | null;
  transactionType?: string | null;
}

/** Infer domain when seller_domain column is null (backward compatible). */
export function inferSellerDomain(input: CategoryDomainInput): SellerDomain {
  const explicit = String(input.sellerDomain || '').toLowerCase();
  if (explicit === 'product' || explicit === 'service' || explicit === 'listing') {
    return explicit;
  }

  const group = String(input.parentGroup || '');
  const slug = String(input.category || '');
  const action = String(input.defaultActionType || '');
  const tx = String(input.transactionType || '');

  if (group === 'property' || action === 'contact_seller' || tx === 'contact_enquiry') {
    return 'listing';
  }
  if (group === 'events') return 'listing';
  if (
    group === 'professional' &&
    !input.requiresTimeSlot &&
    (input.enquiryOnly || action === 'request_service')
  ) {
    return 'listing';
  }
  if (group === 'resale' || slug === 'pet_food') return 'product';
  if (input.supportsCart || action === 'add_to_cart') return 'product';
  if (input.isPhysicalProduct && group === 'food_beverages') return 'product';
  return 'service';
}

export function commerceModelFromCategory(input: CategoryDomainInput): CommerceModel {
  if (input.transactionType) {
    return journeyFromTransactionType(input.transactionType) as CommerceModel;
  }
  if (input.defaultActionType) {
    return commerceModelFromActionType(input.defaultActionType);
  }
  const domain = inferSellerDomain(input);
  if (domain === 'product') return 'cart';
  if (domain === 'listing') return 'contact';
  return 'book';
}

export function domainFormFlags(domain: SellerDomain) {
  return {
    showPriceMrp: domain === 'product' || domain === 'service',
    showStock: domain === 'product',
    showFoodFacets: domain === 'product',
    showServiceFields: domain === 'service',
    showContactForPrice: domain === 'listing',
    allowZeroPrice: domain === 'listing' || domain === 'service',
  };
}

/** Seller-facing nouns for the listing form (does not change default_action_type). */
export function offeringCopy(domain: SellerDomain) {
  if (domain === 'service') {
    return {
      catalogHeading: 'Your services',
      emptyHint: 'Add your first service — even one offering is enough to get started.',
      formTitleNew: 'New service',
      formTitleEdit: 'Edit service',
      namePlaceholder: 'e.g. Full dog grooming',
      nameRequired: 'Service name is required',
      imageLabel: 'Service photo',
      imageRequired: 'A service photo is required',
      imagePlaceholder: 'Upload a photo of this service',
      save: 'Save service',
      update: 'Update service',
      addAnother: 'Add another service',
      deleteTitle: 'Delete this service?',
      previewFallbackName: 'Service name',
      previewPageHint: 'Tap “View Details” to preview how buyers will see this service',
    };
  }
  if (domain === 'listing') {
    return {
      catalogHeading: 'Your listings',
      emptyHint: 'Add your first listing — even one is enough to get started.',
      formTitleNew: 'New listing',
      formTitleEdit: 'Edit listing',
      namePlaceholder: 'e.g. ITR filing for salaried',
      nameRequired: 'Listing name is required',
      imageLabel: 'Listing photo',
      imageRequired: 'A listing photo is required',
      imagePlaceholder: 'Upload a photo for this listing',
      save: 'Save listing',
      update: 'Update listing',
      addAnother: 'Add another listing',
      deleteTitle: 'Delete this listing?',
      previewFallbackName: 'Listing name',
      previewPageHint: 'Tap “View Details” to preview how buyers will see this listing',
    };
  }
  return {
    catalogHeading: 'Your products',
    emptyHint: 'Add your first product — even one item is enough to get started.',
    formTitleNew: 'New product',
    formTitleEdit: 'Edit product',
    namePlaceholder: 'e.g. Homemade rajma chawal',
    nameRequired: 'Product name is required',
    imageLabel: 'Product photo',
    imageRequired: 'A product photo is required',
    imagePlaceholder: 'Upload a product photo',
    save: 'Save product',
    update: 'Update product',
    addAnother: 'Add another product',
    deleteTitle: 'Delete this product?',
    previewFallbackName: 'Product name',
    previewPageHint: 'Tap “View Details” to preview the full product page',
  };
}

export function normalizeDomainLabel(domain: SellerDomain): string {
  return SELLER_DOMAIN_LABEL[domain];
}

export function journeyIdFromCategory(input: CategoryDomainInput): BuyerJourneyId {
  return commerceModelFromCategory(input) as BuyerJourneyId;
}
