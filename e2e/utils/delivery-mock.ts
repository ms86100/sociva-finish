import { type SupabaseClient } from '@supabase/supabase-js';

/**
 * Delivery simulation utilities for GPS tracking chaos tests.
 * Inserts data directly via Supabase client.
 */

interface GPSPoint {
  latitude: number;
  longitude: number;
  recorded_at?: string;
  accuracy_meters?: number;
  speed_kmh?: number;
  heading?: number;
}

/**
 * Simulate normal GPS updates along a route.
 */
export async function simulateGPSUpdates(
  db: SupabaseClient,
  assignmentId: string,
  partnerId: string,
  points: GPSPoint[]
) {
  for (const point of points) {
    await db.from('delivery_locations').insert({
      assignment_id: assignmentId,
      partner_id: partnerId,
      latitude: point.latitude,
      longitude: point.longitude,
      recorded_at: point.recorded_at || new Date().toISOString(),
      accuracy_meters: point.accuracy_meters || 10,
      speed_kmh: point.speed_kmh || 20,
      heading: point.heading || 0,
    });
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Simulate out-of-order GPS updates (timestamp older than last entry).
 */
export async function simulateOutOfOrder(
  db: SupabaseClient,
  assignmentId: string,
  partnerId: string
) {
  const now = Date.now();

  // Insert "newer" point first
  await db.from('delivery_locations').insert({
    assignment_id: assignmentId,
    partner_id: partnerId,
    latitude: 13.035,
    longitude: 77.65,
    recorded_at: new Date(now).toISOString(),
    accuracy_meters: 10,
  });

  // Then insert "older" point (timestamp in the past)
  await db.from('delivery_locations').insert({
    assignment_id: assignmentId,
    partner_id: partnerId,
    latitude: 13.034,
    longitude: 77.649,
    recorded_at: new Date(now - 60_000).toISOString(),
    accuracy_meters: 10,
  });
}

/**
 * Simulate a large GPS jump (50km away).
 */
export async function simulateJump(
  db: SupabaseClient,
  assignmentId: string,
  partnerId: string
) {
  // Normal location
  await db.from('delivery_locations').insert({
    assignment_id: assignmentId,
    partner_id: partnerId,
    latitude: 13.035,
    longitude: 77.65,
    recorded_at: new Date().toISOString(),
    accuracy_meters: 10,
  });

  await new Promise((r) => setTimeout(r, 300));

  // Jump 50km away
  await db.from('delivery_locations').insert({
    assignment_id: assignmentId,
    partner_id: partnerId,
    latitude: 13.485, // ~50km north
    longitude: 77.65,
    recorded_at: new Date().toISOString(),
    accuracy_meters: 10,
  });
}

/**
 * Simulate GPS freeze (same location repeated).
 */
export async function simulateFreeze(
  db: SupabaseClient,
  assignmentId: string,
  partnerId: string,
  count = 10
) {
  for (let i = 0; i < count; i++) {
    await db.from('delivery_locations').insert({
      assignment_id: assignmentId,
      partner_id: partnerId,
      latitude: 13.035,
      longitude: 77.65,
      recorded_at: new Date(Date.now() + i * 5_000).toISOString(),
      accuracy_meters: 10,
      speed_kmh: 0,
    });
  }
}

/**
 * Simulate duplicate location update (same lat/lng/timestamp).
 */
export async function simulateDuplicate(
  db: SupabaseClient,
  assignmentId: string,
  partnerId: string
) {
  const timestamp = new Date().toISOString();
  const point = {
    assignment_id: assignmentId,
    partner_id: partnerId,
    latitude: 13.035,
    longitude: 77.65,
    recorded_at: timestamp,
    accuracy_meters: 10,
  };

  await db.from('delivery_locations').insert(point);
  await db.from('delivery_locations').insert(point);
}
