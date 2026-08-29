/**
 * Deterministic listing-intent resolver for seller onboarding.
 * Intent / commerce model first; taxonomy is a soft suggestion layer.
 * Seam for a future LLM: keep this function as the single resolve entrypoint.
 */
import {
  BUYER_JOURNEYS,
  type BuyerJourneyId,
  getJourney,
} from '@/lib/buyer-journey';

export type CommerceModel = BuyerJourneyId;
export type ListingKindHint =
  | 'product'
  | 'service'
  | 'rental'
  | 'appointment'
  | 'enquiry'
  | 'digital';

export type SoftListingTag = 'rental' | 'appointment' | 'digital' | null;

/** Category-level aliases (product nouns → category slug). */
export const CATEGORY_ALIAS_MAP: Record<string, string[]> = {
  home_food: [
    'home food', 'homemade', 'home cooked', 'home-cooked', 'rajma', 'chawal', 'chole', 'thali',
    'sabzi', 'curry', 'dal', 'roti', 'paratha', 'khichdi', 'pulao', 'fried rice', 'home meal',
    'rajma chawal', 'chole bhature', 'paneer', 'dal makhani',
  ],
  daily_tiffin: ['home food', 'dabba', 'meal service', 'lunch delivery', 'tiffin', 'food delivery', 'home cooked'],
  one_time_meals: [
    'special meals', 'party food', 'bulk food', 'catering food',
    'biryani', 'biriyani', 'chicken biryani', 'mutton biryani', 'veg biryani', 'egg biryani',
    'hyderabadi biryani', 'dum biryani', 'rice bowl', 'rice meal', 'meal box', 'lunch box',
    'dinner box', 'prepared meals', 'prepared meal',
  ],
  breakfast_items: ['breakfast', 'morning food', 'idli', 'dosa', 'paratha', 'poha'],
  cakes: ['cake', 'birthday cake', 'baking', 'pastry', 'bakery'],
  bakery: ['bakery', 'cake', 'cakes', 'birthday cake', 'pastry', 'baking', 'cookie', 'biscuit'],
  cookies_biscuits: ['cookies', 'biscuits', 'baked snacks'],
  traditional_sweets: ['sweets', 'mithai', 'laddu', 'barfi', 'halwa'],
  fresh_juices: ['juice', 'fresh juice', 'fruit juice'],
  pickles: ['pickle', 'achar', 'homemade pickle'],
  party_catering: ['catering', 'party food', 'event food', 'bulk order'],
  party_snacks: ['snacks', 'party snacks', 'finger food'],
  organic_food: ['organic', 'natural food', 'health food'],
  regional_cuisine: ['regional food', 'south indian', 'north indian', 'bengali food'],
  healthy_diet: ['diet food', 'healthy meals', 'low calorie', 'keto'],
  kids_meals: ['kids food', 'baby food', 'children meals'],
  namkeen_chips: ['namkeen', 'chips', 'mixture', 'chivda'],
  street_food: ['chaat', 'pani puri', 'vada pav', 'samosa'],
  tea_coffee: ['tea', 'chai', 'coffee', 'beverages'],
  smoothies: ['smoothie', 'protein shake', 'health drink'],
  milkshakes: ['milkshake', 'cold coffee', 'lassi'],
  homemade_chocolates: ['chocolate', 'homemade chocolate', 'truffle'],
  jams_preserves: ['jam', 'preserve', 'marmalade'],
  masala_spices: ['masala', 'spice', 'spices', 'garam masala'],
  papad_fryums: ['papad', 'fryums', 'appalam'],
  yoga: ['meditation', 'wellness', 'mindfulness', 'pranayama', 'fitness class', 'yoga therapy', 'mind body', 'stress relief', 'hatha', 'power yoga', 'prenatal yoga'],
  medical_specialist: ['doctor', 'clinic', 'physician', 'gp', 'general physician', 'medical', 'mbbs', 'consultation'],
  ayurveda: ['panchakarma', 'ayurvedic therapy', 'ayurveda treatment', 'detox therapy', 'oil massage', 'shirodhara', 'naturopathy', 'holistic healing', 'body detox', 'wellness retreat', 'ayurvedic massage', 'herbal therapy', 'stress relief therapy', 'therapy', 'ayurveda', 'rejuvenation therapy', 'steam therapy'],
  panchakarma_detox: ['panchakarma', 'detox program', 'body detox', 'cleansing therapy', 'detox'],
  abhyanga: ['oil massage', 'body massage', 'ayurvedic massage', 'full body massage'],
  shirodhara: ['head oil therapy', 'forehead oil', 'stress therapy', 'oil pouring'],
  nasya_therapy: ['nasal therapy', 'sinus treatment', 'nasya', 'therapy'],
  panchakarma_rejuvenation: ['rejuvenation', 'therapy', 'rejuvenation therapy'],
  basti_therapy: ['basti', 'enema therapy', 'therapy'],
  swedana: ['steam therapy', 'steam bath', 'herbal steam'],
  facial: ['face treatment', 'face cleanup', 'glow facial', 'gold facial'],
  bridal_makeup: ['wedding makeup', 'bridal', 'dulhan makeup', 'party makeup'],
  haircut: ['hair cut', 'hair cutting', 'trim', 'hair trim'],
  hatha_yoga: ['hatha', 'basic yoga', 'beginner yoga'],
  power_yoga: ['intense yoga', 'fitness yoga', 'hot yoga'],
  meditation_class: ['meditation', 'guided meditation', 'mindfulness class'],
  tuition: ['tuition', 'tutor', 'coaching', 'home tuition', 'maths tuition'],
  dance: ['dance class', 'dancing', 'zumba', 'bharatnatyam', 'salsa'],
  music: ['music class', 'guitar', 'piano', 'singing', 'vocal training'],
  art_craft: ['art class', 'craft', 'painting', 'drawing', 'pottery'],
  language: ['language class', 'english class', 'spoken english', 'french class'],
  fitness: ['gym', 'personal trainer', 'workout', 'exercise', 'crossfit'],
  coaching: ['coaching', 'entrance exam', 'competitive exam'],
  daycare: ['daycare', 'creche', 'childcare', 'babysitting'],
  electrician: ['wiring', 'electrical repair', 'electrical', 'switch repair', 'fan repair'],
  plumber: ['plumbing', 'pipe repair', 'tap repair', 'water leak', 'plumber'],
  carpenter: ['carpentry', 'furniture repair', 'wood work', 'door repair'],
  ac_service: ['ac repair', 'ac service', 'air conditioner', 'ac installation'],
  pest_control: ['pest control', 'cockroach', 'termite', 'mosquito control'],
  appliance_repair: ['appliance repair', 'washing machine', 'fridge repair', 'microwave repair'],
  maid: ['cleaning', 'house cleaning', 'home cleaning', 'maid', 'domestic help', 'housekeeping'],
  cook: ['cook', 'home cook', 'chef', 'cooking service'],
  driver: ['driver', 'personal driver', 'chauffeur'],
  nanny: ['nanny', 'babysitter', 'child care'],
  beauty: ['parlour', 'parlor', 'makeup', 'facial', 'beauty service', 'bridal makeup', 'skin care', 'spa', 'massage', 'body massage', 'ayurvedic massage'],
  salon: ['salon', 'haircut', 'hair styling', 'grooming', 'beard trim', 'hair spa'],
  tailoring: ['tailor', 'stitching', 'alteration', 'blouse stitching', 'kurta stitching'],
  laundry: ['laundry', 'dry cleaning', 'ironing', 'washing clothes'],
  mehendi: ['mehendi', 'henna', 'mehndi'],
  tax_consultant: ['tax', 'gst', 'income tax', 'tax filing', 'ca service'],
  it_support: ['computer repair', 'laptop repair', 'it support', 'tech support'],
  tutoring: ['private tutor', 'home tutor', 'online tutor'],
  resume_writing: ['resume editing', 'cv writing', 'resume help', 'resume', 'job application'],
  equipment_rental: ['equipment rent', 'tool rental', 'generator rental'],
  vehicle_rental: ['car rental', 'bike rental', 'vehicle rent', 'scooter rent'],
  party_supplies: ['tent', 'chair rental', 'table rental', 'party decoration rental'],
  baby_gear: ['stroller rental', 'baby gear', 'baby equipment'],
  furniture: ['used furniture', 'sofa', 'bed', 'table', 'chair'],
  electronics: ['used phone', 'second hand laptop', 'old electronics'],
  books: ['used books', 'second hand books', 'old books', 'textbooks'],
  clothing: [
    'used clothes', 'second hand clothing', 'pre-owned clothes', 't-shirt', 'tshirt', 't shirt',
    't-shirts', 'tshirts', 'tee', 'tees', 'shirts', 'jeans', 'dress', 'saree', 'kurti',
    'fashion', 'garments', 'apparel', 'western wear', 'ethnic wear',
  ],
  decoration: ['event decoration', 'birthday decoration', 'balloon decoration', 'party decoration'],
  photography: ['photographer', 'photo shoot', 'event photography', 'wedding photography'],
  dj_music: ['dj', 'music system', 'event music', 'sound system'],
  pet_food: ['pet food', 'dog food', 'cat food'],
  pet_grooming: ['pet grooming', 'dog grooming', 'pet salon'],
  pet_sitting: ['pet sitting', 'pet boarding', 'dog boarding'],
  dog_walking: ['dog walking', 'pet walking'],
  flat_rent: ['flat for rent', 'apartment rent', 'house rent', 'pg'],
  roommate: ['roommate', 'flatmate', 'paying guest'],
  parking: ['parking spot', 'car parking', 'bike parking'],
};

/**
 * Product-noun → preferred subcategory slug fragments / display hints.
 * Matched against subcategory slug + display_name (includes / startsWith).
 */
export const SUBCATEGORY_NOUN_ALIASES: Record<string, string[]> = {
  't-shirt': ['t-shirt', 'tshirt', 'tee', 'tops', 'western', 'casual wear', 'men', 'women', 'apparel'],
  tshirt: ['t-shirt', 'tshirt', 'tee', 'tops', 'western', 'casual'],
  't shirt': ['t-shirt', 'tshirt', 'tee', 'tops', 'western'],
  't-shirts': ['t-shirt', 'tshirt', 'tee', 'tops', 'western'],
  shirts: ['shirt', 'formal', 'casual', 'western'],
  jeans: ['jean', 'denim', 'pants', 'trouser'],
  saree: ['saree', 'sari', 'ethnic'],
  kurti: ['kurti', 'ethnic', 'kurta'],
  yoga: ['yoga', 'hatha', 'power yoga', 'meditation'],
  plumber: ['plumb', 'pipe', 'tap'],
  electrician: ['electric', 'wiring'],
  tiffin: ['tiffin', 'dabba', 'meal'],
  cake: ['cake', 'bakery', 'pastry'],
};

export const INTENT_EXAMPLE_CHIPS = [
  'Biryani',
  'Home-cooked tiffin',
  'T-shirts',
  'Yoga classes',
  'AC repair',
  'Birthday cakes',
  'Saree',
  'Haircut',
  'Flat for rent',
  'Bridal makeup',
  'Tuition',
] as const;

export interface IntentCatalogCategory {
  slug: string;
  id: string;
  displayName: string;
  parentGroup: string;
  transactionType?: string;
  hasDateRange?: boolean;
  requiresTimeSlot?: boolean;
  enquiryOnly?: boolean;
  supportsCart?: boolean;
}

export interface IntentCatalogSubcategory {
  id: string;
  slug: string;
  displayName: string;
  categoryConfigId: string;
  categorySlug: string;
}

export type ListingMatchBand = 'strong' | 'reasonable' | 'weak' | 'none';

export function listingMatchBand(confidence: number): ListingMatchBand {
  if (confidence >= 2.5) return 'strong';
  if (confidence >= 1.5) return 'reasonable';
  if (confidence > 0) return 'weak';
  return 'none';
}

export interface ResolvedListingIntent {
  commerceModel: CommerceModel;
  listingKindHint: ListingKindHint;
  suggestedCategorySlug: string | null;
  suggestedCategoryConfigId: string | null;
  suggestedSubcategoryId: string | null;
  suggestedSubcategoryName: string | null;
  suggestedParentGroup: string | null;
  confidence: number;
  matchedAlias: string | null;
  seedProductName: string;
  /** True when category found but no subcategory — use Other / customLabel path */
  needsOtherSubcategory: boolean;
  useCustomSubcategoryLabel: string | null;
  /** How sure the existing-taxonomy suggestion is. Never blocks listing. */
  matchBand: ListingMatchBand;
}

function normalize(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, ' ');
}

function titleCaseSeed(phrase: string): string {
  const t = phrase.trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function scoreName(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n === q) return 3;
  if (n.startsWith(q)) return 2;
  if (n.includes(q)) return 1;
  return 0;
}

/** Best subcategory for a free-text phrase within an optional category. */
export function findBestSubcategoryMatch(
  phrase: string,
  subcategories: IntentCatalogSubcategory[],
  opts?: { categorySlug?: string | null; categoryConfigId?: string | null },
): { sub: IntentCatalogSubcategory; score: number; matchedAlias: string | null } | null {
  const q = normalize(phrase);
  if (!q || subcategories.length === 0) return null;

  let pool = subcategories;
  if (opts?.categoryConfigId) {
    pool = pool.filter((s) => s.categoryConfigId === opts.categoryConfigId);
  } else if (opts?.categorySlug) {
    pool = pool.filter((s) => s.categorySlug === opts.categorySlug);
  }
  if (pool.length === 0) return null;

  let best: { sub: IntentCatalogSubcategory; score: number; matchedAlias: string | null } | null = null;

  for (const sub of pool) {
    let score = scoreName(sub.displayName, q) + scoreName(sub.slug.replace(/_/g, ' '), q);

    for (const [noun, hints] of Object.entries(SUBCATEGORY_NOUN_ALIASES)) {
      if (q === noun || q.includes(noun) || noun.includes(q)) {
        const hay = `${sub.slug} ${sub.displayName}`.toLowerCase();
        for (const h of hints) {
          if (hay.includes(h)) {
            score = Math.max(score, 2.4);
            if (!best || score > best.score) {
              best = { sub, score, matchedAlias: noun };
            }
          }
        }
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { sub, score, matchedAlias: best?.matchedAlias ?? null };
    }
  }

  if (!best || best.score < 1) return null;
  return best;
}

function findCategoryByAlias(
  phrase: string,
  categories: IntentCatalogCategory[],
  dynamicAliases: Record<string, string[]> = {},
): { category: IntentCatalogCategory; score: number; matchedAlias: string } | null {
  const q = normalize(phrase);
  if (!q) return null;

  let best: { category: IntentCatalogCategory; score: number; matchedAlias: string } | null = null;

  for (const cat of categories) {
    const aliases = [
      ...(CATEGORY_ALIAS_MAP[cat.slug] || []),
      ...(dynamicAliases[cat.slug] || []),
      cat.displayName,
      cat.slug.replace(/_/g, ' '),
    ];
    for (const alias of aliases) {
      const a = normalize(alias);
      let score = 0;
      if (a === q) score = 3;
      else if (q.includes(a) || a.includes(q)) score = a.length >= 3 ? 2.5 : 1.5;
      else if (scoreName(a, q) > 0) score = scoreName(a, q);

      if (score > 0 && (!best || score > best.score)) {
        best = { category: cat, score, matchedAlias: alias };
      }
    }
  }

  return best;
}

/** Culinary tokens used only when no alias/subcategory hit — never create taxonomy. */
const FOOD_FALLBACK_HINTS = [
  'homemade', 'cooked', 'cuisine', 'dish', 'curry', 'gravy', 'rice', 'dal', 'roti',
  'paneer', 'masala', 'pickle', 'achar', 'snack', 'sweet', 'bakery', 'juice',
  'fermented', 'soybean', 'paste', 'sauce', 'stew', 'soup', 'biryani', 'biriyani',
  'tandoor', 'tikka', 'kebab', 'meal', 'thali', 'paratha',
];

const SERVICE_FALLBACK_HINTS = [
  'class', 'classes', 'repair', 'service', 'therapy', 'tuition', 'massage', 'salon',
  'grooming', 'training', 'coaching', 'appointment',
];

function isFoodishGroup(parentGroup: string): boolean {
  const g = parentGroup.toLowerCase();
  return g.includes('food');
}

function isServiceishGroup(parentGroup: string): boolean {
  const g = parentGroup.toLowerCase();
  return g.includes('service') || g.includes('wellness');
}

/**
 * Last-resort: map unknown phrases onto an existing `other-*` category.
 * Does not insert taxonomy rows.
 */
function findOtherFallback(
  phrase: string,
  categories: IntentCatalogCategory[],
): IntentCatalogCategory | null {
  const others = categories.filter((c) => c.slug.startsWith('other-'));
  if (others.length === 0) return null;
  const q = normalize(phrase);
  const foodish = FOOD_FALLBACK_HINTS.some((h) => q.includes(h));
  const serviceish = SERVICE_FALLBACK_HINTS.some((h) => q.includes(h));
  if (foodish) {
    const foodOther = others.find((c) => isFoodishGroup(c.parentGroup) || c.slug.includes('food'));
    if (foodOther) return foodOther;
  }
  if (serviceish) {
    const svcOther = others.find((c) => isServiceishGroup(c.parentGroup) || c.slug.includes('service'));
    if (svcOther) return svcOther;
  }
  return others.find((c) => c.slug.includes('marketplace') || c.parentGroup.includes('marketplace'))
    || others[0];
}

function inferModelFromCategory(cat: IntentCatalogCategory | null, softTag: SoftListingTag): CommerceModel {
  if (softTag === 'digital') return 'enquire';
  if (softTag === 'rental') return 'enquire';
  if (softTag === 'appointment') return 'book';
  if (!cat) return 'enquire';
  if (cat.enquiryOnly) return 'enquire';
  if (cat.requiresTimeSlot || cat.hasDateRange) return 'book';
  if (cat.supportsCart !== false && (cat.transactionType === 'cart_purchase' || !cat.transactionType)) {
    return 'cart';
  }
  const tx = cat.transactionType || '';
  if (tx.includes('book')) return 'book';
  if (tx.includes('contact')) return 'contact';
  if (tx.includes('request') || tx.includes('enquir')) return 'enquire';
  return 'cart';
}

function kindFromModel(
  model: CommerceModel,
  softTag: SoftListingTag,
  cat: IntentCatalogCategory | null,
): ListingKindHint {
  if (softTag === 'digital') return 'digital';
  if (softTag === 'rental' || cat?.hasDateRange) return 'rental';
  if (softTag === 'appointment') return 'appointment';
  if (model === 'book') return 'service';
  if (model === 'enquire' || model === 'contact') return 'enquiry';
  return 'product';
}

export function softTagToCommerceModel(tag: SoftListingTag): CommerceModel | null {
  if (tag === 'appointment') return 'book';
  if (tag === 'rental' || tag === 'digital') return 'enquire';
  return null;
}

export function commerceModelToDefaultAction(model: CommerceModel): string {
  return getJourney(model).default_action_type;
}

/** Reverse map: store default_action_type → commerce model tile. */
export function commerceModelFromActionType(actionType: string | null | undefined): CommerceModel | null {
  if (!actionType) return null;
  const hit = BUYER_JOURNEYS.find((j) => j.default_action_type === actionType);
  return hit?.id ?? null;
}

/**
 * Resolve seller free-text intent into commerce model + soft taxonomy suggestion.
 */
export function resolveListingIntent(input: {
  phrase: string;
  commerceModel?: CommerceModel | null;
  softTag?: SoftListingTag;
  categories: IntentCatalogCategory[];
  subcategories: IntentCatalogSubcategory[];
  dynamicCategoryAliases?: Record<string, string[]>;
}): ResolvedListingIntent {
  const phrase = input.phrase.trim();
  const softTag = input.softTag ?? null;
  const seedProductName = titleCaseSeed(phrase);

  const empty: ResolvedListingIntent = {
    commerceModel: input.commerceModel || softTagToCommerceModel(softTag) || 'enquire',
    listingKindHint: kindFromModel(
      input.commerceModel || softTagToCommerceModel(softTag) || 'enquire',
      softTag,
      null,
    ),
    suggestedCategorySlug: null,
    suggestedCategoryConfigId: null,
    suggestedSubcategoryId: null,
    suggestedSubcategoryName: null,
    suggestedParentGroup: null,
    confidence: 0,
    matchedAlias: null,
    seedProductName,
    needsOtherSubcategory: false,
    useCustomSubcategoryLabel: null,
    matchBand: 'none',
  };

  if (!phrase && !input.commerceModel) {
    return empty;
  }

  // Prefer subcategory noun match globally first (T-shirt → clothing sub)
  const subHit = phrase
    ? findBestSubcategoryMatch(phrase, input.subcategories)
    : null;

  let category: IntentCatalogCategory | null = null;
  let matchedAlias: string | null = null;
  let confidence = 0;

  if (subHit) {
    category =
      input.categories.find((c) => c.id === subHit.sub.categoryConfigId) ||
      input.categories.find((c) => c.slug === subHit.sub.categorySlug) ||
      null;
    matchedAlias = subHit.matchedAlias;
    confidence = subHit.score;
  }

  if (!category && phrase) {
    const catHit = findCategoryByAlias(
      phrase,
      input.categories,
      input.dynamicCategoryAliases || {},
    );
    if (catHit) {
      category = catHit.category;
      matchedAlias = catHit.matchedAlias;
      confidence = catHit.score;
    }
  }

  if (!category && phrase) {
    const fallback = findOtherFallback(phrase, input.categories);
    if (fallback) {
      category = fallback;
      matchedAlias = 'closest parent';
      confidence = 0.9;
    }
  }

  // Within suggested category, try subcategory again if global miss
  let subId: string | null = subHit?.sub.id ?? null;
  let subName: string | null = subHit?.sub.displayName ?? null;
  let needsOther = false;
  let customLabel: string | null = null;

  if (category && !subId && phrase) {
    const local = findBestSubcategoryMatch(phrase, input.subcategories, {
      categoryConfigId: category.id,
      categorySlug: category.slug,
    });
    if (local && local.score >= 1) {
      subId = local.sub.id;
      subName = local.sub.displayName;
      confidence = Math.max(confidence, local.score);
      matchedAlias = matchedAlias || local.matchedAlias;
    } else {
      const hasSubs = input.subcategories.some((s) => s.categoryConfigId === category!.id);
      if (hasSubs) {
        needsOther = true;
        customLabel = seedProductName || 'Other';
      }
    }
  }

  const inferred = inferModelFromCategory(category, softTag);
  const commerceModel: CommerceModel =
    input.commerceModel || softTagToCommerceModel(softTag) || inferred;

  return {
    commerceModel,
    listingKindHint: kindFromModel(commerceModel, softTag, category),
    suggestedCategorySlug: category?.slug ?? null,
    suggestedCategoryConfigId: category?.id ?? null,
    suggestedSubcategoryId: subId,
    suggestedSubcategoryName: subName,
    suggestedParentGroup: category?.parentGroup ?? null,
    confidence,
    matchedAlias,
    seedProductName,
    needsOtherSubcategory: needsOther,
    useCustomSubcategoryLabel: customLabel,
    matchBand: listingMatchBand(confidence),
  };
}

/**
 * Migrate persisted onboarding steps.
 * `'4'` = workflow-first 8-step (current). `'3'` = category-first 8-step.
 * `'2'` = intent-first 7-step. Otherwise legacy 5-step taxonomy-first.
 */
export function migrateOnboardingStep(savedStep: number, fromVersion?: string | null): number {
  const s = Math.max(1, Math.min(savedStep, 8));

  if (fromVersion === '4') {
    return Math.min(s, NEW_ONBOARDING_TOTAL_STEPS);
  }

  // v3 front funnel (group → category → buyers → offering) no longer matches v4
  // (buyers → offerings → optional group). Restart early steps; keep store setup+.
  if (fromVersion === '3') {
    if (s < 5) return 1;
    return Math.min(s, NEW_ONBOARDING_TOTAL_STEPS);
  }

  if (fromVersion === '2') {
    const intentToCategory: Record<number, number> = {
      1: 1,
      2: 3,
      3: 2,
      4: 5,
      5: 6,
      6: 7,
      7: 8,
    };
    return intentToCategory[s] ?? Math.min(s, NEW_ONBOARDING_TOTAL_STEPS);
  }

  // Legacy taxonomy-first (5 steps) or unknown version
  if (s <= 1) return 1;
  if (s === 2) return 5;
  if (s === 3) return 6;
  if (s === 4) return 7;
  if (s === 5) return 8;
  return Math.min(s, NEW_ONBOARDING_TOTAL_STEPS);
}

export const NEW_ONBOARDING_TOTAL_STEPS = 8;
