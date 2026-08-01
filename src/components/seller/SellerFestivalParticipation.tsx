// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { PartyPopper, Eye, MousePointer, Globe, AlertTriangle, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  sellerId: string;
}

export function SellerFestivalParticipation({ sellerId }: Props) {
  const qc = useQueryClient();

  // Fetch seller profile to check sell_beyond_community
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
        .select('id, title, theme_config, theme_preset, badge_text, schedule_start, schedule_end, target_society_ids')
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

  // Fetch seller's product IDs to filter analytics
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
      // Get analytics filtered to seller's products only
      let query = supabase
        .from('banner_analytics')
        .select('banner_id, event_type')
        .in('banner_id', festivalIds);
      
      // For product-level events, filter by seller's products
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
      toast.success('Festival participation updated');
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (loadingFestivals || loadingPart) {
    return <Skeleton className="h-24 rounded-2xl" />;
  }

  if (festivals.length === 0) return null;

  const sellerSocietyId = sellerProfile?.society_id;
  const canSellBeyond = sellerProfile?.sell_beyond_community ?? false;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <PartyPopper size={16} className="text-amber-500" />
        <p className="text-sm font-semibold">Festival Campaigns</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Opt in to show your products in active festival promotions
      </p>
      {festivals.map((festival: any) => {
        const participation = participations.find((p: any) => p.banner_id === festival.id);
        const isOptedIn = participation ? participation.opted_in : false;
        const gradient = festival.theme_config?.gradient || [];
        const bgPreview = gradient.length >= 2
          ? `linear-gradient(135deg, ${gradient.join(', ')})`
          : festival.theme_config?.bg || 'hsl(var(--primary))';

        const bannerEvents = sellerAnalytics.filter((a: any) => a.banner_id === festival.id);
        const impressions = bannerEvents.filter((a: any) => a.event_type === 'impression').length;
        const clicks = bannerEvents.filter((a: any) => ['click', 'section_click', 'product_click'].includes(a.event_type)).length;

        const targetIds = festival.target_society_ids || [];
        const isGlobal = targetIds.length === 0;

        // Cross-society detection: does this festival target societies beyond the seller's own?
        const crossSocietyIds = sellerSocietyId
          ? targetIds.filter((id: string) => id !== sellerSocietyId)
          : [];
        const isCrossSociety = !isGlobal && crossSocietyIds.length > 0;
        const crossSocietyNames = crossSocietyIds.slice(0, 3).map((id: string) => societyMap.get(id) || 'Unknown');

        // If seller can't sell beyond community and this is cross-society, disable opt-in
        const isCrossSocietyBlocked = isCrossSociety && !canSellBeyond && !targetIds.includes(sellerSocietyId);
        const isGlobalBlocked = isGlobal && !canSellBeyond;

        const societyNames = targetIds.slice(0, 3).map((id: string) => societyMap.get(id) || 'Unknown');

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
                  {festival.schedule_end && (
                    <p className="text-[10px] text-muted-foreground">
                      Ends {new Date(festival.schedule_end).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <Switch
                  checked={isOptedIn}
                  onCheckedChange={(checked) => toggleMutation.mutate({ bannerId: festival.id, optIn: checked })}
                  disabled={toggleMutation.isPending || isCrossSocietyBlocked || isGlobalBlocked}
                />
              </div>

              {/* Visibility info */}
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

              {/* Cross-society consent messaging */}
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

              {/* Blocked: can't sell beyond community */}
              {(isCrossSocietyBlocked || isGlobalBlocked) && (
                <div className="flex items-start gap-2 p-2 rounded-lg bg-destructive/5 border border-destructive/10">
                  <ShieldOff size={12} className="text-destructive shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    This festival targets societies outside your own. Enable "Sell beyond community" in your profile settings to participate.
                  </p>
                </div>
              )}

              {/* Analytics mini-stats */}
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
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
