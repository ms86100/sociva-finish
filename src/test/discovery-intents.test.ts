import { describe, expect, it } from 'vitest';
import { buildDiscoveryIntents, type DiscoveryCategoryInput } from '@/lib/discovery-intents';

const homeFood: DiscoveryCategoryInput = {
  category: 'home_food',
  parentGroup: 'food_beverages',
  displayName: 'Home Food',
  icon: 'UtensilsCrossed',
  products: [
    { id: '1', name: 'Cakes', image_url: 'https://img/cake.jpg', tags: ['course:dessert'] },
    { id: '2', name: 'Dal Makhani', tags: ['cuisine:north_indian', 'course:main'] },
  ],
};

const repairs: DiscoveryCategoryInput = {
  category: 'repairs',
  parentGroup: 'home_services',
  displayName: 'Repairs',
  icon: 'Wrench',
  products: [{ id: '3', name: 'AC service' }],
};

describe('buildDiscoveryIntents', () => {
  it('never emits a chip with count 0', () => {
    const intents = buildDiscoveryIntents([homeFood, repairs]);
    expect(intents.every((intent) => intent.count > 0)).toBe(true);
  });

  it('leads with live categories on All so services are not buried under meals', () => {
    const intents = buildDiscoveryIntents([homeFood, repairs]);
    expect(intents[0].kind).toBe('category');
    expect(intents.map((i) => i.label)).toContain('Home Food');
    expect(intents.map((i) => i.label)).toContain('Repairs');
  });

  it('does not show Breakfast when no meal:breakfast inventory exists', () => {
    const intents = buildDiscoveryIntents([homeFood]);
    expect(intents.some((i) => i.label === 'Breakfast')).toBe(false);
    expect(intents.some((i) => i.id === 'mood:dessert')).toBe(true);
  });

  it('omits empty categories entirely', () => {
    const emptyDoctors: DiscoveryCategoryInput = {
      category: 'doctors',
      parentGroup: 'healthcare',
      displayName: 'Doctors',
      icon: 'Stethoscope',
      products: [],
    };
    const intents = buildDiscoveryIntents([homeFood, emptyDoctors]);
    expect(intents.some((i) => i.label === 'Doctors')).toBe(false);
  });
});
