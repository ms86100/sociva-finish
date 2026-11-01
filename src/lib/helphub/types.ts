export type HelpHubSource =
  | 'resident_recommendation'
  | 'self_registered'
  | 'assisted';

export type HelpHubListingStatus =
  | 'draft'
  | 'pending_consent'
  | 'active'
  | 'paused'
  | 'hired'
  | 'expired'
  | 'removed'
  | 'suspended';

export type HelpHubWorkType = 'part_time' | 'full_time' | 'live_in' | 'hourly';

export type HelpHubAvailability =
  | 'morning'
  | 'afternoon'
  | 'evening'
  | 'flexible';

export type HelpHubEnquiryStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'contact_shared'
  | 'closed';

export type HelpHubCategory =
  | 'maid'
  | 'cook'
  | 'nanny'
  | 'babysitter'
  | 'driver'
  | 'elderly_care'
  | 'caretaker'
  | 'gardener'
  | 'laundry'
  | 'other';

export interface HelpHubListing {
  id: string;
  society_id: string;
  created_by: string;
  display_name: string;
  category: HelpHubCategory;
  work_type: HelpHubWorkType;
  availability: HelpHubAvailability;
  /** Typical daily start, HH:MM */
  available_from?: string | null;
  /** Typical daily end, HH:MM */
  available_to?: string | null;
  preferred_area?: string | null;
  languages?: string[] | null;
  description?: string | null;
  expected_salary?: number | null;
  experience_years?: number | null;
  source: HelpHubSource;
  status: HelpHubListingStatus;
  recommender_name?: string | null;
  /** Recommending resident flat number, e.g. B-1204 */
  recommender_flat?: string | null;
  tower_or_block?: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
  /** Direct-call number for society members (demo or after contact fetch) */
  contact_phone?: string | null;
  /** Only present after contact_shared for the enquiring user */
  shared_phone?: string | null;
}

export interface HelpHubEnquiry {
  id: string;
  listing_id: string;
  from_user_id: string;
  status: HelpHubEnquiryStatus;
  shared_phone?: string | null;
  message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HelpHubCreateListingInput {
  display_name: string;
  category: HelpHubCategory;
  work_type: HelpHubWorkType;
  availability: HelpHubAvailability;
  available_from?: string;
  available_to?: string;
  preferred_area?: string;
  languages?: string[];
  description?: string;
  expected_salary?: number;
  experience_years?: number;
  /** Stored for direct contact / call */
  private_phone?: string;
  recommender_flat?: string;
  source: HelpHubSource;
  consent_confirmed: boolean;
  tower_or_block?: string;
}
