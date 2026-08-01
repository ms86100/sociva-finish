// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { Builder } from '@/types/database';
import { Building2, Users, Shield, AlertTriangle, ChevronRight, IndianRupee, Clock, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useBuilderStats } from '@/hooks/queries/useBuilderStats';
import { BuilderFeaturePlan } from '@/components/builder/BuilderFeaturePlan';
import { BuilderSocietyFeatures } from '@/components/builder/BuilderSocietyFeatures';
import { BuilderActionCenter } from '@/components/builder/BuilderActionCenter';
import { BuilderAnnouncementSheet } from '@/components/builder/BuilderAnnouncementSheet';
import { BuilderSetupWizard } from '@/components/builder/BuilderSetupWizard';
import { useCurrency } from '@/hooks/useCurrency';

interface BuilderSociety {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  is_active: boolean;
  is_verified: boolean;
  is_under_construction: boolean;
  trust_score: number;
  member_count: number | null;
  created_at: string;
  pending_users: number;
  total_members: number;
  pending_sellers: number;
  active_sellers: number;
  open_disputes: number;
  open_snags: number;
}

export default function BuilderDashboardPage() {
  const { isBuilderMember, managedBuilderIds, isAdmin, setViewAsSociety } = useAuth();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [builder, setBuilder] = useState<Builder | null>(null);
  const [societies, setSocieties] = useState<BuilderSociety[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const societyIds = societies.map(s => s.id);
  const { data: builderStats } = useBuilderStats(societyIds);

  useEffect(() => {
    if (managedBuilderIds.length === 0 && !isAdmin) return;
    fetchBuilderData();
  }, [managedBuilderIds, isAdmin]);

  const fetchBuilderData = async () => {
    try {
      if (managedBuilderIds.length > 0) {
        const { data, error } = await supabase.rpc('get_builder_dashboard', {
          _builder_id: managedBuilderIds[0],
        });

        if (error) {
          console.error('Builder dashboard error:', error);
          return;
        }

        const ctx = data as any;
        setBuilder(ctx.builder as Builder | null);
        setSocieties((ctx.societies as BuilderSociety[]) || []);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocietyClick = (societyId: string, targetPath: string = '/society') => {
    setViewAsSociety(societyId);
    navigate(targetPath);
  };

  if (!isBuilderMember && !isAdmin) {
    return (
      <AppLayout headerTitle="Builder Dashboard" showLocation={false}>
        <div className="p-4 text-center text-muted-foreground py-20">
          <Building2 size={48} className="mx-auto mb-4 text-muted-foreground/50" />
          <p className="font-medium">Access Denied</p>
          <p className="text-sm">You need builder access to view this page.</p>
        </div>
      </AppLayout>
    );
  }

  if (isLoading) {
    return (
      <AppLayout headerTitle="Builder Dashboard" showLocation={false}>
        <div className="p-4 space-y-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      </AppLayout>
    );
  }

  const totalMembers = societies.reduce((sum, s) => sum + s.total_members, 0);
  const totalPending = societies.reduce((sum, s) => sum + s.pending_users, 0);
  const totalDisputes = societies.reduce((sum, s) => sum + s.open_disputes, 0);
  const totalPendingSellers = societies.reduce((sum, s) => sum + s.pending_sellers, 0);

  return (
    <AppLayout headerTitle={builder?.name || 'Builder Dashboard'} showLocation={false}>
      <div className="p-4 space-y-4">
        {/* Aggregate Stats */}
        <div className="grid grid-cols-2 gap-3">
          <Card><CardContent className="p-3 text-center">
            <Building2 className="mx-auto text-primary mb-1" size={18} />
            <p className="text-lg font-bold tabular-nums">{societies.length}</p>
            <p className="text-[10px] text-muted-foreground">Societies</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <Users className="mx-auto text-primary mb-1" size={18} />
            <p className="text-lg font-bold tabular-nums">{totalMembers}</p>
            <p className="text-[10px] text-muted-foreground">Total Members</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <Shield className="mx-auto text-warning mb-1" size={18} />
            <p className="text-lg font-bold tabular-nums">{totalPending + totalPendingSellers}</p>
            <p className="text-[10px] text-muted-foreground">Pending Approvals</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <AlertTriangle className="mx-auto text-destructive mb-1" size={18} />
            <p className="text-lg font-bold tabular-nums">{totalDisputes}</p>
            <p className="text-[10px] text-muted-foreground">Open Issues</p>
          </CardContent></Card>
        </div>

        {/* Builder-level aggregate metrics */}
        {builderStats && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4 grid grid-cols-3 gap-3">
              <div className="text-center">
                <IndianRupee size={14} className="mx-auto text-primary mb-1" />
                <p className="text-sm font-bold">{formatPrice(builderStats.totalRevenue)}</p>
                <p className="text-[10px] text-muted-foreground">Total Revenue</p>
              </div>
              <div className="text-center">
                <Clock size={14} className="mx-auto text-warning mb-1" />
                <p className="text-sm font-bold">{builderStats.breachedSLAs}</p>
                <p className="text-[10px] text-muted-foreground">SLA Breached</p>
              </div>
              <div className="text-center">
                <Shield size={14} className="mx-auto text-primary mb-1" />
                <p className="text-sm font-bold">{builderStats.onTrackSLAs}</p>
                <p className="text-[10px] text-muted-foreground">On Track</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Builder Feature Plan + Announcement */}
        {managedBuilderIds.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-muted-foreground">Feature Plan</h3>
              <BuilderAnnouncementSheet
                societies={societies.map(s => ({ id: s.id, name: s.name }))}
                builderId={managedBuilderIds[0]}
              />
            </div>
            <BuilderFeaturePlan builderId={managedBuilderIds[0]} />
          </>
        )}

        {/* Action Center - Consolidated snags & disputes */}
        {societyIds.length > 0 && (
          <BuilderActionCenter 
            societyIds={societyIds} 
            onNavigateToSociety={handleSocietyClick} 
          />
        )}

        {/* Analytics Link */}
        <Card 
          className="hover:shadow-md transition-shadow cursor-pointer border-primary/20 bg-primary/5"
          onClick={() => navigate('/builder/analytics')}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <BarChart3 size={20} />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">Portfolio Analytics</p>
              <p className="text-xs text-muted-foreground">Complaint trends, SLA compliance, revenue</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground" />
          </CardContent>
        </Card>

        {/* Societies List */}
        <h3 className="font-semibold text-sm text-muted-foreground">Managed Societies</h3>
        <div className="space-y-3">
          {societies.map((s) => (
            <Card key={s.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => handleSocietyClick(s.id)}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <Building2 size={20} />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-sm">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.total_members} members • {s.active_sellers} sellers
                  </p>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {s.is_verified && <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">Verified</span>}
                    {s.pending_users > 0 && (
                      <button
                        className="text-[10px] bg-warning/10 text-warning px-1.5 py-0.5 rounded hover:bg-warning/20 transition-colors"
                        onClick={(e) => { e.stopPropagation(); handleSocietyClick(s.id, '/society/admin'); }}
                      >
                        {s.pending_users} pending
                      </button>
                    )}
                    {s.open_disputes > 0 && (
                      <button
                        className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded hover:bg-destructive/20 transition-colors"
                        onClick={(e) => { e.stopPropagation(); handleSocietyClick(s.id, '/disputes'); }}
                      >
                        {s.open_disputes} disputes
                      </button>
                    )}
                    <BuilderSocietyFeatures societyId={s.id} />
                    <span onClick={e => e.stopPropagation()}>
                      <BuilderSetupWizard societyId={s.id} societyName={s.name} />
                    </span>
                    {s.open_snags > 0 && (
                      <button
                        className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded hover:bg-destructive/20 transition-colors"
                        onClick={(e) => { e.stopPropagation(); handleSocietyClick(s.id, '/society/snags'); }}
                      >
                        {s.open_snags} snags
                      </button>
                    )}
                  </div>
                </div>
                <ChevronRight size={16} className="text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
          {societies.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">No societies assigned to this builder yet</p>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
