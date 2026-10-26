import { listingPrepMinutes } from '@/lib/guided-discovery';
import { listingsSellingWell } from '@/lib/selling-well';
import { hasRailDensity } from '@/lib/discovery-density';

export const ROOM_BESTSELLERS_HEADING = 'Bestsellers nearby';
export const ROOM_VALUE_HEADING = 'Under ₹150';
export const ROOM_READY_HEADING = 'Ready soon';
export const ROOM_CONTINUE_HOME = 'Explore Restaurant Food';
export const ROOM_CONTINUE_RESTAURANT = 'Explore Home Food';

export interface RoomRailListing {
  id: string;
  seller_id?: string | null;
  price?: number | null;
  completed_order_count?: number | null;
  prep_time_minutes?: number | null;
  lead_time_hours?: number | null;
  avg_preparation_time?: number | null;
}

export interface GuidedRoomRails<T extends RoomRailListing> {
  bestsellers: T[];
  underValue: T[];
  readySoon: T[];
}

const VALUE_MAX = 150;
const READY_MAX_MINUTES = 45;
const RAIL_LIMIT = 8;

function prepMinutes(listing: RoomRailListing): number | null {
  const fromListing = listingPrepMinutes(listing);
  if (fromListing != null) return fromListing;
  const avg = Number(listing.avg_preparation_time);
  if (Number.isFinite(avg) && avg > 0) return Math.round(avg);
  return null;
}

function takeUniqueById<T extends { id: string }>(
  candidates: readonly T[],
  used: Set<string>,
  limit: number,
): T[] {
  const out: T[] = [];
  for (const item of candidates) {
    if (used.has(item.id)) continue;
    used.add(item.id);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Merchandising slices for Home Food / Restaurant Food rooms.
 * Rails prefer distinct dishes so the page does not feel like one repeated grid.
 */
export function buildGuidedRoomRails<T extends RoomRailListing>(
  listings: readonly T[],
): GuidedRoomRails<T> {
  const used = new Set<string>();

  const bestsellers = takeUniqueById(
    listingsSellingWell(listings, { limit: RAIL_LIMIT, minSellers: 1, maxPerSeller: 2 }),
    used,
    RAIL_LIMIT,
  );

  const valuePool = listings
    .filter((row) => Number(row.price) > 0 && Number(row.price) <= VALUE_MAX)
    .slice()
    .sort((a, b) => Number(a.price) - Number(b.price));
  const underValue = takeUniqueById(valuePool, used, RAIL_LIMIT);

  const readyPool = listings
    .map((row) => ({ row, prep: prepMinutes(row) }))
    .filter((entry): entry is { row: T; prep: number } => entry.prep != null && entry.prep > 0 && entry.prep <= READY_MAX_MINUTES)
    .sort((a, b) => a.prep - b.prep)
    .map((entry) => entry.row);
  const readySoon = takeUniqueById(readyPool, used, RAIL_LIMIT);

  return {
    bestsellers: hasRailDensity(bestsellers.length) ? bestsellers : [],
    underValue: hasRailDensity(underValue.length) ? underValue : [],
    readySoon: hasRailDensity(readySoon.length) ? readySoon : [],
  };
}

export function roomContinueHref(hubId: 'home_food' | 'restaurant_food'): string {
  return hubId === 'home_food' ? '/explore/restaurant_food' : '/explore/home_food';
}

export function roomContinueLabel(hubId: 'home_food' | 'restaurant_food'): string {
  return hubId === 'home_food' ? ROOM_CONTINUE_HOME : ROOM_CONTINUE_RESTAURANT;
}
