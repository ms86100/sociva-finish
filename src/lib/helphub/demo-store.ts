import { HELPHUB_LISTING_DAYS, type HelpHubCallFeedbackValue } from './constants';
import {
  HELPHUB_MOCK_ENQUIRIES,
  HELPHUB_MOCK_LISTINGS,
  HELPHUB_MOCK_SOCIETY_ID,
} from './mock-data';
import type {
  HelpHubCreateListingInput,
  HelpHubEnquiry,
  HelpHubEnquiryStatus,
  HelpHubListing,
} from './types';

const LISTINGS_KEY = 'sociva_helphub_demo_listings';
const ENQUIRIES_KEY = 'sociva_helphub_demo_enquiries';
const FEEDBACK_KEY = 'sociva_helphub_demo_call_feedback';

export interface HelpHubCallFeedbackRow {
  id: string;
  society_id: string;
  listing_id: string;
  from_user_id: string;
  outcome: HelpHubCallFeedbackValue;
  note?: string | null;
  created_at: string;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

export function getDemoListings(): HelpHubListing[] {
  const stored = readJson<HelpHubListing[] | null>(LISTINGS_KEY, null);
  const activeStored = (stored || []).filter((l) => l.status === 'active');
  // Prefer fresh seed rows for built-in sample ids so flat/name/phone stay current
  const byId = new Map<string, HelpHubListing>();
  for (const row of activeStored) {
    if (!String(row.id).startsWith('hh-') || String(row.id).startsWith('hh-demo-')) {
      byId.set(row.id, row);
    }
  }
  for (const seed of HELPHUB_MOCK_LISTINGS) {
    if (seed.status === 'active') byId.set(seed.id, seed);
  }
  const merged = Array.from(byId.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  writeJson(LISTINGS_KEY, merged);
  return merged;
}

export function getDemoEnquiries(): HelpHubEnquiry[] {
  return readJson<HelpHubEnquiry[]>(ENQUIRIES_KEY, [...HELPHUB_MOCK_ENQUIRIES]);
}

export function createDemoListing(
  input: HelpHubCreateListingInput,
  userId: string,
  recommenderName?: string,
): HelpHubListing {
  if (!input.consent_confirmed) {
    throw new Error('Consent is required before publishing');
  }
  const now = new Date();
  const expires = new Date(now);
  expires.setDate(expires.getDate() + HELPHUB_LISTING_DAYS);

  const listing: HelpHubListing = {
    id: `hh-demo-${Date.now()}`,
    society_id: HELPHUB_MOCK_SOCIETY_ID,
    created_by: userId || 'demo-user',
    display_name: input.display_name.trim(),
    category: input.category,
    work_type: input.work_type,
    availability: input.availability,
    available_from: input.available_from || null,
    available_to: input.available_to || null,
    preferred_area: input.preferred_area || 'Within society',
    languages: input.languages || [],
    description: input.description || null,
    expected_salary: input.expected_salary ?? null,
    experience_years: input.experience_years ?? null,
    source: input.source,
    status: 'active',
    recommender_name:
      input.source === 'self_registered' ? null : recommenderName || 'A resident',
    recommender_flat:
      input.source === 'self_registered' ? null : input.recommender_flat || null,
    tower_or_block: input.tower_or_block || null,
    contact_phone: input.private_phone || null,
    expires_at: expires.toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  const listings = getDemoListings();
  writeJson(LISTINGS_KEY, [listing, ...listings]);
  if (input.private_phone) {
    try {
      const key = 'sociva_helphub_demo_phones';
      const map = JSON.parse(sessionStorage.getItem(key) || '{}') as Record<string, string>;
      map[listing.id] = input.private_phone;
      sessionStorage.setItem(key, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }
  return listing;
}

export function createDemoEnquiry(
  listingId: string,
  fromUserId: string,
  message?: string,
): HelpHubEnquiry {
  const existing = getDemoEnquiries().find(
    (e) =>
      e.listing_id === listingId &&
      e.from_user_id === fromUserId &&
      e.status === 'pending',
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const enquiry: HelpHubEnquiry = {
    id: `hh-enq-${Date.now()}`,
    listing_id: listingId,
    from_user_id: fromUserId || 'demo-user',
    status: 'pending',
    message: message || null,
    created_at: now,
    updated_at: now,
  };
  writeJson(ENQUIRIES_KEY, [enquiry, ...getDemoEnquiries()]);
  return enquiry;
}

export function updateDemoEnquiryStatus(
  enquiryId: string,
  status: HelpHubEnquiryStatus,
  sharedPhone?: string,
): HelpHubEnquiry | null {
  const enquiries = getDemoEnquiries();
  const idx = enquiries.findIndex((e) => e.id === enquiryId);
  if (idx < 0) return null;
  const next = {
    ...enquiries[idx],
    status,
    shared_phone: status === 'contact_shared' ? sharedPhone || enquiries[idx].shared_phone : enquiries[idx].shared_phone,
    updated_at: new Date().toISOString(),
  };
  enquiries[idx] = next;
  writeJson(ENQUIRIES_KEY, enquiries);
  return next;
}

export function updateDemoListingStatus(
  listingId: string,
  status: HelpHubListing['status'],
  userId: string,
): HelpHubListing | null {
  const listings = getDemoListings();
  const idx = listings.findIndex((l) => l.id === listingId);
  if (idx < 0) return null;
  if (listings[idx].created_by !== userId && !userId.startsWith('admin')) {
    throw new Error('Not authorized to update this listing');
  }
  const next = {
    ...listings[idx],
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === 'active') {
    const expires = new Date();
    expires.setDate(expires.getDate() + HELPHUB_LISTING_DAYS);
    next.expires_at = expires.toISOString();
  }
  listings[idx] = next;
  writeJson(LISTINGS_KEY, listings);
  return next;
}

/** True when hash/query includes demo=1 (HashRouter-safe). */
export function isHelpHubDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash || '';
  const queryFromHash = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const combined = `${window.location.search.replace(/^\?/, '')}&${queryFromHash}`;
  const params = new URLSearchParams(combined);
  if (params.get('live') === '1') return false;
  return params.get('demo') === '1';
}

export function getDemoCallFeedback(): HelpHubCallFeedbackRow[] {
  return readJson<HelpHubCallFeedbackRow[]>(FEEDBACK_KEY, []);
}

export function createDemoCallFeedback(
  listingId: string,
  fromUserId: string,
  outcome: HelpHubCallFeedbackValue,
  note?: string,
): HelpHubCallFeedbackRow {
  if (outcome === 'other' && (!note || note.trim().length < 3)) {
    throw new Error('A short note is required for Other');
  }
  const row: HelpHubCallFeedbackRow = {
    id: `hh-fb-${Date.now()}`,
    society_id: HELPHUB_MOCK_SOCIETY_ID,
    listing_id: listingId,
    from_user_id: fromUserId || 'demo-user',
    outcome,
    note: note?.trim() || null,
    created_at: new Date().toISOString(),
  };
  writeJson(FEEDBACK_KEY, [row, ...getDemoCallFeedback()]);
  return row;
}
