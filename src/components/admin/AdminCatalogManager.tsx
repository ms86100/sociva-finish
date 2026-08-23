// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { useCategoryConfig } from '@/hooks/queries/useCategoryConfig';
import { useParentGroups } from '@/hooks/useParentGroups';
import { useSubcategories } from '@/hooks/useSubcategories';
import { CategoryManager } from '@/components/admin/CategoryManager';
import { SubcategoryManager } from '@/components/admin/SubcategoryManager';
import { AdminAttributeBlockManager } from '@/components/admin/AdminAttributeBlockManager';
import { LicenseConfigSection } from '@/components/admin/LicenseConfigSection';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { motion, AnimatePresence } from 'framer-motion';
import { AdminCategoryRequestsManager } from '@/components/admin/AdminCategoryRequestsManager';
import { useCategoryRequestCounts } from '@/hooks/admin/useCategoryRequests';
import { ChevronDown, ChevronRight, Layers3, Grid3X3, Blocks, TreePine, Search, X, Inbox } from 'lucide-react';

interface AttributeBlock {
  id: string;
  block_type: string;
  display_name: string;
  description: string | null;
  icon: string | null;
  category_hints: string[] | null;
  renderer_type: string;
  is_active: boolean;
}

function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  return fields.some(f => f && f.toLowerCase().includes(query));
}

export function AdminCatalogManager() {
  const [subTab, setSubTab] = useState('categories');
  const [blocks, setBlocks] = useState<AttributeBlock[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: categories = [], isLoading: categoriesLoading } = useCategoryConfig();
  const { groups: parentGroups, isLoading: groupsLoading } = useParentGroups();
  const { data: subcategories = [], isLoading: subcatsLoading } = useSubcategories();
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  useEffect(() => { fetchBlocks(); }, []);

  const fetchBlocks = async () => {
    setBlocksLoading(true);
    const { data } = await supabase
      .from('attribute_block_library')
      .select('id, block_type, display_name, description, icon, category_hints, renderer_type, is_active')
      .eq('is_active', true)
      .order('display_order');
    setBlocks((data || []) as unknown as AttributeBlock[]);
    setBlocksLoading(false);
  };

  const getBlocksForCategory = (categorySlug: string) =>
    blocks.filter(b => (b.category_hints || []).includes(categorySlug));

  const toggleExpand = (slug: string) =>
    setExpandedCategory(prev => prev === slug ? null : slug);

  const isLoading = categoriesLoading || blocksLoading || groupsLoading || subcatsLoading;

  const query = searchQuery.trim().toLowerCase();
  const isSearching = query.length > 0;

  // Filtered categories for overview tab
  const filteredCategories = useMemo(() => {
    if (!isSearching) return categories as any[];
    return (categories as any[]).filter((cat: any) => {
      if (matchesQuery(query, cat.displayName || cat.display_name, cat.category)) return true;
      const subs = subcategories.filter(s => s.category_config_id === cat.id);
      if (subs.some(s => matchesQuery(query, s.display_name, s.slug))) return true;
      const linked = getBlocksForCategory(cat.category);
      if (linked.some(b => matchesQuery(query, b.display_name, b.block_type, b.description))) return true;
      return false;
    });
  }, [categories, subcategories, blocks, query, isSearching]);

  // Auto-expand matching categories
  useEffect(() => {
    if (isSearching && filteredCategories.length > 0) {
      setExpandedCategory(filteredCategories[0]?.category || null);
    }
  }, [query]);

  // Build taxonomy tree data
  const taxonomyTree = useMemo(() => {
    const tree = parentGroups.map(group => {
      const groupCats = (categories as any[]).filter((c: any) => c.parentGroup === group.slug || c.parent_group === group.slug);
      return {
        ...group,
        categories: groupCats.map((cat: any) => ({
          ...cat,
          subcategories: subcategories.filter(sub => sub.category_config_id === cat.id),
        })),
      };
    });
    if (!isSearching) return tree;
    return tree
      .map(group => {
        const groupMatches = matchesQuery(query, group.name);
        const filteredCats = group.categories
          .map((cat: any) => {
            const catMatches = matchesQuery(query, cat.displayName || cat.display_name, cat.category);
            const filteredSubs = cat.subcategories.filter((s: any) => matchesQuery(query, s.display_name, s.slug));
            if (catMatches || filteredSubs.length > 0) return { ...cat, subcategories: catMatches ? cat.subcategories : filteredSubs };
            return null;
          })
          .filter(Boolean);
        if (groupMatches || filteredCats.length > 0) return { ...group, categories: groupMatches ? group.categories : filteredCats };
        return null;
      })
      .filter(Boolean) as typeof tree;
  }, [parentGroups, categories, subcategories, query, isSearching]);

  // Filtered blocks for attributes tab
  const filteredBlocksForSearch = useMemo(() => {
    if (!isSearching) return blocks;
    return blocks.filter(b =>
      matchesQuery(query, b.display_name, b.block_type, b.description,
        ...(b.category_hints || []))
    );
  }, [blocks, query, isSearching]);

  const resultCount = useMemo(() => {
    if (!isSearching) return 0;
    if (subTab === 'categories') return filteredCategories.length;
    if (subTab === 'attributes') return filteredBlocksForSearch.length;
    return filteredCategories.length;
  }, [isSearching, subTab, filteredCategories, filteredBlocksForSearch]);

  const { data: requestCounts } = useCategoryRequestCounts();
  const pendingRequests = requestCounts?.pending ?? 0;

  const TAB_ITEMS = [
    { value: 'categories', label: 'Categories', icon: Grid3X3 },
    { value: 'attributes', label: 'Attributes', icon: Blocks },
    { value: 'requests', label: 'Requests', icon: Inbox, badge: pendingRequests },
    { value: 'licenses', label: 'Licenses', icon: Layers3 },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/60 bg-muted/30 p-3 text-xs space-y-1.5">
        <p className="font-bold text-foreground text-[11px] uppercase tracking-wider">How catalog fits together</p>
        <p><span className="font-semibold">Section</span> — aisle (Food, Services…)</p>
        <p><span className="font-semibold">Category</span> — what sellers sell + buyer journey (cart / book / enquire)</p>
        <p><span className="font-semibold">Subcategory</span> — optional form tweaks (veg/duration)</p>
        <p><span className="font-semibold">Attributes</span> — extra fields on the product form for that category</p>
        <p><span className="font-semibold">Workflow</span> — order statuses for that journey (managed under Workflows)</p>
      </div>
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="w-full grid grid-cols-4 bg-muted/60 p-1 rounded-2xl">
          {TAB_ITEMS.map(tab => {
            const TabIcon = tab.icon;
            return (
              <TabsTrigger key={tab.value} value={tab.value} className="text-xs gap-1.5 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:font-semibold transition-all duration-200 relative">
                <TabIcon size={12} /> {tab.label}
                {tab.badge ? (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px] rounded-md bg-amber-500/20 text-amber-700">
                    {tab.badge}
                  </Badge>
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Deep Search Bar */}
        <div className="sticky top-0 z-10 mt-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search sections, categories, subcategories, attributes…"
              className="pl-9 pr-20 h-9 text-xs rounded-xl bg-muted/50 border-border/30 focus-visible:ring-1"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {isSearching && (
                <>
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-5 rounded-md">
                    {resultCount} result{resultCount !== 1 ? 's' : ''}
                  </Badge>
                  <button onClick={() => setSearchQuery('')} className="p-0.5 rounded-md hover:bg-muted transition-colors">
                    <X size={12} className="text-muted-foreground" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Taxonomy Overview Tree */}
        <Collapsible open={taxonomyOpen || isSearching} onOpenChange={setTaxonomyOpen} className="mt-3">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 w-full p-3 rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors text-left">
              <TreePine size={14} className="text-primary shrink-0" />
              <span className="text-xs font-bold flex-1">Taxonomy Overview</span>
              <Badge variant="secondary" className="text-[9px] rounded-md">
                {parentGroups.length} sections · {(categories as any[]).length} categories · {subcategories.length} subcategories
              </Badge>
              <motion.div animate={{ rotate: (taxonomyOpen || isSearching) ? 90 : 0 }} transition={{ duration: 0.15 }}>
                <ChevronRight size={14} className="text-muted-foreground" />
              </motion.div>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 p-3 rounded-xl bg-muted/20 border border-border/30 text-xs font-mono space-y-0.5 max-h-[300px] overflow-y-auto">
              {taxonomyTree.map((group) => (
                <div key={group.id}>
                  <div className="flex items-center gap-1.5 font-semibold text-foreground">
                    <DynamicIcon name={group.icon} size={16} />
                    <span>{group.name}</span>
                    <span className="text-muted-foreground font-normal">(Section)</span>
                  </div>
                  {group.categories.length === 0 && (
                    <div className="ml-5 text-muted-foreground italic">No categories</div>
                  )}
                  {group.categories.map((cat: any, ci: number) => (
                    <div key={cat.id} className="ml-5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">{ci === group.categories.length - 1 ? '└──' : '├──'}</span>
                        <span><DynamicIcon name={cat.icon} size={14} /></span>
                        <span className="font-medium">{cat.displayName || cat.display_name}</span>
                        <span className="text-muted-foreground font-normal">(Category)</span>
                      </div>
                      {cat.subcategories.map((sub: any, si: number) => (
                        <div key={sub.id} className="ml-8 flex items-center gap-1.5">
                          <span className="text-muted-foreground">{si === cat.subcategories.length - 1 ? '└──' : '├──'}</span>
                          <span><DynamicIcon name={sub.icon || '📂'} size={12} /></span>
                          <span>{sub.display_name}</span>
                          <span className="text-muted-foreground font-normal">(Sub)</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
              {taxonomyTree.length === 0 && (
                <p className="text-muted-foreground italic">{isSearching ? 'No matches found.' : 'No taxonomy data yet.'}</p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Categories sub-tab */}
        <TabsContent value="categories" className="mt-4">
          <div className="stack-gap-lg">
            <CategoryManager />
            <SubcategoryManager />
          </div>
        </TabsContent>

        {/* Attributes sub-tab */}
        <TabsContent value="attributes" className="mt-4">
          <AdminAttributeBlockManager />
        </TabsContent>

        {/* Requests sub-tab */}
        <TabsContent value="requests" className="mt-4">
          <AdminCategoryRequestsManager />
        </TabsContent>

        {/* Licenses sub-tab */}
        <TabsContent value="licenses" className="mt-4">
          <LicenseConfigSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
