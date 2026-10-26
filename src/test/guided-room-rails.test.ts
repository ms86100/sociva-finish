import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildGuidedRoomRails,
  ROOM_BESTSELLERS_HEADING,
  ROOM_READY_HEADING,
  ROOM_VALUE_HEADING,
  roomContinueHref,
  roomContinueLabel,
} from '@/lib/guided-room-rails';

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('guided room rails', () => {
  it('builds distinct merchandising rails from inventory', () => {
    const listings = [
      { id: 'a', seller_id: 's1', price: 99, completed_order_count: 8, prep_time_minutes: 20 },
      { id: 'b', seller_id: 's2', price: 120, completed_order_count: 5, prep_time_minutes: 30 },
      { id: 'c', seller_id: 's1', price: 80, completed_order_count: 0, prep_time_minutes: 15 },
      { id: 'd', seller_id: 's3', price: 200, completed_order_count: 2, prep_time_minutes: 90 },
      { id: 'e', seller_id: 's4', price: 140, completed_order_count: 0, prep_time_minutes: 40 },
    ];
    const rails = buildGuidedRoomRails(listings);
    expect(rails.bestsellers.map((row) => row.id)).toEqual(expect.arrayContaining(['a', 'b']));
    expect(rails.underValue.every((row) => Number(row.price) <= 150)).toBe(true);
    expect(rails.readySoon.every((row) => (row.prep_time_minutes || 99) <= 45)).toBe(true);
    const ids = [
      ...rails.bestsellers.map((row) => row.id),
      ...rails.underValue.map((row) => row.id),
      ...rails.readySoon.map((row) => row.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('wires Home/Restaurant rooms with hero, kitchens, swipe rails, and continue', () => {
    const page = read('src/pages/GuidedDiscoveryHubPage.tsx');
    expect(page).toContain('GuidedRoomHero');
    expect(page).toContain('CookingNearbyRail');
    expect(page).toContain('GuidedRoomSwipeRail');
    expect(page).toContain('ROOM_BESTSELLERS_HEADING');
    expect(page).toContain('ROOM_VALUE_HEADING');
    expect(page).toContain('ROOM_READY_HEADING');
    expect(ROOM_BESTSELLERS_HEADING).toBe('Bestsellers nearby');
    expect(ROOM_VALUE_HEADING).toBe('Under ₹150');
    expect(ROOM_READY_HEADING).toBe('Ready soon');
    expect(page).toContain('guided-room-continue');
    expect(page).toContain('Keep exploring');
    expect(read('src/components/discovery/GuidedRoomSwipeRail.tsx')).toContain('taste-rail-scroll');
    expect(read('src/components/discovery/GuidedDiscoveryProductRow.tsx')).toContain('aspect-[4/5]');
    expect(read('src/components/discovery/GuidedRoomSwipeRail.tsx')).toContain('aspect-[3/4]');
    expect(roomContinueHref('home_food')).toBe('/explore/restaurant_food');
    expect(roomContinueLabel('restaurant_food')).toMatch(/Home Food/);
  });
});
