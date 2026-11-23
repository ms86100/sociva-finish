/**
 * Deterministic community-intent resolver for Smart Groups.
 * Rules-first; seam for a future LLM. Never silently publish low confidence.
 */

export type SmartGroupCategory =
  | 'find_help'
  | 'recommendation'
  | 'rent_sell'
  | 'buy_sell'
  | 'announcement'
  | 'event'
  | 'alert'
  | 'maintenance'
  | 'poll'
  | 'lost_found';

export type MatchBand = 'strong' | 'reasonable' | 'weak' | 'none';

export interface CommunityIntentResult {
  intent: string;
  categories: SmartGroupCategory[];
  primaryCategory: SmartGroupCategory;
  serviceCategory: string | null;
  confidence: number;
  matchBand: MatchBand;
  suggestedTitle: string | null;
  signals: string[];
}

const SERVICE_ALIASES: Record<string, string[]> = {
  cook: ['cook', 'home cook', 'chef', 'cooking', 'breakfast and lunch', 'tiffin cook'],
  maid: ['maid', 'house help', 'domestic help', 'housekeeping', 'cleaner', 'cleaning lady'],
  driver: ['driver', 'chauffeur', 'personal driver'],
  nanny: ['nanny', 'babysitter', 'babysitting', 'childcare', 'ayah'],
  electrician: ['electrician', 'electrical', 'wiring', 'switch repair', 'fan repair', 'power issue'],
  plumber: ['plumber', 'plumbing', 'pipe leak', 'tap repair', 'water leak', 'drainage'],
  carpenter: ['carpenter', 'carpentry', 'wood work', 'furniture repair'],
  ac_service: ['ac repair', 'ac service', 'air conditioner', 'ac installation'],
  pest_control: ['pest control', 'cockroach', 'termite', 'mosquito'],
  appliance_repair: ['washing machine', 'fridge repair', 'microwave repair', 'appliance repair'],
  puncture: ['puncture', 'tyre repair', 'tire repair', 'tube repair'],
};

const FIND_HELP_CUES = [
  'need',
  'looking for',
  'looking fr',
  'anyone know',
  'anyone knows',
  'does anyone',
  'can someone',
  'require',
  'wanted',
  'help with',
  'searching for',
];

const RECOMMEND_CUES = [
  'recommend',
  'recommendation',
  'highly recommend',
  'great cook',
  'good cook',
  'trusted',
  'suggest',
  'suggestion',
  'know a good',
  'knows a good',
];

const RENT_SELL_CUES = [
  'for rent',
  'available for rent',
  '2bhk',
  '3bhk',
  '1bhk',
  '4bhk',
  'bhk',
  'flat for rent',
  'apartment for rent',
  'selling flat',
  'flat for sale',
  'to-let',
  'to let',
  'lease',
  'security deposit',
];

const BUY_SELL_CUES = [
  'for sale',
  'selling',
  'buy',
  'looking to buy',
  'marketplace',
  'second hand',
  'secondhand',
  'used',
  'giveaway',
  'free to take',
];

const EVENT_CUES = [
  'event',
  'festival',
  'prasad',
  'puja',
  'pooja',
  'gathering',
  'meetup',
  'badminton',
  'tournament',
  'celebration',
  'invite',
  'rsvp',
  'this weekend',
];

const LOST_FOUND_CUES = [
  'lost my',
  'lost the',
  'i lost',
  'have lost',
  'found a',
  'found my',
  'i found',
  'missing',
  'misplaced',
  'lost key',
  'lost wallet',
  'lost phone',
];

const ALERT_CUES = [
  'urgent',
  'emergency',
  'water cut',
  'power cut',
  'outage',
  'leak in',
  'fire',
  'security alert',
];

const MAINTENANCE_CUES = [
  'maintenance',
  'lift not working',
  'elevator',
  'generator',
  'parking issue',
  'garbage',
  'sewage',
];

const ANNOUNCEMENT_CUES = [
  'announcement',
  'notice',
  'agm',
  'society meeting',
  'please note',
  'informing',
  'fyir',
  'fyi',
];

const POLL_CUES = ['poll', 'vote', 'which option', 'cast your vote'];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreCues(haystack: string, cues: string[]): { score: number; hits: string[] } {
  const hits: string[] = [];
  let score = 0;
  for (const cue of cues) {
    if (haystack.includes(cue)) {
      hits.push(cue);
      score += cue.split(' ').length > 1 ? 2.5 : 1.5;
    }
  }
  return { score, hits };
}

function detectService(haystack: string): { slug: string | null; hits: string[] } {
  let best: { slug: string; score: number; hits: string[] } | null = null;
  for (const [slug, aliases] of Object.entries(SERVICE_ALIASES)) {
    const { score, hits } = scoreCues(haystack, aliases);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { slug, score, hits };
    }
  }
  return best ? { slug: best.slug, hits: best.hits } : { slug: null, hits: [] };
}

function bandFromConfidence(confidence: number): MatchBand {
  if (confidence >= 0.75) return 'strong';
  if (confidence >= 0.5) return 'reasonable';
  if (confidence >= 0.3) return 'weak';
  return 'none';
}

function firstLineTitle(text: string): string | null {
  const line = text.split(/\n/).map((s) => s.trim()).find(Boolean);
  if (!line) return null;
  const cleaned = line.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 80) return cleaned;
  return `${cleaned.slice(0, 77)}...`;
}

/**
 * Resolve community post intent from natural language.
 */
export function resolveCommunityIntent(rawText: string): CommunityIntentResult {
  const text = (rawText || '').trim();
  const haystack = normalize(text);
  const signals: string[] = [];

  if (!haystack) {
    return {
      intent: 'unknown',
      categories: ['announcement'],
      primaryCategory: 'announcement',
      serviceCategory: null,
      confidence: 0,
      matchBand: 'none',
      suggestedTitle: null,
      signals: ['empty'],
    };
  }

  const service = detectService(haystack);
  if (service.slug) signals.push(`service:${service.slug}`, ...service.hits.map((h) => `svc:${h}`));

  const findHelp = scoreCues(haystack, FIND_HELP_CUES);
  const recommend = scoreCues(haystack, RECOMMEND_CUES);
  const rentSell = scoreCues(haystack, RENT_SELL_CUES);
  const buySell = scoreCues(haystack, BUY_SELL_CUES);
  const event = scoreCues(haystack, EVENT_CUES);
  const lostFound = scoreCues(haystack, LOST_FOUND_CUES);
  const alert = scoreCues(haystack, ALERT_CUES);
  const maintenance = scoreCues(haystack, MAINTENANCE_CUES);
  const announcement = scoreCues(haystack, ANNOUNCEMENT_CUES);
  const poll = scoreCues(haystack, POLL_CUES);

  type Scored = { category: SmartGroupCategory; score: number; intent: string; hits: string[] };
  const scored: Scored[] = [];

  // Service + ask language => Find Help (killer path)
  if (service.slug && findHelp.score > 0) {
    scored.push({
      category: 'find_help',
      score: findHelp.score + 4 + (service.hits.length > 0 ? 2 : 0),
      intent: `find_help:${service.slug}`,
      hits: [...findHelp.hits, ...service.hits],
    });
  } else if (service.slug && recommend.score > 0) {
    scored.push({
      category: 'recommendation',
      score: recommend.score + 4,
      intent: `recommendation:${service.slug}`,
      hits: [...recommend.hits, ...service.hits],
    });
  } else if (service.slug && recommend.score === 0 && findHelp.score === 0) {
    // Bare service mention leans find_help with lower confidence
    scored.push({
      category: 'find_help',
      score: 2.5 + service.hits.length,
      intent: `find_help:${service.slug}`,
      hits: service.hits,
    });
  }

  if (findHelp.score > 0 && !service.slug) {
    scored.push({
      category: 'find_help',
      score: findHelp.score + 1,
      intent: 'find_help:general',
      hits: findHelp.hits,
    });
  }

  if (recommend.score > 0 && !(service.slug && findHelp.score > recommend.score)) {
    scored.push({
      category: 'recommendation',
      score: recommend.score + (service.slug ? 2 : 0),
      intent: service.slug ? `recommendation:${service.slug}` : 'recommendation:general',
      hits: [...recommend.hits, ...service.hits],
    });
  }

  if (rentSell.score > 0) {
    scored.push({
      category: 'rent_sell',
      score: rentSell.score + 3,
      intent: 'property_rental_or_sale',
      hits: rentSell.hits,
    });
  }

  if (buySell.score > 0 && rentSell.score === 0) {
    scored.push({
      category: 'buy_sell',
      score: buySell.score + 2,
      intent: 'marketplace_listing',
      hits: buySell.hits,
    });
  }

  if (event.score > 0) {
    scored.push({
      category: 'event',
      score: event.score + 2,
      intent: 'community_event',
      hits: event.hits,
    });
  }

  if (lostFound.score > 0) {
    scored.push({
      category: 'lost_found',
      score: lostFound.score + 3,
      intent: 'lost_or_found',
      hits: lostFound.hits,
    });
  }

  if (alert.score > 0) {
    scored.push({
      category: 'alert',
      score: alert.score + 2,
      intent: 'community_alert',
      hits: alert.hits,
    });
  }

  if (maintenance.score > 0) {
    scored.push({
      category: 'maintenance',
      score: maintenance.score + 2,
      intent: 'maintenance',
      hits: maintenance.hits,
    });
  }

  if (announcement.score > 0) {
    scored.push({
      category: 'announcement',
      score: announcement.score + 1.5,
      intent: 'announcement',
      hits: announcement.hits,
    });
  }

  if (poll.score > 0) {
    scored.push({
      category: 'poll',
      score: poll.score + 2,
      intent: 'poll',
      hits: poll.hits,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    signals.push('fallback:announcement');
    return {
      intent: 'general_share',
      categories: ['announcement'],
      primaryCategory: 'announcement',
      serviceCategory: service.slug,
      confidence: 0.25,
      matchBand: 'weak',
      suggestedTitle: firstLineTitle(text),
      signals,
    };
  }

  const top = scored[0];
  const categories: SmartGroupCategory[] = [top.category];
  // Secondary category when useful (e.g. find_help + recommendation phrasing)
  for (const s of scored.slice(1, 3)) {
    if (s.score >= top.score * 0.55 && !categories.includes(s.category)) {
      categories.push(s.category);
    }
  }

  const maxPossible = 12;
  const confidence = Math.min(0.95, Math.max(0.2, top.score / maxPossible));
  signals.push(...top.hits.map((h) => `hit:${h}`));

  return {
    intent: top.intent,
    categories,
    primaryCategory: top.category,
    serviceCategory: service.slug,
    confidence: Number(confidence.toFixed(4)),
    matchBand: bandFromConfidence(confidence),
    suggestedTitle: firstLineTitle(text),
    signals,
  };
}

export const SMART_CATEGORY_LABELS: Record<SmartGroupCategory, string> = {
  find_help: 'Find Help',
  recommendation: 'Recommendations',
  rent_sell: 'Rent & Sell',
  buy_sell: 'Buy & Sell',
  announcement: 'Announcements',
  event: 'Events',
  alert: 'Alerts',
  maintenance: 'Maintenance',
  poll: 'Polls',
  lost_found: 'Lost & Found',
};

export const SMART_CATEGORY_AUDIENCE: Record<SmartGroupCategory, string> = {
  find_help: 'Neighbours who can help or recommend local services',
  recommendation: 'Neighbours looking for trusted local recommendations',
  rent_sell: 'Residents interested in rentals and property',
  buy_sell: 'Residents browsing buy and sell listings',
  announcement: 'Your society community feed',
  event: 'Neighbours interested in events and gatherings',
  alert: 'Residents who need important alerts',
  maintenance: 'Residents following maintenance updates',
  poll: 'Neighbours who can vote on community questions',
  lost_found: 'Neighbours who can help recover lost items',
};
