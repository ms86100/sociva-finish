// @ts-nocheck
/**
 * Sociva Green System — light 50-level pastels for category cards.
 * Softer, more cohesive, brand-aligned backgrounds.
 */
export const CATEGORY_PASTELS: Record<string, string> = {
  home_food: '#E8F5E9',
  bakery: '#F1F8E9',
  snacks: '#E0F2F1',
  groceries: '#E3F2FD',
  beverages: '#E8F5F2',
  dairy: '#FFF8E1',
  fruits: '#E8F5E9',
  vegetables: '#F1F8E9',
  sweets: '#FFF3E0',
  meat: '#FBE9E7',
  seafood: '#E0F7FA',
  pet_supplies: '#F3E5F5',
  stationery: '#E8EAF6',
  electronics: '#E3F2FD',
  clothing: '#FCE4EC',
  beauty: '#FCE4EC',
  health: '#E0F2F1',
  home_services: '#E8F5E9',
  cleaning: '#E0F7FA',
  repairs: '#FFF8E1',
  puja: '#FFF3E0',
  gifting: '#FCE4EC',
  pharmacy: '#E0F2F1',
  laundry: '#E0F7FA',
  fitness: '#E8F5E9',
  tutoring: '#E8EAF6',
  salon: '#FCE4EC',
  catering: '#FFF3E0',
};

export const DEFAULT_PASTEL = '#F5F5F5';

export function getCategoryPastel(category: string, fallbackColor?: string | null): string {
  if (CATEGORY_PASTELS[category]) return CATEGORY_PASTELS[category];
  // If we have a hex color from DB, lighten it
  if (fallbackColor && fallbackColor.startsWith('#')) {
    return `${fallbackColor}40`;
  }
  return DEFAULT_PASTEL;
}
