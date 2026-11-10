/** Session-local seat requests for Home demo cards (and live request tracking). */

export type HomeSeatRequest = {
  id: string;
  hostName: string;
  pickupLabel: string;
  dropLabel: string;
  departTime: string;
  fuelShareRs: number;
  status: 'requested' | 'confirmed';
  liveRideId?: string | null;
  publicationId?: string | null;
  requestedAt: string;
};

const KEY = 'cleaner-city-home-seat-requests-v1';

export function loadHomeSeatRequests(): HomeSeatRequest[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHomeSeatRequests(rows: HomeSeatRequest[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* ignore quota */
  }
}

export function upsertHomeSeatRequest(row: HomeSeatRequest) {
  const rows = loadHomeSeatRequests().filter((r) => r.id !== row.id);
  rows.unshift(row);
  saveHomeSeatRequests(rows.slice(0, 12));
  return rows;
}
