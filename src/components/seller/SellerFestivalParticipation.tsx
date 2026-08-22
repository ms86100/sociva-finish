// @ts-nocheck
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PartyPopper, Eye, MousePointer, Globe, AlertTriangle, ShieldOff, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';

interface Props {
  sellerId: string;
  variant?: 'settings' | 'dashboard';
}

export function SellerFestivalParticipation({ sellerId, variant = 'settings' }: Props) {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: sellerProfile } = useQuery({
    queryKey: ['seller-profile-for-festivals', sellerId],
    queryFn: async () => {
      const { data } = await supabase
        .from('seller_profiles')
        .select('id, society_id, sell_beyond_community')
        .eq('id', sellerId)
        .single();
      return data;
    },
    enabled: !!sellerId,
    staleTime: 5 * 60_000,
  });

  const { data: festivals = [], isLoading: loadingFestivals } = useQuery({
    queryKey: ['active-festivals-for-seller'],
    queryFn: async () => {
      const { data } = await supabase
        .from('featured_items')
        .select('id, title, theme_config, theme_preset, badge_text, schedule_start, schedule_end, target_society_ids, is_active')
        .eq('banner_type', 'festival')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      return (data || []).filter((f: any) => {
        if (f.schedule_end && new Date(f.schedule_end) < new Date()) return false;
        if (f.schedule_start && new Date(f.schedule_start) > new Date()) return false;
        return true;
      });
    },
    staleTime: 5 * 60_000,
  });

  const { data: participations = [], isLoading: loadingPart } = useQuery({
    queryKey: ['seller-festival-participation', sellerId],
    queryFn: async () => {
      const { data } = await supabase
        .from('festival_seller_participation')
        .select('*')
        .eq('seller_id', sellerId);
      return data || [];
    },
    enabled: !!sellerId,
    staleTime: 5 * 60_000,
  });

  const { data: sellerProductIds = [] } = useQuery({
    queryKey: ['seller-product-ids', sellerId],
    queryFn: async () => {
      const { data } = await supabase
        .from('products')
        .select('id')
        .eq('seller_id', sellerId);
      return (data || []).map((p: any) => p.id);
    },
    enabled: !!sellerId,
    staleTime: 5 * 60_000,
  });

  const festivalIds = festivals.map((f: any) => f.id);
  const { data: sellerAnalytics = [] } = useQuery({
    queryKey: ['seller-banner-analytics', sellerId, festivalIds, sellerProductIds],
    queryFn: async () => {
      if (festivalIds.length === 0) return [];
      let query = supabase
        .from('banner_analytics')
        .select('banner_id, event_type')
        .in('banner_id', festivalIds);

      if (sellerProductIds.length > 0) {
        query = query.or(`product_id.is.null,product_id.in.(${sellerProductIds.join(',')})`);
      }

      const { data } = await query;
      return data || [];
    },
    enabled: festivalIds.length > 0 && sellerProductIds.length >= 0,
    staleTime: 60_000,
  });

  const targetSocietyIds = [...new Set(festivals.flatMap((f: any) => f.target_society_ids || []))];
  const { data: societies = [] } = useQuery({
    queryKey: ['societies-for-festivals', targetSocietyIds],
    queryFn: async () => {
      if (targetSocietyIds.length === 0) return [];
      const { data } = await supabase
        .from('societies')
        .select('id, name')
        .in('id', targetSocietyIds);
      return data || [];
    },
    enabled: targetSocietyIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const societyMap = new Map(societies.map((s: any) => [s.id, s.name]));

  const expandedFestivalId = expandedId || (variant === 'dashboard' && festivals[0]?.id) || null;

  const { data: matches = [] } = useQuery({
    queryKey: ['festival-seller-matches', expandedFestivalId, sellerId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('festival_seller_matches', {
        p_banner_id: expandedFestivalId,
        p_seller_id: sellerId,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!expandedFestivalId && !!sellerId,
    staleTime: 30_000,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ bannerId, optIn }: { bannerId: string; optIn: boolean }) => {
      const { error } = await supabase
        .from('festival_seller_participation')
        .upsert(
          { banner_id: bannerId, seller_id: sellerId, opted_in: optIn, updated_at: new Date().toISOString() },
          { onConflict: 'banner_id,seller_id' }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seller-festival-participation'] });
      showFeedback({
        title: 'Festival participation updated',
        variant: 'success',
      });
    },
    onError: (e: any) => toast.error(friendlyError(e) || 'Failed to update participation'),
  });

  const exclusionMutation = useMutation({
    mutationFn: async ({ bannerId, productId, exclude }: { bannerId: string; productId: string; exclude: boolean }) => {
      if (exclude) {
        const { error } = await supabase.from('festival_product_exclusions').upsert(
          { banner_id: bannerId, seller_id: sellerId, product_id: productId },
          { onConflict: 'banner_id,product_id' },
        );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('festival_product_exclusions')
          .delete()
          .eq('banner_id', bannerId)
          .eq('product_id', productId)
          .eq('seller_id', sellerId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['festival-seller-matches'] });
      qc.invalidateQueries({ queryKey: ['banner-batch-products'] });
    },
    onError: (e: any) => toast.error(friendlyError(e) || 'Failed to update product'),
  });

  const matchesBySection = useMemo(() => {
    const map = new Map<string, { title: string; products: any[] }>();
    for (const row of matches as any[]) {
      const key = row.section_id;
      if (!map.has(key)) map.set(key, { title: row.section_title, products: [] });
      map.get(key)!.products.push(row);
    }
    return [...map.values()];
  }, [matches]);

  const includedCount = (matches as any[]).filter((m) => !m.is_excluded).length;

  if (loadingFestivals || loadingPart) {
    return <Skeleton className="h-24 rounded-2xl" />;
  }

  if (festivals.length === 0) return null;

  const sellerSocietyId = sellerProfile?.society_id;
  const canSellBeyond = sellerProfile?.sell_beyond_community ?? false;

  return (
    <div className="space-y-3">
      {variant === 'settings' && (
        <>
          <div className="flex items-center gap-2">
            <PartyPopper size={16} className="text-amber-500" />
            <p className="text-sm font-semibold">Festival Campaigns</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Matching products appear automatically. Opt out anytime, or exclude individual items.
          </p>
        </>
      )}
      {festivals.map((festival: any) => {
        const participation = participations.find((p: any) => p.banner_id === festival.id);
        const isOptedIn = participation ? participation.opted_in : true;
        const gradient = festival.theme_config?.gradient || [];
        const bgPreview = gradient.length >= 2
          ? `linear-gradient(135deg, ${gradient.join(', ')})`
          : festival.theme_config?.bg || 'hsl(var(--primary))';

        const bannerEvents = sellerAnalytics.filter((a: any) => a.banner_id === festival.id);
        const impressions = bannerEvents.filter((a: any) => a.event_type === 'impression').length;
        const clicks = bannerEvents.filter((a: any) => ['click', 'section_click', 'product_click'].includes(a.event_type)).length;

        const targetIds = festival.target_society_ids || [];
        const isGlobal = targetIds.length === 0;
        const crossSocietyIds = sellerSocietyId
          ? targetIds.filter((id: string) => id !== sellerSocietyId)
          : [];
        const isCrossSociety = !isGlobal && crossSocietyIds.length > 0;
        const crossSocietyNames = crossSocietyIds.slice(0, 3).map((id: string) => societyMap.get(id) || 'Unknown');
        const isCrossSocietyBlocked = isCrossSociety && !canSellBeyond && !targetIds.includes(sellerSocietyId);
        const isGlobalBlocked = false;
        const societyNames = targetIds.slice(0, 3).map((id: string) => societyMap.get(id) || 'Unknown');
        const isExpanded = expandedFestivalId === festival.id;

        return (
          <Card key={festival.id} className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
            <CardContent className="p-3.5 space-y-2.5">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-lg"
                  style={{ background: bgPreview }}
                >
                  {festival.badge_text ? '🎉' : '🎊'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{festival.title || 'Festival'}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {isOptedIn
                      ? `${includedCount || 'Matching'} product${includedCount === 1 ? '' : 's'} will appear automatically`
                      : 'You have left this festival'}
                    {festival.schedule_end && ` · Ends ${new Date(festival.schedule_end).toLocaleDateString()}`}
                  </p>
                </div>
                <Switch
                  checked={isOptedIn}
                  onCheckedChange={(checked) => toggleMutation.mutate({ bannerId: festival.id, optIn: checked })}
                  disabled={toggleMutation.isPending || isCrossSocietyBlocked || isGlobalBlocked}
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {isGlobal ? (
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 gap-1">
                    <Globe size={8} /> All societies
                  </Badge>
                ) : (
                  societyNames.map((name: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[9px] h-4 px-1.5">
                      {name}
                    </Badge>
                  ))
                )}
                {targetIds.length > 3 && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                    +{targetIds.length - 3} more
                  </Badge>
                )}
              </div>

              {isCrossSociety && canSellBeyond && (
                <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                  <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Your products will be visible to buyers in{' '}
                    <span className="font-semibold text-foreground">
                      {crossSocietyNames.join(', ')}
                      {crossSocietyIds.length > 3 && ` and ${crossSocietyIds.length - 3} more`}
                    </span>
                    {' '}beyond your own society.
                  </p>
                </div>
              )}

              {(isCrossSocietyBlocked || isGlobalBlocked) && (
                <div className="flex items-start gap-2 p-2 rounded-lg bg-destructive/5 border border-destructive/10">
                  <ShieldOff size={12} className="text-destructive shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    This festival targets societies outside your own. Enable "Sell beyond community" in your profile settings to participate.
                  </p>
                </div>
              )}

              {isOptedIn && (impressions > 0 || clicks > 0) && (
                <div className="flex items-center gap-4 pt-1">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Eye size={10} /> {impressions} views
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <MousePointer size={10} /> {clicks} clicks
                  </div>
                </div>
              )}

              {isOptedIn && !isCrossSocietyBlocked && !isGlobalBlocked && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-between text-xs"
                  onClick={() => setExpandedId(isExpanded ? null : festival.id)}
                >
                  Review matching products
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </Button>
              )}

              {isExpanded && isOptedIn && (
                <div className="space-y-3 pt-1">
                  {matchesBySection.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      No catalogue matches yet. Add relevant products and they will appear here automatically.
                    </p>
                  ) : (
                    matchesBySection.map((group) => (
                      <div key={group.title} className="space-y-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {group.title} · {group.products.filter((p) => !p.is_excluded).length}/{group.products.length}
                        </p>
                        {group.products.map((row: any) => (
                          <label
                            key={row.product_id}
                            className="flex items-center gap-2.5 p-2 rounded-xl bg-muted/40"
                          >
                            {row.product_image_url ? (
                              <img
                                src={optimizedImageUrl(row.product_image_url, { width: 64, quality: 60 })}
                                alt=""
                                className="w-9 h-9 rounded-lg object-cover"
                                onError={handleImageError}
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-lg bg-muted" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{row.product_name}</p>
                              <p className="text-[10px] text-muted-foreground">₹{row.product_price}</p>
                            </div>
                            <Checkbox
                              checked={!row.is_excluded}
                              onCheckedChange={(checked) => exclusionMutation.mutate({
                                bannerId: festival.id,
                                productId: row.product_id,
                                exclude: !checked,
                              })}
                            />
                          </label>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
