import type { HelpHubEnquiry, HelpHubListing } from './types';

const daysFromNow = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
};

export const HELPHUB_MOCK_SOCIETY_ID = 'demo-society';

/** Demo phones for direct Contact / call (not shown as text on the card). */
export const HELPHUB_MOCK_PHONES: Record<string, string> = {
  'hh-1': '9876501001',
  'hh-2': '9876501002',
  'hh-3': '9876501003',
  'hh-4': '9876501004',
  'hh-5': '9876501005',
  'hh-6': '9876501006',
};

export const HELPHUB_MOCK_LISTINGS: HelpHubListing[] = [
  {
    id: 'hh-1',
    society_id: HELPHUB_MOCK_SOCIETY_ID,
    created_by: 'resident-a',
    display_name: 'Priya',
    category: 'cook',
    work_type: 'part_time',
    availability: 'morning',
    available_from: '07:00',
    available_to: '11:00',
    preferred_area: 'Within society',
    languages: ['Hindi', 'Marathi'],
    description: 'Home-style vegetarian cooking. Available for morning shifts.',
    expected_salary: 8000,
    experience_years: 5,
    source: 'resident_recommendation',
    status: 'active',
    recommender_name: 'Ananya Sharma',
    recommender_flat: 'B-1204',
    tower_or_block: 'Tower B',
    contact_phone: HELPHUB_MOCK_PHONES['hh-1'],
    expires_at: daysFromNow(22),
    created_at: daysAgo(3),
    updated_at: daysAgo(3),
  },
  {
    id: 'hh-2',
    society_id: HELPHUB_MOCK_SOCIETY_ID,
    created_by: 'resident-b',
    display_name: 'Sunita',
    category: 'maid',
    work_type: 'full_time',
    availability: 'flexible',
    preferred_area: 'Within society',
    languages: ['Hindi'],
    description: 'Experienced with flat cleaning and laundry.',
    expected_salary: 12000,
    experience_years: 8,
    source: 'resident_recommendation',
    status: 'active',
    recommender_name: 'Rahul Mehta',
    recommender_flat: 'H-702',
    tower_or_block: 'Tower H',
    contact_phone: HELPHUB_MOCK_PHONES['hh-2'],
    expires_at: daysFromNow(18),
    created_at: daysAgo(5),
    updated_at: daysAgo(5),
  },
  {
    id: 'hh-3',
    society_id: HELPHUB_MOCK_SOCIETY_ID,
    created_by: 'worker-1',
    display_name: 'Ramesh',
    category: 'driver',
    work_type: 'full_time',
    availability: 'flexible',
    preferred_area: 'Nearby',
    languages: ['Hindi', 'English'],
    description: 'Local driver with own two-wheeler for school runs.',
    expected_salary: 15000,
    experience_years: 10,
    source: 'self_registered',
    status: 'active',
    contact_phone: HELPHUB_MOCK_PHONES['hh-3'],
    expires_at: daysFromNow(27),
    created_at: daysAgo(1),
    updated_at: daysAgo(1),
  },
  {
    id: 'hh-4',
    society_id: HELPHUB_MOCK_SOCIETY_ID,
    created_by: 'resident-c',
    display_name: 'Meena',
    category: 'nanny',
    work_type: 'part_time',
    availability: 'evening',
    available_from: '17:00',
    available_to: '21:00',
    preferred_area: 'Within society',
    languages: ['Hindi', 'Marathi'],
    description: 'Gentle with toddlers. Looking for evening care.',
    expected_salary: 10000,
    experience_years: 4,
    source: 'assisted',
    status: 'active',
    recommender_name: 'Kavita Iyer',
    recommender_flat: 'A-305',
    tower_or_block: 'Tower A',
    contact_phone: HELPHUB_MOCK_PHONES['hh-4'],
    expires_at: daysFromNow(12),
    created_at: daysAgo(8),
    updated_at: daysAgo(8),
  },
  {
    id: 'hh-5',
    society_id: HELPHUB_MOCK_SOCIETY_ID,
    created_by: 'resident-d',
    display_name: 'Lakshmi',
    category: 'elderly_care',
    work_type: 'live_in',
    availability: 'flexible',
    preferred_area: 'Within society',
    languages: ['Tamil', 'Hindi'],
    description: 'Patient caregiver for elderly residents.',
    expected_salary: 18000,
    experience_years: 6,
    source: 'resident_recommendation',
    status: 'active',
    recommender_name: 'Suresh Nair',
    recommender_flat: 'C-1102',
    tower_or_block: 'Tower C',
    contact_phone: HELPHUB_MOCK_PHONES['hh-5'],
    expires_at: daysFromNow(25),
    created_at: daysAgo(2),
    updated_at: daysAgo(2),
  },
  {
    id: 'hh-6',
    society_id: HELPHUB_MOCK_SOCIETY_ID,
    created_by: 'worker-2',
    display_name: 'Asha',
    category: 'babysitter',
    work_type: 'hourly',
    availability: 'afternoon',
    available_from: '13:00',
    available_to: '18:00',
    preferred_area: 'Within society',
    languages: ['Hindi'],
    description: 'Available for weekend and afternoon babysitting.',
    expected_salary: 200,
    experience_years: 3,
    source: 'self_registered',
    status: 'active',
    contact_phone: HELPHUB_MOCK_PHONES['hh-6'],
    expires_at: daysFromNow(20),
    created_at: daysAgo(4),
    updated_at: daysAgo(4),
  },
  {
    id: 'hh-expired',
    society_id: HELPHUB_MOCK_SOCIETY_ID,
    created_by: 'resident-e',
    display_name: 'Hidden Expired',
    category: 'gardener',
    work_type: 'part_time',
    availability: 'morning',
    source: 'self_registered',
    status: 'expired',
    expires_at: daysAgo(2),
    created_at: daysAgo(40),
    updated_at: daysAgo(2),
  },
  {
    id: 'hh-hired',
    society_id: HELPHUB_MOCK_SOCIETY_ID,
    created_by: 'resident-f',
    display_name: 'Hidden Hired',
    category: 'laundry',
    work_type: 'hourly',
    availability: 'morning',
    source: 'resident_recommendation',
    status: 'hired',
    expires_at: daysFromNow(10),
    created_at: daysAgo(10),
    updated_at: daysAgo(1),
  },
];

export const HELPHUB_MOCK_ENQUIRIES: HelpHubEnquiry[] = [];

export function isActiveHelpHubListing(listing: HelpHubListing): boolean {
  if (listing.status !== 'active') return false;
  if (new Date(listing.expires_at).getTime() <= Date.now()) return false;
  return true;
}

export function filterHelpHubListings(
  listings: HelpHubListing[],
  opts: {
    category?: string;
    workType?: string;
    availability?: string;
    query?: string;
    salaryMin?: number;
    salaryMax?: number;
  } = {},
): HelpHubListing[] {
  const q = (opts.query || '').trim().toLowerCase();
  return listings
    .filter(isActiveHelpHubListing)
    .filter((l) => !opts.category || opts.category === 'all' || l.category === opts.category)
    .filter((l) => !opts.workType || opts.workType === 'all' || l.work_type === opts.workType)
    .filter((l) => !opts.availability || opts.availability === 'all' || l.availability === opts.availability)
    .filter((l) => opts.salaryMin == null || (l.expected_salary ?? 0) >= opts.salaryMin)
    .filter((l) => opts.salaryMax == null || (l.expected_salary ?? Infinity) <= opts.salaryMax)
    .filter((l) => {
      if (!q) return true;
      const hay = [
        l.display_name,
        l.category,
        l.description || '',
        l.recommender_name || '',
        l.recommender_flat || '',
        ...(l.languages || []),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function openHelpHubPhoneCall(phone: string) {
  const digits = String(phone).replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  const href = local.length === 10 ? `tel:+91${local}` : `tel:${digits}`;
  window.location.href = href;
}
