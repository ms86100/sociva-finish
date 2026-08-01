// @ts-nocheck
import { useState, useMemo, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useSubcategories, Subcategory } from '@/hooks/useSubcategories';
import { useParentGroups } from '@/hooks/useParentGroups';
import { useResolvedCategoryAliases } from '@/hooks/useResolvedCategoryAliases';
import { SubcategoryPickerDialog, SubcategorySelection } from '@/components/seller/SubcategoryPickerDialog';
import { RequestCategoryDialog } from '@/components/seller/RequestCategoryDialog';
import { Search, Sparkles, X, Star, ChevronRight, ArrowRight, CheckCircle, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useTypewriterPlaceholder } from '@/hooks/useTypewriterPlaceholder';
import type { SellerFormData, SubcategoryPreferences } from '@/hooks/useSellerApplication';
import type { CategoryConfig } from '@/types/categories';

const ALIAS_MAP: Record<string, string[]> = {
  daily_tiffin: ['home food', 'dabba', 'meal service', 'lunch delivery', 'tiffin', 'food delivery', 'home cooked'],
  one_time_meals: ['special meals', 'party food', 'bulk food', 'catering food'],
  breakfast_items: ['breakfast', 'morning food', 'idli', 'dosa', 'paratha', 'poha'],
  cakes: ['cake', 'birthday cake', 'baking', 'pastry', 'bakery'],
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
  dance: ['dance class', 'dancing', 'zumba', 'bharatnatyam', 'salsa'],
  music: ['music class', 'guitar', 'piano', 'singing', 'vocal training'],
  art_craft: ['art class', 'craft', 'painting', 'drawing', 'pottery'],
  tuition: ['tuition', 'tutor', 'coaching', 'home tuition', 'maths tuition'],
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
  clothing: ['used clothes', 'second hand clothing', 'pre-owned clothes', 't-shirt', 'tshirt', 't shirt', 'shirts', 'jeans', 'dress', 'saree', 'kurti', 'fashion', 'garments', 'apparel', 'western wear', 'ethnic wear'],
  decoration: ['event decoration', 'birthday decoration', 'balloon decoration', 'party decoration'],
  photography: ['photographer', 'photo shoot', 'event photography', 'wedding photography'],
  dj_music: ['dj', 'music system', 'event music', 'sound system'],
  pet_food: ['pet food', 'dog food', 'cat food'],
  pet_grooming: ['pet grooming', 'dog grooming', 'pet salon'],
  pet_sitting: ['pet sitting', 'pet boarding', 'dog boarding'],
  dog_walking: ['dog walking', 'pet walking'],
};

const POPULAR_SLUGS = [
  'daily_tiffin', 'cakes', 'yoga', 'ayurveda', 'maid', 'electrician', 'beauty', 'tuition',
];

interface SearchItem {
  type: 'subcategory' | 'category';
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  parentGroupSlug: string;
  parentGroupLabel: string;
  parentGroupIcon: string;
  parentGroupColor: string;
  categoryConfigId: string;
  categoryName: string;
  hasSubcategories: boolean;
}

interface ScoredItem extends SearchItem {
  score: number;
  matchedAlias?: string | null; // dynamic (admin-approved) alias that triggered the match
}


interface CategorySearchPickerProps {
  formData: SellerFormData;
  setFormData: React.Dispatch<React.SetStateAction<SellerFormData>>;
  groupedConfigs: Record<string, CategoryConfig[]>;
  configs: CategoryConfig[];
  handleCategoryChange: (cat: string, checked: boolean) => void;
  onContinue: () => void;
  onGroupResolved: (group: string) => void;
  parentGroupInfos: { value: string; label: string; icon: string; color: string; description: string }[];
  sellerId?: string | null;
  onboardingMode?: boolean;
}

export function CategorySearchPicker({
  formData, setFormData, groupedConfigs, configs, handleCategoryChange,
  onContinue, onGroupResolved, parentGroupInfos, sellerId = null, onboardingMode = false,
}: CategorySearchPickerProps) {
  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCategoryId, setPickerCategoryId] = useState<string | null>(null);
  const [browseGroup, setBrowseGroup] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [lastFallback, setLastFallback] = useState<{ slug: string; label: string } | null>(null);


  const typewriterPlaceholder = useTypewriterPlaceholder(
    ['Tiffin Service', 'Yoga Classes', 'Electrician', 'T-Shirts', 'Panchakarma Therapy', 'Ayurveda', 'Home Cleaning', 'Birthday Cakes', 'Tuition', 'Beauty Services', 'Plumber', 'Bridal Makeup', 'Haircut'],
    { prefix: 'Search "', suffix: '"', typeSpeed: 70, eraseSpeed: 35, pauseAfterType: 2000 },
  );

  const allSubsQuery = useSubcategories();
  const allSubs = allSubsQuery.data || [];

  // Dynamic aliases from approved/merged category requests
  // (e.g. "makhana" → "snacks"). Merged with the hard-coded ALIAS_MAP per slug.
  const { data: resolvedAliases = [] } = useResolvedCategoryAliases();
  const dynamicAliasMap = useMemo<Record<string, string[]>>(() => {
    const m: Record<string, string[]> = {};
    for (const a of resolvedAliases) {
      if (a.kind !== 'category' || !a.resolvedSlug) continue;
      (m[a.resolvedSlug] ||= []).push(a.alias);
    }
    return m;
  }, [resolvedAliases]);

  const searchIndex = useMemo<SearchItem[]>(() => {
    const items: SearchItem[] = [];
    const groupMap = new Map(parentGroupInfos.map(g => [g.value, g]));

    for (const config of configs) {
      const group = groupMap.get(config.parentGroup);
      if (!group) continue;

      const configSubs = allSubs.filter(s => s.category_config_id === config.id);

      for (const sub of configSubs) {
        items.push({
          type: 'subcategory',
          id: sub.id,
          name: sub.display_name,
          slug: sub.slug,
          icon: sub.icon,
          parentGroupSlug: config.parentGroup,
          parentGroupLabel: group.label,
          parentGroupIcon: group.icon,
          parentGroupColor: group.color,
          categoryConfigId: config.id,
          categoryName: config.displayName,
          hasSubcategories: true,
        });
      }

      // Always add category-level item for alias matching (even when subcategories exist)
      items.push({
        type: 'category',
        id: config.id,
        name: config.displayName,
        slug: config.category,
        icon: config.icon,
        parentGroupSlug: config.parentGroup,
        parentGroupLabel: group.label,
        parentGroupIcon: group.icon,
        parentGroupColor: group.color,
        categoryConfigId: config.id,
        categoryName: config.displayName,
        hasSubcategories: configSubs.length > 0,
      });
    }
    return items;
  }, [configs, allSubs, parentGroupInfos]);

  const scoreItem = useCallback((item: SearchItem, query: string): { score: number; matchedAlias: string | null } => {
    const q = query.toLowerCase().trim();
    if (!q) return { score: 0, matchedAlias: null };

    const name = item.name.toLowerCase();
    if (name === q) return { score: 3, matchedAlias: null };
    if (name.startsWith(q)) return { score: 2, matchedAlias: null };
    if (name.includes(q)) return { score: 1, matchedAlias: null };

    if (item.type === 'subcategory') {
      const catName = item.categoryName.toLowerCase();
      if (catName === q) return { score: 2, matchedAlias: null };
      if (catName.startsWith(q)) return { score: 1.5, matchedAlias: null };
      if (catName.includes(q)) return { score: 0.8, matchedAlias: null };
    }

    const dynAliases = dynamicAliasMap[item.slug] || [];
    const staticAliases = ALIAS_MAP[item.slug] || [];
    const aliases = [...dynAliases, ...staticAliases];
    const isDynamic = (a: string) => dynAliases.includes(a);

    if (aliases.length) {
      for (const alias of aliases) {
        if (alias === q) return { score: 2.5, matchedAlias: isDynamic(alias) ? alias : null };
        if (alias.startsWith(q)) return { score: 1.5, matchedAlias: isDynamic(alias) ? alias : null };
        if (alias.includes(q)) return { score: 1, matchedAlias: isDynamic(alias) ? alias : null };
        if (q.includes(alias)) return { score: 1, matchedAlias: isDynamic(alias) ? alias : null };
      }
    }

    // Multi-word matching — require strong, length-gated word overlap to avoid
    // false positives like "ca" inside "application" or "application" inside "job application".
    // Rule: a query word counts only if it has >=4 chars AND exactly equals an alias word.
    const queryWords = q.split(/\s+/).filter(w => w.length >= 4);
    if (aliases.length && queryWords.length) {
      for (const alias of aliases) {
        const aliasWords = alias.split(/\s+/).filter(w => w.length >= 4);
        if (!aliasWords.length) continue;
        const matchCount = queryWords.filter(w => aliasWords.includes(w)).length;
        // Need at least one strong word match AND coverage of >=50% of query words
        if (matchCount > 0 && matchCount / queryWords.length >= 0.5) {
          return { score: 0.6 + (matchCount * 0.4), matchedAlias: isDynamic(alias) ? alias : null };
        }
      }
    }

    return { score: 0, matchedAlias: null };
  }, [dynamicAliasMap]);

  const searchResults = useMemo<ScoredItem[]>(() => {
    const q = search.trim();
    if (q.length < 2) return [];

    // Relevance cutoff: anything below 1 is a vague fuzzy hit and would mislead the seller.
    // Filtering at >=1 lets the noResults state (with the "Request new category" CTA) trigger.
    const RELEVANCE_CUTOFF = 1;
    const scored = searchIndex
      .map(item => {
        const { score, matchedAlias } = scoreItem(item, q);
        return { ...item, score, matchedAlias };
      })
      .filter(item => item.score >= RELEVANCE_CUTOFF)
      .sort((a, b) => b.score - a.score);

    // Build a quick lookup of subs per category for expansion.
    const subsByConfig = new Map<string, SearchItem[]>();
    for (const it of searchIndex) {
      if (it.type === 'subcategory') {
        const arr = subsByConfig.get(it.categoryConfigId) ?? [];
        arr.push(it);
        subsByConfig.set(it.categoryConfigId, arr);
      }
    }

    // Deduplicate. When a category with subs matches (especially via admin alias),
    // keep the category card AND expand top 3 of its subcategories so the seller
    // sees the full path instead of a single opaque row.
    const seen = new Set<string>();
    const pushed = new Set<string>();
    const deduped: ScoredItem[] = [];
    const pushOnce = (it: ScoredItem) => {
      const key = `${it.type}-${it.id}`;
      if (pushed.has(key)) return;
      pushed.add(key);
      deduped.push(it);
    };

    for (const item of scored) {
      if (item.type === 'category' && item.hasSubcategories) {
        pushOnce(item);
        seen.add(item.categoryConfigId);
        // Expand top 3 subs (by display_order via allSubs) as helper rows.
        const subItems = (subsByConfig.get(item.categoryConfigId) ?? []).slice(0, 3);
        for (const sub of subItems) {
          pushOnce({ ...sub, score: Math.max(0.4, item.score - 0.6), matchedAlias: null });
        }
      } else if (item.type === 'subcategory' && seen.has(item.categoryConfigId)) {
        // Only include subcategory if it scores higher than 1 (strong direct match)
        if (item.score > 1) pushOnce(item);
      } else {
        pushOnce(item);
      }
    }

    return deduped.slice(0, 15);
  }, [search, searchIndex, scoreItem]);


  const suggestion = useMemo<ScoredItem | null>(() => {
    if (searchResults.length === 0) return null;
    const top = searchResults[0];
    // Promote any admin-alias-matched hit (e.g. makhana → Snacks) or any
    // strong literal match. Older code required a runner-up gap which hid
    // admin-curated matches behind "Other matches".
    if (top.matchedAlias) return top;
    if (top.score >= 2) return top;
    return null;
  }, [searchResults]);


  const popularItems = useMemo<SearchItem[]>(() => {
    return POPULAR_SLUGS
      .map(slug => searchIndex.find(item => item.slug === slug))
      .filter(Boolean) as SearchItem[];
  }, [searchIndex]);

  const browseItems = useMemo<SearchItem[]>(() => {
    if (!browseGroup) return [];
    return searchIndex.filter(item => item.parentGroupSlug === browseGroup);
  }, [browseGroup, searchIndex]);

  const pickerCategory = configs.find(c => c.id === pickerCategoryId);

  const getSubCount = (configId: string) => allSubs.filter(s => s.category_config_id === configId).length;

  const handleItemSelect = (item: SearchItem) => {
    if (formData.categories.length === 0) {
      onGroupResolved(item.parentGroupSlug);
    }

    if (item.type === 'subcategory') {
      setPickerCategoryId(item.categoryConfigId);
      setPickerOpen(true);
    } else if (item.hasSubcategories) {
      // Category with subcategories → open subcategory picker
      setPickerCategoryId(item.categoryConfigId);
      setPickerOpen(true);
    } else {
      const isSelected = formData.categories.includes(item.slug);
      handleCategoryChange(item.slug, !isSelected);
      if (!isSelected) {
        onGroupResolved(item.parentGroupSlug);
      }
    }
  };

  const handlePickerSave = (configId: string, category: string, selection: SubcategorySelection) => {
    setFormData(f => {
      const newPrefsData = { ...f.subcategory_preferences.data };
      if (selection.primary || selection.others.length > 0) {
        newPrefsData[configId] = selection;
      } else {
        delete newPrefsData[configId];
      }

      const configSlugMap = new Map(configs.map(c => [c.id, c.category]));
      const catsFromPrefs = Object.keys(newPrefsData).map(id => configSlugMap.get(id)).filter(Boolean) as string[];
      const directToggles = f.categories.filter(cat => {
        const cfg = configs.find(c => c.category === cat);
        return cfg && getSubCount(cfg.id) === 0;
      });
      const mergedCats = [...new Set([...catsFromPrefs, ...directToggles])];

      if (selection.primary || selection.others.length > 0) {
        if (!mergedCats.includes(category)) mergedCats.push(category);
      } else {
        const idx = mergedCats.indexOf(category);
        if (idx >= 0) mergedCats.splice(idx, 1);
      }

      return { ...f, categories: mergedCats, subcategory_preferences: { v: 1, data: newPrefsData } };
    });
  };


  const removeSubcategory = (configId: string, subId: string) => {
    setFormData(f => {
      const pref = f.subcategory_preferences.data[configId];
      if (!pref) return f;
      let newPref: SubcategorySelection;
      if (pref.primary === subId) {
        const [newPrimary, ...rest] = pref.others;
        newPref = { primary: newPrimary || null, others: rest };
      } else {
        newPref = { ...pref, others: pref.others.filter(o => o !== subId) };
      }
      const newData = { ...f.subcategory_preferences.data };
      if (!newPref.primary && newPref.others.length === 0) {
        delete newData[configId];
        const cfg = configs.find(c => c.id === configId);
        return {
          ...f,
          categories: cfg ? f.categories.filter(c => c !== cfg.category) : f.categories,
          subcategory_preferences: { v: 1, data: newData },
        };
      }
      newData[configId] = newPref;
      return { ...f, subcategory_preferences: { v: 1, data: newData } };
    });
  };

  const removeDirectCategory = (configId: string) => {
    const cfg = configs.find(c => c.id === configId);
    if (cfg) handleCategoryChange(cfg.category, false);
  };

  const allSelectedChips: { configId: string; subId: string | null; isPrimary: boolean; displayName: string; categoryName: string; parentGroup: string; isDirect: boolean }[] = [];

  Object.entries(formData.subcategory_preferences.data).forEach(([configId, pref]) => {
    const cfg = configs.find(c => c.id === configId);
    const catName = cfg?.displayName || '';
    const pg = cfg?.parentGroup || '';
    if (pref.primary) {
      const sub = allSubs.find(s => s.id === pref.primary);
      allSelectedChips.push({ configId, subId: pref.primary, isPrimary: true, displayName: sub?.display_name || 'Selected', categoryName: catName, parentGroup: pg, isDirect: false });
    }
    pref.others.forEach(id => {
      const sub = allSubs.find(s => s.id === id);
      allSelectedChips.push({ configId, subId: id, isPrimary: false, displayName: sub?.display_name || 'Selected', categoryName: catName, parentGroup: pg, isDirect: false });
    });
  });

  formData.categories.forEach(cat => {
    const cfg = configs.find(c => c.category === cat);
    if (!cfg) return;
    if (getSubCount(cfg.id) > 0) return;
    if (formData.subcategory_preferences.data[cfg.id]) return;
    const group = parentGroupInfos.find(g => g.value === cfg.parentGroup);
    allSelectedChips.push({ configId: cfg.id, subId: null, isPrimary: false, displayName: cfg.displayName, categoryName: cfg.displayName, parentGroup: cfg.parentGroup, isDirect: true });
  });

  const hasAnySelection = allSelectedChips.length > 0 || formData.categories.length > 0;
  const isSearching = search.trim().length >= 2;
  const noResults = isSearching && searchResults.length === 0;

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={search ? '' : typewriterPlaceholder}
          className="pl-10 h-12 text-base rounded-2xl bg-muted/50 border-border/50 focus:bg-background"
          autoComplete="off"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {allSelectedChips.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2"
          >
            <p className="text-xs font-medium text-muted-foreground">Your selections:</p>
            <div className="flex flex-wrap gap-1.5">
              {allSelectedChips.map((chip, i) => (
                <Badge
                  key={`${chip.configId}-${chip.subId || 'direct'}-${i}`}
                  variant={chip.isPrimary ? 'default' : 'secondary'}
                  className="text-xs py-1 px-2.5 gap-1.5 animate-in fade-in"
                >
                  {chip.isPrimary && <Star size={10} className="fill-current" />}
                  {chip.displayName}
                  <span className="text-[9px] opacity-60">· {chip.categoryName}</span>
                  <button
                    onClick={() => chip.isDirect ? removeDirectCategory(chip.configId) : chip.subId && removeSubcategory(chip.configId, chip.subId)}
                    className="ml-0.5 hover:opacity-70"
                  >
                    <X size={12} />
                  </button>
                </Badge>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {suggestion && !noResults && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 space-y-2"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Sparkles size={14} />
              {suggestion.matchedAlias ? `Admin-mapped "${suggestion.matchedAlias}" → ${suggestion.name}` : 'Suggested for you'}
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => handleItemSelect(suggestion)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleItemSelect(suggestion); }}
              className="w-full flex items-center gap-3 text-left cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                {suggestion.icon ? <DynamicIcon name={suggestion.icon} size={20} /> : <DynamicIcon name={suggestion.parentGroupIcon} size={20} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{suggestion.name}</p>
                <p className="text-xs text-muted-foreground">{suggestion.parentGroupLabel} · {suggestion.categoryName}</p>
              </div>
              <Button size="sm" className="shrink-0 h-8 rounded-xl text-xs" onClick={(e) => { e.stopPropagation(); handleItemSelect(suggestion); }}>
                Use this
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isSearching && !noResults && (
        <div className="space-y-2">
          {suggestion && <p className="text-xs font-medium text-muted-foreground">Other matches</p>}
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {searchResults
              .filter(r => !suggestion || `${r.type}-${r.id}` !== `${suggestion.type}-${suggestion.id}`)
              .map(item => {
                const isSelected = item.type === 'subcategory'
                  ? Object.values(formData.subcategory_preferences.data).some(
                      p => p.primary === item.id || p.others.includes(item.id)
                    )
                  : formData.categories.includes(item.slug);

                return (
                  <button
                    key={`${item.type}-${item.id}`}
                    onClick={() => handleItemSelect(item)}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                      isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30 hover:bg-muted/30'
                    )}
                  >
                    <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', isSelected ? 'bg-primary/15' : 'bg-muted')}>
                      {item.icon ? <DynamicIcon name={item.icon} size={16} /> : <DynamicIcon name={item.parentGroupIcon} size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        {item.matchedAlias && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">
                            matches "{item.matchedAlias}"
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{item.parentGroupLabel} · {item.categoryName}</p>
                    </div>
                    {isSelected ? (
                      <CheckCircle size={18} className="text-primary shrink-0" />
                    ) : (
                      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                    )}
                  </button>
                );
              })}
          </div>

          {/* Always-visible "request new" CTA when results exist but none fit */}
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-dashed border-border/60 bg-muted/20 p-3">
            <p className="text-[11px] text-muted-foreground leading-snug">
              Don't see <span className="font-medium text-foreground">"{search.trim()}"</span>?
              We'll review and add it — usually within 24 hours.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 rounded-xl text-xs"
              onClick={() => setRequestOpen(true)}
            >
              <Plus size={13} className="mr-1" />
              Request
            </Button>
          </div>
        </div>

      )}

      {noResults && (
        <div className="space-y-4">
          <div className="text-center py-4 space-y-2">
            <div className="w-12 h-12 mx-auto rounded-full bg-muted flex items-center justify-center">
              <Search size={20} className="text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No exact match for "{search.trim()}"</p>
            <p className="text-xs text-muted-foreground">
              Pick the closest "Other" group below to keep going, or request "{search.trim()}" as a new category.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 rounded-xl"
              onClick={() => setRequestOpen(true)}
            >
              <Plus size={14} className="mr-1.5" />
              Request "{search.trim().slice(0, 24)}{search.trim().length > 24 ? '…' : ''}"
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Or sell under "Other"</p>
            <div className="grid grid-cols-1 gap-1.5">
              {configs
                .filter(c => c.category.startsWith('other-') && c.isActive !== false)
                .map(c => {
                  const group = parentGroupInfos.find(g => g.value === c.parentGroup);
                  const isSelected = formData.categories.includes(c.category);
                  return (
                    <button
                      key={c.id}
                      onClick={() => handleCategoryChange(c.category, !isSelected) || onGroupResolved(c.parentGroup)}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                        isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30',
                      )}
                    >
                      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', isSelected ? 'bg-primary/15' : 'bg-muted')}>
                        <DynamicIcon name={c.icon || group?.icon || 'Package'} size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.displayName}</p>
                        <p className="text-[11px] text-muted-foreground truncate">Catch-all for {group?.label || c.parentGroup}</p>
                      </div>
                      {isSelected ? (
                        <CheckCircle size={16} className="text-primary shrink-0" />
                      ) : (
                        <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                      )}
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}


      {!isSearching && popularItems.length > 0 && (
        <div className="space-y-2.5">
          <p className="text-xs font-medium text-muted-foreground">Popular categories</p>
          <div className="grid grid-cols-2 gap-2">
            {popularItems.map(item => {
              const isSelected = item.type === 'subcategory'
                ? Object.values(formData.subcategory_preferences.data).some(
                    p => p.primary === item.id || p.others.includes(item.id)
                  )
                : formData.categories.includes(item.slug);

              return (
                <button
                  key={item.id}
                  onClick={() => handleItemSelect(item)}
                  className={cn(
                    'flex items-center gap-2.5 p-3 rounded-xl border transition-all text-left',
                    isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                  )}
                >
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm', isSelected ? 'bg-primary/15' : 'bg-muted')}>
                    {item.icon ? <DynamicIcon name={item.icon} size={16} /> : <DynamicIcon name={item.parentGroupIcon} size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{item.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{item.parentGroupLabel}</p>
                  </div>
                  {isSelected && <CheckCircle size={14} className="text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">
          {isSearching && noResults ? 'Browse all categories' : 'Or browse by category'}
        </p>

        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          {parentGroupInfos.map(group => (
            <button
              key={group.value}
              onClick={() => setBrowseGroup(browseGroup === group.value ? null : group.value)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl border whitespace-nowrap transition-all text-xs font-medium shrink-0',
                browseGroup === group.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-muted/30 hover:border-primary/30'
              )}
            >
              <DynamicIcon name={group.icon} size={14} />
              {group.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {browseGroup && (
            <motion.div
              key={browseGroup}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-1.5"
            >
              {browseItems.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No active categories in this group yet</p>
              ) : (
                browseItems.map(item => {
                  const isSelected = item.type === 'subcategory'
                    ? Object.values(formData.subcategory_preferences.data).some(
                        p => p.primary === item.id || p.others.includes(item.id)
                      )
                    : formData.categories.includes(item.slug);

                  return (
                    <button
                      key={`browse-${item.id}`}
                      onClick={() => handleItemSelect(item)}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                        isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                      )}
                    >
                      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', isSelected ? 'bg-primary/15' : 'bg-muted')}>
                        {item.icon ? <DynamicIcon name={item.icon} size={16} /> : <DynamicIcon name={item.parentGroupIcon} size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{item.categoryName}</p>
                      </div>
                      {isSelected ? (
                        <CheckCircle size={16} className="text-primary shrink-0" />
                      ) : (
                        <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="space-y-3 pt-2">
        <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
          <ArrowRight size={12} />Next: You'll name your store and set operating hours
        </p>
        <Button className="w-full" onClick={onContinue} disabled={!hasAnySelection}>
          Continue<ChevronRight size={16} className="ml-1" />
        </Button>
        {!hasAnySelection && (
          <p className="w-full text-center text-xs text-muted-foreground py-1">
            Select a category (or request one) to continue
          </p>
        )}
      </div>

      {pickerCategory && (
        <SubcategoryPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          categoryConfigId={pickerCategory.id}
          categoryName={pickerCategory.displayName}
          categoryIcon={pickerCategory.icon}
          categorySlug={pickerCategory.category}
          parentGroupSlug={pickerCategory.parentGroup}
          initialSearch={search.trim()}
          selected={formData.subcategory_preferences.data[pickerCategory.id] || { primary: null, others: [] }}
          onSave={(sel) => handlePickerSave(pickerCategory.id, pickerCategory.category, sel)}
        />
      )}

      <RequestCategoryDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        initialName={search.trim()}
        parentGroupInfos={parentGroupInfos}
        sellerId={sellerId}
        onboardingMode={onboardingMode}
        fallbackCategory={lastFallback?.slug ?? null}
        fallbackCategoryLabel={lastFallback?.label ?? null}
        onSubmitted={(groupSlug) => {
          if (groupSlug) {
            const fallback = configs.find(
              c => c.parentGroup === groupSlug && c.category === `other-${groupSlug}`,
            );
            if (fallback) {
              setLastFallback({ slug: fallback.category, label: fallback.displayName });
              if (!formData.categories.includes(fallback.category)) {
                handleCategoryChange(fallback.category, true);
                onGroupResolved(groupSlug);
              }
            } else {
              setLastFallback(null);
            }
          } else {
            setLastFallback(null);
          }
          setSearch('');
        }}
      />

    </div>
  );
}
