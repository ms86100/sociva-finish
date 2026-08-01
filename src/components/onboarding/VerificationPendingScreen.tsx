// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAuth } from '@/contexts/AuthContext';
import { Clock, Users, Shield, Building2, ShieldCheck, Activity, HelpCircle, ChevronDown, CheckCircle2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface PreviewData {
  queuePosition: number;
  avgApprovalHours: number | null;
  societyTrustScore: number;
  memberCount: number;
  recentActivityCount: number;
}

export function VerificationPendingScreen() {
  const { profile, refreshProfile, signOut } = useAuth();
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);

  // Auto-refresh verification status every 60s
  const checkVerificationStatus = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('profiles')
      .select('verification_status')
      .eq('id', profile.id)
      .single();
    if (data?.verification_status === 'approved') {
      toast.success('🎉 You have been verified! Welcome to your community.');
      // Re-fetch auth context so React re-renders with updated status
      await refreshProfile();
    }
  }, [profile?.id, refreshProfile]);

  useEffect(() => {
    if (!profile?.society_id) {
      setLoading(false);
      return;
    }
    fetchPreviewData();

    // Poll verification status every 60s
    const interval = setInterval(checkVerificationStatus, 60000);
    return () => clearInterval(interval);
  }, [profile?.society_id, checkVerificationStatus]);

  const fetchPreviewData = async () => {
    const sid = profile!.society_id;
    const userId = profile!.id;

    const [queueRes, approvedRes, societyRes, membersRes, activityRes] = await Promise.all([
      // Count pending profiles created before this user
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('society_id', sid)
        .eq('verification_status', 'pending')
        .lt('created_at', profile!.created_at),
      // Get recently approved profiles to calculate avg time
      supabase
        .from('profiles')
        .select('created_at, updated_at')
        .eq('society_id', sid)
        .eq('verification_status', 'approved')
        .order('updated_at', { ascending: false })
        .limit(20),
      // Society trust score
      supabase
        .from('societies')
        .select('trust_score')
        .eq('id', sid)
        .single(),
      // Member count
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('society_id', sid)
        .eq('verification_status', 'approved'),
      // Recent activity count (last 7 days)
      supabase
        .from('society_activity')
        .select('id', { count: 'exact', head: true })
        .eq('society_id', sid)
        .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
    ]);

    // Calculate avg approval time
    let avgHours: number | null = null;
    if (approvedRes.data && approvedRes.data.length > 0) {
      const times = approvedRes.data
        .filter((p: any) => p.created_at && p.updated_at)
        .map((p: any) => (new Date(p.updated_at).getTime() - new Date(p.created_at).getTime()) / 3600000)
        .filter((h: number) => h > 0 && h < 720); // Filter unreasonable values

      if (times.length > 0) {
        avgHours = Math.round(times.reduce((a: number, b: number) => a + b, 0) / times.length);
      }
    }

    setPreview({
      queuePosition: (queueRes.count || 0) + 1,
      avgApprovalHours: avgHours,
      societyTrustScore: Number(societyRes.data?.trust_score || 0),
      memberCount: membersRes.count || 0,
      recentActivityCount: activityRes.count || 0,
    });
    setLoading(false);
  };

  return (
    <AppLayout showCart={false}>
      <div className="px-4 py-6 space-y-4">
        {/* Status Header */}
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-warning/20 flex items-center justify-center">
            <Clock className="text-warning" size={32} />
          </div>
          <h2 className="text-lg font-bold">Verification in Progress</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Your community admin will verify your details shortly.
          </p>
          <p className="text-xs text-muted-foreground/60 mt-2">Auto-checking status every minute</p>
        </div>

        {/* What happens next? */}
        <Collapsible>
          <CollapsibleTrigger className="w-full flex items-center justify-between bg-card border border-border rounded-xl px-4 py-3 text-sm font-medium">
            <span className="flex items-center gap-2">
              <HelpCircle size={16} className="text-primary" />
              What happens next?
            </span>
            <ChevronDown size={16} className="text-muted-foreground" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 bg-card border border-border rounded-xl px-4 py-3 space-y-2 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <CheckCircle2 size={14} className="text-primary mt-0.5 shrink-0" />
              <p>Your society admin reviews your Block & Flat details.</p>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 size={14} className="text-primary mt-0.5 shrink-0" />
              <p>Once approved, you'll get full access to the marketplace, bulletin, and community features.</p>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 size={14} className="text-primary mt-0.5 shrink-0" />
              <p>This page auto-refreshes — no need to keep checking manually.</p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Need help? */}
        <Link to="/help" className="block text-center text-sm text-primary font-medium hover:underline">
          Need help? Contact support →
        </Link>

        {/* Logout button */}
        <Button
          variant="ghost"
          className="w-full text-destructive hover:text-destructive"
          onClick={() => signOut()}
        >
          <LogOut size={16} className="mr-2" />
          Log Out & Start Over
        </Button>

        {/* Queue & Timing Info */}
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : preview && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-primary">#{preview.queuePosition}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Queue Position</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-primary">
                    {preview.avgApprovalHours !== null
                      ? preview.avgApprovalHours < 1 ? '<1h' : `~${preview.avgApprovalHours}h`
                      : '—'}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">Avg. Approval Time</p>
                </CardContent>
              </Card>
            </div>

            {/* Your Details */}
            <Card>
              <CardContent className="p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Your Details</p>
                <div className="space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Name:</span> {profile?.name}</p>
                  <p><span className="text-muted-foreground">Block:</span> {profile?.block}</p>
                  <p><span className="text-muted-foreground">Flat:</span> {profile?.flat_number}</p>
                </div>
              </CardContent>
            </Card>

            {/* Society Preview (Read-Only) */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                Society Preview
              </p>
              <Card className="border-primary/10 bg-primary/5">
                <CardContent className="p-4 space-y-3">
                  {/* Trust Score */}
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Shield className="text-primary" size={18} />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Trust Score</p>
                      <p className="text-lg font-bold">{preview.societyTrustScore.toFixed(1)}<span className="text-xs text-muted-foreground font-normal">/10</span></p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center p-2 rounded-lg bg-background">
                      <Users size={14} className="mx-auto text-primary mb-1" />
                      <p className="text-sm font-bold">{preview.memberCount}</p>
                      <p className="text-[9px] text-muted-foreground">Members</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-background">
                      <Activity size={14} className="mx-auto text-success mb-1" />
                      <p className="text-sm font-bold">{preview.recentActivityCount}</p>
                      <p className="text-[9px] text-muted-foreground">This Week</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-background">
                      <ShieldCheck size={14} className="mx-auto text-info mb-1" />
                      <p className="text-sm font-bold">Active</p>
                      <p className="text-[9px] text-muted-foreground">Community</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
